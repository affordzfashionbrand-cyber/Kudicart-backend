jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => []),
  cert: jest.fn(),
}));

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(() => ({
    verifyIdToken: jest.fn(async () => ({
      uid: 'fb-user-123',
      phone_number: '+91 98450 12890',
      email: 'customer@affordz.in',
      name: 'Ananya Sharma',
    })),
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { GoogleRoutesService } from './google-routes.service';
import { TrackingRealtimeGateway } from './tracking-realtime.gateway';
import { OrdersService } from './orders.service';
import { DriverProfileService } from '../driver/driver-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';

describe('KudiCart Real-Time Delivery Tracking & Routes Suite', () => {
  let moduleRef: TestingModule;
  let googleRoutesService: GoogleRoutesService;
  let trackingGateway: TrackingRealtimeGateway;
  let ordersService: OrdersService;
  let driverProfileService: DriverProfileService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.GOOGLE_MAPS_ROUTES_API_KEY = 'test-api-key';

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    googleRoutesService = moduleRef.get<GoogleRoutesService>(GoogleRoutesService);
    trackingGateway = moduleRef.get<TrackingRealtimeGateway>(TrackingRealtimeGateway);
    ordersService = moduleRef.get<OrdersService>(OrdersService);
    driverProfileService = moduleRef.get<DriverProfileService>(DriverProfileService);
    prismaService = moduleRef.get<PrismaService>(PrismaService);

    // Ensure a second driver exists in the in-memory store for authorization testing
    const store = prismaService.getStore();
    if (!store.drivers.some((d: any) => d.id === 'drv-2')) {
      store.drivers.push({
        ...store.drivers[0],
        id: 'drv-2',
        userId: 'usr-driver-2',
        fullName: 'Vikram Singh',
      });
    }
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  describe('GoogleRoutesService', () => {
    it('decodes polyline string into coordinates array correctly', () => {
      // Polyline for (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
      const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
      const decoded = googleRoutesService.decodePolyline(encoded);
      expect(decoded.length).toBe(3);
      expect(decoded[0][0]).toBeCloseTo(38.5, 1);
      expect(decoded[0][1]).toBeCloseTo(-120.2, 1);
    });

    it('generates fallback straight-line reference route when external API fails or is not reached', async () => {
      const origin = { latitude: 12.9716, longitude: 77.5946 };
      const destination = { latitude: 12.9352, longitude: 77.6245 };

      // Mock all attempts to reject
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await googleRoutesService.computeRoute(origin, destination);
      expect(result).toBeDefined();
      expect(result.coordinates.length).toBe(2);
      expect(result.isStraightLineReference).toBe(true);
      expect(result.isRealRoute).toBe(false);
      expect(result.distanceMeters).toBeGreaterThan(0);
      expect(result.durationSeconds).toBeGreaterThan(0);
    });

    it('caches route results for identical coordinates', async () => {
      const origin = { latitude: 12.9100, longitude: 77.5100 };
      const destination = { latitude: 12.9200, longitude: 77.5200 };

      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          routes: [
            {
              polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' },
              distanceMeters: 5200,
              duration: '900s',
            },
          ],
        }),
      } as any));

      const route1 = await googleRoutesService.computeRoute(origin, destination);
      const route2 = await googleRoutesService.computeRoute(origin, destination);

      expect(route1.distanceMeters).toBe(5200);
      expect(route2.distanceMeters).toBe(5200);
      expect(route1.isRealRoute).toBe(true);
      expect(route1.isStraightLineReference).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('OrdersService.trackOrder', () => {
    it('enforces customer authorization: customer cannot track another customer order', async () => {
      const orders = prismaService.getStore().orders;
      if (orders.length > 0) {
        const order = orders[0];
        await expect(
          ordersService.trackOrder(order.id, 'intruder-customer-id', Role.CUSTOMER),
        ).rejects.toThrow(ForbiddenException);
      }
    });

    it('returns deliveryCoordinates, pickupCoordinates, driver, and route for valid customer', async () => {
      const orders = prismaService.getStore().orders;
      if (orders.length > 0) {
        const order = orders[0];
        const tracking = await ordersService.trackOrder(order.id, order.customerId, Role.CUSTOMER);

        expect(tracking).toBeDefined();
        expect(tracking.orderId).toBe(order.id);
        expect(tracking.status).toBe(order.status);
        expect(tracking.deliveryCoordinates).toBeDefined();
        expect(typeof tracking.deliveryCoordinates!.latitude).toBe('number');
        expect(typeof tracking.deliveryCoordinates!.longitude).toBe('number');
        expect(tracking.pickupCoordinates).toBeDefined();
        expect(typeof tracking.pickupCoordinates!.latitude).toBe('number');
        expect(typeof tracking.pickupCoordinates!.longitude).toBe('number');
      }
    });

    it('sanitizes driver data in tracking response: does not leak documents/sensitive fields', async () => {
      const orders = prismaService.getStore().orders;
      if (orders.length > 0) {
        const order = orders[0];
        const tracking = await ordersService.trackOrder(order.id, order.customerId, Role.CUSTOMER);

        if (tracking.driver) {
          expect((tracking.driver as any).documents).toBeUndefined();
          expect((tracking.driver as any).bankDetails).toBeUndefined();
          expect((tracking.driver as any).panNumber).toBeUndefined();
          expect((tracking.driver as any).aadhaarNumber).toBeUndefined();
        }
      }
    });

    it('returns explicit route unavailable state when coordinates are missing', async () => {
      const store = prismaService.getStore();
      // Insert a dummy order with no delivery address and no addressId
      const testOrder = {
        ...store.orders[0],
        id: 'ord-no-coords',
        orderNumber: 'KC-NO-COORDS',
        customerId: 'usr-1',
        deliveryAddress: null,
        addressId: 'nonexistent-addr',
        vendorId: 'nonexistent-vendor',
        status: 'OUT_FOR_DELIVERY',
      };
      store.orders.push(testOrder);

      const tracking = await ordersService.trackOrder('ord-no-coords', 'usr-1', Role.CUSTOMER);
      expect(tracking.route).toBeDefined();
      expect(tracking.route?.routeUnavailable).toBe(true);
      expect(tracking.route?.isRealRoute).toBe(false);
    });
  });

  describe('DriverProfileService.updateLocation', () => {
    it('validates GPS latitude (-90 to 90) and longitude (-180 to 180)', async () => {
      await expect(
        driverProfileService.updateLocation('drv-1', {
          latitude: 999,
          longitude: 77.6,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        driverProfileService.updateLocation('drv-1', {
          latitude: 12.9,
          longitude: -999,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('validates heading (0-360) and speed bounds', async () => {
      await expect(
        driverProfileService.updateLocation('drv-1', {
          latitude: 12.9658,
          longitude: 77.6465,
          heading: 450,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        driverProfileService.updateLocation('drv-1', {
          latitude: 12.9658,
          longitude: 77.6465,
          speed: -5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does NOT modify availableSince timestamp when updating driver location (preserves FIFO dispatch)', async () => {
      const storeDriver = prismaService.getStore().drivers.find((d: any) => d.id === 'drv-1');
      const originalAvailableSince = storeDriver?.availableSince;

      await driverProfileService.updateLocation('drv-1', {
        latitude: 12.9658,
        longitude: 77.6465,
        accuracy: 10,
        speed: 5.5,
      });

      const updatedStoreDriver = prismaService.getStore().drivers.find((d: any) => d.id === 'drv-1');
      expect(updatedStoreDriver?.availableSince).toEqual(originalAvailableSince);
    });

    it('rejects older buffered location updates to prevent overwriting newer persisted state', async () => {
      const now = Date.now();
      // First update with timestamp now
      await driverProfileService.updateLocation('drv-1', {
        latitude: 12.9658,
        longitude: 77.6465,
        timestamp: now,
      });

      // Older buffered update from 5 seconds ago
      const staleRes = await driverProfileService.updateLocation('drv-1', {
        latitude: 12.9700,
        longitude: 77.6500,
        timestamp: now - 5000,
      });

      expect(staleRes.ignoredStaleUpdate).toBe(true);
      const storeDriver = prismaService.getStore().drivers.find((d: any) => d.id === 'drv-1');
      expect(storeDriver?.currentLocation?.latitude).toBe(12.9658);
    });

    it('rejects location update for an order not assigned to the driver', async () => {
      // ord-89241 is assigned to drv-1
      // drv-2 trying to update location with orderId 'ord-89241' must throw ForbiddenException
      await expect(
        driverProfileService.updateLocation('drv-2', {
          latitude: 12.9658,
          longitude: 77.6465,
          orderId: 'ord-89241',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('TrackingRealtimeGateway', () => {
    it('broadcasts location and status events without throwing', () => {
      expect(() => {
        trackingGateway.broadcastLocationUpdate('ord-1', {
          latitude: 12.9658,
          longitude: 77.6465,
          speed: 12.5,
          heading: 90,
          updatedAt: new Date().toISOString(),
        });
      }).not.toThrow();

      expect(() => {
        trackingGateway.broadcastStatusUpdate('ord-1', 'OUT_FOR_DELIVERY');
      }).not.toThrow();
    });
  });
});
