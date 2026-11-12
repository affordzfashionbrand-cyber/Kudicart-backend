import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createServer } from 'http';
import * as WebSocket from 'ws';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RedisService } from '../../common/redis/redis.service';
import { TrackingRealtimeGateway } from './tracking-realtime.gateway';

describe('Phase 2: Distributed Redis Rate Limiting & Multi-Instance Tracking Gateway', () => {
  let redisService: RedisService;
  let reflector: Reflector;

  beforeAll(async () => {
    redisService = new RedisService();
    await redisService.onModuleInit();
    reflector = new Reflector();
  });

  afterAll(async () => {
    await redisService.onModuleDestroy();
  });

  beforeEach(() => {
    RateLimitGuard.resetAll();
    redisService.resetInMemoryState();
  });

  describe('1. Distributed Atomic Sliding-Window Rate Limiting', () => {
    function createMockContext(ip: string, user?: { id: string }, headers: Record<string, string> = {}) {
      const req: any = {
        headers,
        socket: { remoteAddress: ip },
        user,
      };
      const res: any = {
        headers: {},
        setHeader: (k: string, v: string) => {
          res.headers[k] = v;
        },
      };

      return {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => res,
        }),
        getHandler: () => ({ name: 'testEndpoint' }),
        getClass: () => ({ name: 'TestController' }),
      } as unknown as ExecutionContext;
    }

    it('shares rate-limit counters across independent guard instances (Instance A & Instance B)', () => {
      // Mock reflector returning limit of 3 requests per 10 seconds
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ points: 3, duration: 10 });

      // Instance A and Instance B share the same distributed RedisService
      const guardA = new RateLimitGuard(reflector, redisService);
      const guardB = new RateLimitGuard(reflector, redisService);

      const ctx = createMockContext('192.168.1.100');

      // Request 1 on Instance A -> Allowed (1/3)
      const res1 = guardA.canActivate(ctx);
      expect(res1).toBe(true);

      // Request 2 on Instance B -> Allowed (2/3)
      const res2 = guardB.canActivate(ctx);
      expect(res2).toBe(true);

      // Request 3 on Instance A -> Allowed (3/3)
      const res3 = guardA.canActivate(ctx);
      expect(res3).toBe(true);

      // Request 4 on Instance B -> Exceeds limit -> HTTP 429 Too Many Requests
      expect(() => guardB.canActivate(ctx)).toThrow(HttpException);
      try {
        guardB.canActivate(ctx);
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(err.getResponse().statusCode).toBe(429);
        expect(err.getResponse().retryAfterSeconds).toBeGreaterThanOrEqual(1);
      }
    });

    it('persists rate limits across simulated instance restarts', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ points: 2, duration: 10 });

      // Instance A takes 2 requests (exhausts quota)
      const guardA = new RateLimitGuard(reflector, redisService);
      const ctx = createMockContext('10.0.0.50');

      expect(guardA.canActivate(ctx)).toBe(true);
      expect(guardA.canActivate(ctx)).toBe(true);

      // Simulate Instance A crashing and a newly booted Instance A' taking requests
      const guardANewBoot = new RateLimitGuard(reflector, redisService);
      expect(() => guardANewBoot.canActivate(ctx)).toThrow(HttpException);
    });

    it('isolates authenticated users by trusted identity rather than IP address', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ points: 2, duration: 10 });
      const guard = new RateLimitGuard(reflector, redisService);

      // User 1 on shared corporate IP
      const ctxUser1 = createMockContext('203.0.113.1', { id: 'usr-corp-alice' });
      expect(guard.canActivate(ctxUser1)).toBe(true);
      expect(guard.canActivate(ctxUser1)).toBe(true);
      expect(() => guard.canActivate(ctxUser1)).toThrow(HttpException);

      // User 2 on the SAME corporate IP must NOT be blocked by User 1's exhaustion
      const ctxUser2 = createMockContext('203.0.113.1', { id: 'usr-corp-bob' });
      const resUser2 = guard.canActivate(ctxUser2);
      expect(resUser2).toBe(true);
    });

    it('prevents spoofed X-Forwarded-For headers from bypassing limits on direct connections', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ points: 2, duration: 10 });
      const guard = new RateLimitGuard(reflector, redisService);

      // Attacker connects from public IP 198.51.100.22 (untrusted proxy)
      // and injects varying spoofed X-Forwarded-For headers
      const ctx1 = createMockContext('198.51.100.22', undefined, {
        'x-forwarded-for': '1.1.1.1',
      });
      const ctx2 = createMockContext('198.51.100.22', undefined, {
        'x-forwarded-for': '2.2.2.2',
      });
      const ctx3 = createMockContext('198.51.100.22', undefined, {
        'x-forwarded-for': '3.3.3.3',
      });

      expect(guard.canActivate(ctx1)).toBe(true);
      expect(guard.canActivate(ctx2)).toBe(true);

      // Third request from same physical connection with different spoofed header must be blocked!
      expect(() => guard.canActivate(ctx3)).toThrow(HttpException);
    });

    it('fails closed in production if Redis fails on sensitive auth/login endpoints', async () => {
      const origAppEnv = process.env.APP_ENV;
      const origNodeEnv = process.env.NODE_ENV;
      process.env.APP_ENV = 'production';

      try {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ points: 5, duration: 60 });

        // Broken Redis service
        const brokenRedis = {
          isUsingRealRedis: () => true,
          checkRateLimit: jest.fn().mockRejectedValue(new Error('Connection to Redis lost')),
          resetInMemoryState: jest.fn(),
        } as unknown as RedisService;

        const guard = new RateLimitGuard(reflector, brokenRedis);

        const sensitiveCtx = {
          switchToHttp: () => ({
            getRequest: () => ({
              headers: {},
              socket: { remoteAddress: '127.0.0.1' },
            }),
            getResponse: () => ({ setHeader: jest.fn() }),
          }),
          getHandler: () => ({ name: 'loginFirebase' }),
          getClass: () => ({ name: 'AuthController' }),
        } as unknown as ExecutionContext;

        await expect(guard.canActivate(sensitiveCtx)).rejects.toThrow(
          expect.objectContaining({
            status: HttpStatus.SERVICE_UNAVAILABLE,
          }),
        );
      } finally {
        process.env.APP_ENV = origAppEnv;
        process.env.NODE_ENV = origNodeEnv;
      }
    });
  });

  describe('2. Distributed WebSocket Delivery Tracking Across Independent Gateway Instances', () => {
    let serverA: any;
    let serverB: any;
    let portA: number;
    let portB: number;
    let gatewayA: TrackingRealtimeGateway;
    let gatewayB: TrackingRealtimeGateway;

    // Mock Prisma for tracking order
    const testOrderId = `ord-dist-${Date.now()}`;
    const testCustomerId = 'usr-cust-dist-1';
    const testDriverId = 'usr-driver-dist-1';
    const mockOrder = {
      id: testOrderId,
      orderNumber: 'KD-DIST-001',
      customerId: testCustomerId,
      driverId: testDriverId,
      driverProfileId: 'drv-prof-dist-1',
      status: 'OUT_FOR_DELIVERY',
      arrivedAt: null,
      driverProfile: {
        id: 'drv-prof-dist-1',
        currentLat: 12.9716,
        currentLng: 77.5946,
        currentHeading: 90,
      },
    };

    const mockPrisma = {
      isConnectedToDb: true,
      order: {
        findFirst: jest.fn().mockResolvedValue(mockOrder),
        findUnique: jest.fn().mockResolvedValue(mockOrder),
      },
      driverProfile: {
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          const uid = where.OR[0].firebaseUid;
          if (uid === 'fb-driver') {
            return {
              id: testDriverId,
              role: 'DRIVER',
              driverProfile: { id: 'drv-prof-dist-1' },
            };
          }
          if (uid === 'fb-customer') {
            return {
              id: testCustomerId,
              role: 'CUSTOMER',
            };
          }
          if (uid === 'fb-intruder') {
            return {
              id: 'usr-intruder-1',
              role: 'CUSTOMER',
            };
          }
          return null;
        }),
      },
    } as any;

    const mockFirebase = {
      verifyIdToken: jest.fn().mockImplementation((token: string) => {
        if (token === 'driver-token') return { uid: 'fb-driver' };
        if (token === 'customer-token') return { uid: 'fb-customer' };
        if (token === 'unauthorized-token') return { uid: 'fb-intruder' };
        throw new Error('Invalid token');
      }),
    } as any;

    beforeAll(async () => {
      // 1. Create HTTP Server A and Gateway A
      serverA = createServer();
      await new Promise<void>((resolve) => serverA.listen(0, resolve));
      portA = serverA.address().port;

      const mockHostA = {
        httpAdapter: {
          getHttpServer: () => serverA,
        },
      } as any;

      gatewayA = new TrackingRealtimeGateway(mockHostA, mockPrisma, mockFirebase, redisService);
      gatewayA.onApplicationBootstrap();

      // 2. Create HTTP Server B and Gateway B
      serverB = createServer();
      await new Promise<void>((resolve) => serverB.listen(0, resolve));
      portB = serverB.address().port;

      const mockHostB = {
        httpAdapter: {
          getHttpServer: () => serverB,
        },
      } as any;

      gatewayB = new TrackingRealtimeGateway(mockHostB, mockPrisma, mockFirebase, redisService);
      gatewayB.onApplicationBootstrap();
    });

    afterAll(async () => {
      gatewayA.onModuleDestroy();
      gatewayB.onModuleDestroy();
      await new Promise((resolve) => serverA.close(resolve));
      await new Promise((resolve) => serverB.close(resolve));
    });

    it(
      'cross-instance delivery: Driver on Gateway A broadcasts location to Customer on Gateway B via Redis',
      async () => {
        // Customer connects to Gateway B
        const customerWs = new WebSocket(`ws://127.0.0.1:${portB}/ws/tracking`);
        await new Promise((resolve) => customerWs.on('open', resolve));

        // Customer subscribes to testOrderId on Gateway B
        customerWs.send(
          JSON.stringify({
            type: 'SUBSCRIBE',
            orderId: testOrderId,
            token: 'customer-token',
          }),
        );

        // Verify SUBSCRIBED response received on Gateway B
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('SUBSCRIBE response timeout')), 5000);
          customerWs.on('message', function handler(raw) {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'SUBSCRIBED') {
              clearTimeout(timeout);
              customerWs.off('message', handler);
              expect(msg.orderId).toBe(testOrderId);
              expect(msg.trackingActive).toBe(true);
              resolve();
            }
          });
        });

        // Driver connects to Gateway A
        const driverWs = new WebSocket(`ws://127.0.0.1:${portA}/ws/tracking`);
        await new Promise((resolve) => driverWs.on('open', resolve));

        // Driver subscribes to testOrderId on Gateway A
        driverWs.send(
          JSON.stringify({
            type: 'SUBSCRIBE',
            orderId: testOrderId,
            token: 'driver-token',
          }),
        );

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Driver SUBSCRIBE timeout')), 5000);
          driverWs.on('message', function handler(raw) {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'SUBSCRIBED') {
              clearTimeout(timeout);
              driverWs.off('message', handler);
              resolve();
            }
          });
        });

        // Set up listener on Customer WebSocket (Gateway B) to expect DRIVER_LOCATION
        const customerReceivedPromise = new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Customer DRIVER_LOCATION timeout')), 5000);
          customerWs.on('message', function handler(raw) {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'DRIVER_LOCATION') {
              clearTimeout(timeout);
              customerWs.off('message', handler);
              resolve(msg);
            }
          });
        });

        // Driver emits LOCATION_UPDATE to Gateway A
        const updatedLat = 12.9755;
        const updatedLng = 77.5999;
        driverWs.send(
          JSON.stringify({
            type: 'LOCATION_UPDATE',
            latitude: updatedLat,
            longitude: updatedLng,
            heading: 180,
            accuracy: 4,
            speed: 25,
            etaMinutes: 8,
          }),
        );

        // Verify Customer on Gateway B received the cross-instance update via Redis!
        const receivedMsg = await customerReceivedPromise;
        expect(receivedMsg.type).toBe('DRIVER_LOCATION');
        expect(receivedMsg.orderId).toBe(testOrderId);
        expect(receivedMsg.latitude).toBe(updatedLat);
        expect(receivedMsg.longitude).toBe(updatedLng);
        expect(receivedMsg.heading).toBe(180);
        expect(receivedMsg.etaMinutes).toBe(8);

        // Verify PostgreSQL was updated with the new driver coordinates
        expect(mockPrisma.driverProfile.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'drv-prof-dist-1' },
            data: expect.objectContaining({
              currentLat: updatedLat,
              currentLng: updatedLng,
            }),
          }),
        );

        customerWs.close();
        driverWs.close();
      },
      15000,
    );

    it(
      'rejects unauthorized client attempts to subscribe to another user order with code 4003',
      async () => {
        const intruderWs = new WebSocket(`ws://127.0.0.1:${portB}/ws/tracking`);
        await new Promise((resolve) => intruderWs.on('open', resolve));

        const closePromise = new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Close timeout')), 5000);
          intruderWs.on('close', (code) => {
            clearTimeout(timeout);
            resolve(code);
          });
        });

        intruderWs.send(
          JSON.stringify({
            type: 'SUBSCRIBE',
            orderId: testOrderId,
            token: 'unauthorized-token',
          }),
        );

        const closeCode = await closePromise;
        expect(closeCode).toBe(4003);
      },
      15000,
    );
  });
});
