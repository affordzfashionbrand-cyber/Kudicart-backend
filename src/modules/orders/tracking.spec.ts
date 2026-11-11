import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FulfillmentType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import * as WebSocket from 'ws';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { DriverProfileService } from '../driver/driver-profile.service';
import { DriverOrdersService } from '../driver/driver-orders.service';
import { TrackingRealtimeGateway } from './tracking-realtime.gateway';
import { createJwtToken } from '../../common/utils/crypto.util';
import { Role } from '../../common/enums/role.enum';

describe('Order Tracking & Single-Port /ws/tracking Gateway (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let driverProfileService: DriverProfileService;
  let driverOrdersService: DriverOrdersService;
  let gateway: TrackingRealtimeGateway;
  let baseUrl: string;
  let wsUrl: string;

  const runId = `trk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdUserIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdAddressIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/ws/tracking`;

    prisma = moduleRef.get(PrismaService);
    ordersService = moduleRef.get(OrdersService);
    driverProfileService = moduleRef.get(DriverProfileService);
    driverOrdersService = moduleRef.get(DriverOrdersService);
    gateway = moduleRef.get(TrackingRealtimeGateway);
  });

  afterEach(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: createdOrderIds } },
      });
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: createdOrderIds } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
      createdOrderIds.length = 0;
    }
    if (createdAddressIds.length > 0) {
      await prisma.address.deleteMany({
        where: { id: { in: createdAddressIds } },
      });
      createdAddressIds.length = 0;
    }
    if (createdDriverProfileIds.length > 0) {
      await prisma.driverProfile.deleteMany({
        where: { id: { in: createdDriverProfileIds } },
      });
      createdDriverProfileIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await app?.close();
    await moduleRef?.close();
  });

  async function seedTrackingScenario(status: OrderStatus = OrderStatus.OUT_FOR_DELIVERY) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const drvUserId = `${runId}_du_${suffix}`;
    const drvProfId = `${runId}_dp_${suffix}`;
    const addrId = `${runId}_addr_${suffix}`;
    const orderId = `${runId}_ord_${suffix}`;

    createdUserIds.push(drvUserId);
    createdDriverProfileIds.push(drvProfId);
    createdAddressIds.push(addrId);
    createdOrderIds.push(orderId);

    await prisma.user.create({
      data: {
        id: drvUserId,
        firebaseUid: `fb_${drvUserId}`,
        name: `Track Rider ${suffix}`,
        email: `${drvUserId}@test.kudicart.in`,
        phone: `+919844${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'DRIVER',
        status: 'ACTIVE',
      },
    });

    await prisma.driverProfile.create({
      data: {
        id: drvProfId,
        userId: drvUserId,
        fullName: `Track Rider ${suffix}`,
        phone: `+919844${Math.floor(100000 + Math.random() * 899999)}`,
        kycStatus: 'APPROVED',
        isOnline: true,
        currentLat: 12.9716,
        currentLng: 77.5946,
        currentHeading: 45,
      },
    });

    await prisma.address.create({
      data: {
        id: addrId,
        userId: 'usr-1',
        label: 'Home',
        recipientName: 'Ananya Sharma',
        recipientPhone: '+919845012890',
        line1: '100 Feet Road, Indiranagar',
        locality: 'Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560038',
        latitude: 12.9784,
        longitude: 77.6408,
      },
    });

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-TRK-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        driverId: drvUserId,
        driverProfileId: drvProfId,
        addressId: addrId,
        deliveryAddress: {
          recipientName: 'Ananya Sharma',
          line1: '100 Feet Road',
          city: 'Bengaluru',
          lat: 12.9784,
          lng: 77.6408,
        },
        fulfillmentType: FulfillmentType.DARK_STORE,
        status,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        itemTotal: 1200,
        taxes: 60,
        grandTotal: 1260,
      },
    });

    return { drvUserId, drvProfId, orderId };
  }

  it('returns live driverLocation/driverCoords/customerCoords and records DCR-005 arrivedAt without leaving OUT_FOR_DELIVERY', async () => {
    const { drvProfId, orderId } = await seedTrackingScenario(OrderStatus.OUT_FOR_DELIVERY);

    await driverProfileService.updateLocation(drvProfId, {
      latitude: 12.9751,
      longitude: 77.6122,
      heading: 90,
      speed: 24,
      orderId,
    });

    const tracking = await ordersService.trackOrder(orderId, 'usr-1', Role.CUSTOMER);
    expect(tracking.orderId).toBe(orderId);
    expect(tracking.trackingActive).toBe(true);
    expect(tracking.customerCoords).toMatchObject({ latitude: 12.9784, longitude: 77.6408 });
    expect(tracking.driverLocation).toMatchObject({ latitude: 12.9751, longitude: 77.6122 });
    expect(tracking.driverCoords).toMatchObject({ latitude: 12.9751, longitude: 77.6122 });
    expect(tracking.isArrived).toBe(false);
    expect(Array.isArray(tracking.milestones)).toBe(true);

    // DCR-005: markArrived sets arrivedAt timestamp while keeping Order.status === OUT_FOR_DELIVERY
    const arrivedRes = await driverOrdersService.markArrived(drvProfId, orderId);
    expect(arrivedRes.success).toBe(true);
    expect(arrivedRes.arrivedAt).toBeTruthy();

    const afterArrival = await ordersService.trackOrder(orderId, 'usr-1', Role.CUSTOMER);
    expect(afterArrival.status).toBe('OUT_FOR_DELIVERY');
    expect(afterArrival.isArrived).toBe(true);
    expect(afterArrival.arrivedAt).toBeTruthy();
  });

  it('rejects unauthenticated or unauthorized /ws/tracking subscriptions and broadcasts room updates to owner', async () => {
    const { orderId } = await seedTrackingScenario(OrderStatus.OUT_FOR_DELIVERY);
    expect(baseUrl).toContain('http://127.0.0.1:');

    const outsiderId = `${runId}_outsider_${Math.random().toString(36).slice(2, 6)}`;
    createdUserIds.push(outsiderId);
    await prisma.user.create({
      data: {
        id: outsiderId,
        firebaseUid: `fb_${outsiderId}`,
        name: 'Outsider Customer',
        email: `${outsiderId}@test.kudicart.in`,
        phone: `+919843${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });

    const customerToken = 'test-firebase-id-token:usr-1:+919845012890:ananya@kudicart.in';
    const outsiderToken = `test-firebase-id-token:${outsiderId}:+919843000001:${outsiderId}@test.kudicart.in`;

    // 1. Unauthenticated SUBSCRIBE closes with 4001
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', orderId }));
      });
      ws.on('close', (code) => {
        try {
          expect(code).toBe(4001);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      ws.on('error', reject);
    });

    // 2. Cross-customer SUBSCRIBE closes with 4003 Forbidden
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', orderId, token: outsiderToken }));
      });
      ws.on('close', (code) => {
        try {
          expect(code).toBe(4003);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      ws.on('error', reject);
    });

    // 3. Authorized owner receives SUBSCRIBED and live DRIVER_LOCATION broadcast
    const receivedMessages: any[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(customerToken)}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', orderId }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg);

        if (msg.type === 'SUBSCRIBED') {
          gateway.broadcastLocationUpdate(orderId, {
            latitude: 12.9765,
            longitude: 77.621,
            heading: 75,
            updatedAt: new Date().toISOString(),
          });
        } else if (msg.type === 'DRIVER_LOCATION') {
          ws.close();
          try {
            expect(msg.latitude).toBeCloseTo(12.9765);
            expect(msg.longitude).toBeCloseTo(77.621);
            resolve();
          } catch (err) {
            reject(err);
          }
        }
      });
      ws.on('error', reject);
    });

    expect(receivedMessages.some((m) => m.type === 'SUBSCRIBED')).toBe(true);
    expect(receivedMessages.some((m) => m.type === 'DRIVER_LOCATION')).toBe(true);
  });
});
