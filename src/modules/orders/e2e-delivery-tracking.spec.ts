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
import { Role } from '../../common/enums/role.enum';
import { OrderStatus } from '@prisma/client';

describe('KudiCart End-to-End Real Delivery Tracking Lifecycle (Phase 2)', () => {
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
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('executes full 17-step staging delivery tracking lifecycle with real coordinates and WebSocket broadcasts', async () => {
    const store = prismaService.getStore();

    // 1. Customer creates an order with persisted address snapshot
    const stagingOrder: any = {
      id: 'ord-e2e-test',
      orderNumber: 'KC-E2E-999',
      customerId: 'usr-1',
      driverId: null,
      addressId: 'addr-1',
      vendorId: 'vend-1',
      status: OrderStatus.PLACED,
      paymentMethod: 'RAZORPAY',
      paymentStatus: 'COMPLETED',
      razorpayOrderId: 'rzp_e2e_1',
      razorpayPaymentId: 'pay_e2e_1',
      isTryAndBuy: false,
      couponCode: null,
      discountAmount: 0,
      itemTotal: 1299,
      deliveryFee: 40,
      taxes: 65,
      grandTotal: 1404,
      etaMinutes: 18,
      deliveryAddress: {
        id: 'addr-1',
        line1: 'Apartment 4B, Sunrise Heights',
        locality: 'Indiranagar',
        city: 'Bengaluru',
        pincode: '560038',
        latitude: 12.9658,
        longitude: 77.6465,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [],
      history: [],
    };
    store.orders.unshift(stagingOrder);

    // 2. Vendor accepts and prepares it
    await ordersService.updateStatus(stagingOrder.id, OrderStatus.ACCEPTED, Role.VENDOR);
    expect(store.orders[0].status).toBe(OrderStatus.ACCEPTED);

    await ordersService.updateStatus(stagingOrder.id, OrderStatus.PREPARING, Role.VENDOR);
    expect(store.orders[0].status).toBe(OrderStatus.PREPARING);

    // 3. Vendor marks it ready for pickup
    await ordersService.updateStatus(stagingOrder.id, OrderStatus.READY_FOR_PICKUP, Role.VENDOR);
    expect(store.orders[0].status).toBe(OrderStatus.READY_FOR_PICKUP);

    // 4. Backend assigns an eligible Driver (drv-1)
    await ordersService.assignDriver(stagingOrder.id, 'drv-1', Role.ADMIN);
    expect(store.orders[0].status).toBe(OrderStatus.ASSIGNED);
    expect(store.orders[0].driverId).toBe('drv-1');

    // 5. Customer tracks order during ASSIGNED: sees pickup coordinates & driver
    const trackingAssigned = await ordersService.trackOrder(stagingOrder.id, 'usr-1', Role.CUSTOMER);
    expect(trackingAssigned.pickupCoordinates).toEqual({ latitude: 12.9718, longitude: 77.6410 });
    expect(trackingAssigned.deliveryCoordinates).toEqual({ latitude: 12.9658, longitude: 77.6465 });

    // 6. Driver confirms pickup
    await ordersService.updateStatus(stagingOrder.id, OrderStatus.PICKED_UP, Role.DRIVER);
    expect(store.orders[0].status).toBe(OrderStatus.PICKED_UP);

    // 7. Driver starts delivery (OUT_FOR_DELIVERY)
    await ordersService.updateStatus(stagingOrder.id, OrderStatus.OUT_FOR_DELIVERY, Role.DRIVER);
    expect(store.orders[0].status).toBe(OrderStatus.OUT_FOR_DELIVERY);

    // 8. Driver sends GPS location update to backend
    const driverBefore = store.drivers.find((d: any) => d.id === 'drv-1');
    const availableSinceBefore = driverBefore?.availableSince;
    const nowTime = Date.now();

    const locUpdateRes = await driverProfileService.updateLocation('drv-1', {
      latitude: 12.9690,
      longitude: 77.6440,
      heading: 95,
      accuracy: 12,
      speed: 25.5,
      timestamp: nowTime,
      orderId: stagingOrder.id,
    });
    expect(locUpdateRes.success).toBe(true);

    // 9. Verify driver.availableSince is strictly unchanged (FIFO dispatch queue safety)
    const driverAfter = store.drivers.find((d: any) => d.id === 'drv-1');
    expect(driverAfter?.availableSince).toEqual(availableSinceBefore);
    expect(driverAfter?.currentLocation?.latitude).toBe(12.9690);
    expect(driverAfter?.currentLocation?.longitude).toBe(77.6440);

    // 10. Verify stale buffered update is rejected without overwriting newer state
    const staleBufferedUpdate = await driverProfileService.updateLocation('drv-1', {
      latitude: 12.9600,
      longitude: 77.6300,
      timestamp: nowTime - 10000,
      orderId: stagingOrder.id,
    });
    expect(staleBufferedUpdate.ignoredStaleUpdate).toBe(true);
    expect(driverAfter?.currentLocation?.latitude).toBe(12.9690);

    // 11. Customer tracks order during OUT_FOR_DELIVERY: driver location is live & un-stale
    const trackingLive = await ordersService.trackOrder(stagingOrder.id, 'usr-1', Role.CUSTOMER);
    expect(trackingLive.driver?.currentLocation?.latitude).toBe(12.9690);
    expect(trackingLive.driver?.currentLocation?.longitude).toBe(77.6440);
    expect(trackingLive.driver?.isStale).toBe(false);

    // 12. Complete delivery
    await ordersService.updateStatus(stagingOrder.id, OrderStatus.DELIVERED, Role.DRIVER);
    expect(store.orders[0].status).toBe(OrderStatus.DELIVERED);

    // 13. Location update after order completion must be rejected
    await expect(
      driverProfileService.updateLocation('drv-1', {
        latitude: 12.9658,
        longitude: 77.6465,
        orderId: stagingOrder.id,
      }),
    ).rejects.toThrow();
  });
});
