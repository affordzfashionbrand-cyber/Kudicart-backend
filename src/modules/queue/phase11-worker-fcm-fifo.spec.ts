import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  FulfillmentType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from './outbox.service';
import { QueueJobType } from './queue.constants';
import { NotificationsProcessor } from './processors/notifications.processor';
import { PaymentsProcessor } from './processors/payments.processor';
import { DeviceTokensService } from '../notifications/device-tokens.service';
import { DriverProfileService } from '../driver/driver-profile.service';
import { DriverNotificationsService } from '../driver/driver-notifications.service';
import { OrdersService } from '../orders/orders.service';
import { Role } from '../../common/enums/role.enum';

describe('Phase 11 Integration: Workers, FCM Tokens, Driver Readiness & Notifications (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let outboxService: OutboxService;
  let notificationsProcessor: NotificationsProcessor;
  let paymentsProcessor: PaymentsProcessor;
  let deviceTokensService: DeviceTokensService;
  let driverProfileService: DriverProfileService;
  let driverNotificationsService: DriverNotificationsService;
  let ordersService: OrdersService;

  const runId = `p11_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdUserIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdOutboxIds: string[] = [];
  const createdNotifIds: string[] = [];
  const createdDriverNotifIds: string[] = [];
  const createdDeviceTokens: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    outboxService = moduleRef.get(OutboxService);
    notificationsProcessor = moduleRef.get(NotificationsProcessor);
    paymentsProcessor = moduleRef.get(PaymentsProcessor);
    deviceTokensService = moduleRef.get(DeviceTokensService);
    driverProfileService = moduleRef.get(DriverProfileService);
    driverNotificationsService = moduleRef.get(DriverNotificationsService);
    ordersService = moduleRef.get(OrdersService);
  });

  afterEach(async () => {
    if (createdDeviceTokens.length > 0) {
      await prisma.deviceToken.deleteMany({
        where: { token: { in: createdDeviceTokens } },
      });
      createdDeviceTokens.length = 0;
    }
    if (createdNotifIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { id: { in: createdNotifIds } },
      });
      createdNotifIds.length = 0;
    }
    if (createdDriverNotifIds.length > 0) {
      await prisma.driverNotification.deleteMany({
        where: { id: { in: createdDriverNotifIds } },
      });
      createdDriverNotifIds.length = 0;
    }
    if (createdOutboxIds.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { id: { in: createdOutboxIds } },
      });
      createdOutboxIds.length = 0;
    }
    if (createdOrderIds.length > 0) {
      await prisma.notification.deleteMany({
        where: {
          userId: 'usr-1',
          createdAt: { gte: new Date(Date.now() - 120_000) },
          title: { contains: runId },
        },
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
    await moduleRef?.close();
  });

  it('tracks driver availability timestamp for KYC-approved drivers and blocks assigning unapproved KYC drivers (D-006)', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const pendingUserId = `${runId}_du_${suffix}`;
    const pendingProfId = `${runId}_dp_${suffix}`;
    const approvedUserId = `${runId}_au_${suffix}`;
    const approvedProfId = `${runId}_ap_${suffix}`;
    const orderId = `${runId}_ord_${suffix}`;
    createdUserIds.push(pendingUserId, approvedUserId);
    createdDriverProfileIds.push(pendingProfId, approvedProfId);
    createdOrderIds.push(orderId);

    await prisma.user.createMany({
      data: [
        {
          id: pendingUserId,
          firebaseUid: `fb_${pendingUserId}`,
          name: `Pending Driver ${suffix}`,
          email: `${pendingUserId}@test.kudicart.in`,
          phone: `+919800${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
        {
          id: approvedUserId,
          firebaseUid: `fb_${approvedUserId}`,
          name: `Approved Driver ${suffix}`,
          email: `${approvedUserId}@test.kudicart.in`,
          phone: `+919801${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      ],
    });

    await prisma.driverProfile.createMany({
      data: [
        {
          id: pendingProfId,
          userId: pendingUserId,
          fullName: `Pending Driver ${suffix}`,
          phone: `+919800${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'PENDING',
          isOnline: false,
        },
        {
          id: approvedProfId,
          userId: approvedUserId,
          fullName: `Approved Driver ${suffix}`,
          phone: `+919801${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'APPROVED',
          isOnline: false,
        },
      ],
    });

    // Pending KYC driver cannot go online
    await expect(driverProfileService.updateAvailability(pendingProfId, true)).rejects.toThrow(
      BadRequestException,
    );

    // Approved KYC driver goes online and records availableSince timestamp
    const onlineRes = await driverProfileService.updateAvailability(approvedProfId, true);
    expect(onlineRes.isOnline).toBe(true);
    const updatedDriver = await prisma.driverProfile.findUnique({ where: { id: approvedProfId } });
    expect(updatedDriver?.availableSince).toBeTruthy();

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-P11-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.READY_FOR_PICKUP,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        itemTotal: 900,
        taxes: 45,
        grandTotal: 945,
      },
    });

    // Non-admin caller must be forbidden (D-006 manual admin dispatch only)
    await expect(
      ordersService.assignDriver(orderId, approvedProfId, Role.VENDOR, 'usr-vendor-1'),
    ).rejects.toThrow(ForbiddenException);

    // Admin cannot assign driver until KYC is APPROVED
    await expect(
      ordersService.assignDriver(orderId, pendingProfId, Role.ADMIN, 'usr-admin-1', 'Amara'),
    ).rejects.toThrow(BadRequestException);
  });

  it('records Outbox events and processes Notification + Payment expiry jobs against PostgreSQL', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const orderId = `${runId}_exp_${suffix}`;
    createdOrderIds.push(orderId);

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-WKR-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.PLACED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() - 2 * 60_000),
        itemTotal: 600,
        taxes: 30,
        grandTotal: 630,
      },
    });

    const outbox = await outboxService.recordEvent(
      'ORDER',
      orderId,
      QueueJobType.ORDER_STATUS_NOTIFICATION,
      {
        orderId,
        orderNumber: `KC-WKR-${suffix}`,
        userId: 'usr-1',
        status: 'PLACED',
        title: `Order Update ${runId}`,
        message: 'Testing worker persistence',
      },
    );
    if (outbox?.id) {
      createdOutboxIds.push(outbox.id);
    }

    const notifResult: any = await notificationsProcessor.processNotificationJob({
      id: `job-n-${suffix}`,
      name: QueueJobType.ORDER_STATUS_NOTIFICATION,
      data: {
        orderId,
        orderNumber: `KC-WKR-${suffix}`,
        userId: 'usr-1',
        status: 'PLACED',
        title: `Worker Persisted ${runId}`,
        message: 'Persisted from NotificationsProcessor',
      },
    } as any);

    expect(notifResult.delivered).toBe(true);
    expect(notifResult.notificationId).toBeDefined();
    if (notifResult.notificationId) {
      createdNotifIds.push(notifResult.notificationId);
    }

    await paymentsProcessor.processPaymentJob({
      id: `job-p-${suffix}`,
      name: QueueJobType.ORDER_EXPIRY_CHECK,
      data: { orderId },
    } as any);

    const expiredOrder = await prisma.order.findUnique({ where: { id: orderId } });
    expect(expiredOrder?.status).toBe('FAILED');
    expect(expiredOrder?.paymentStatus).toBe('FAILED');
  });

  it('registers, queries, unregisters, and prunes invalid FCM device tokens', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const userId = `${runId}_toku_${suffix}`;
    const tokenA = `fcm-token-a-${runId}-${suffix}`;
    const tokenDead = `fcm-token-dead-${runId}-${suffix}`;

    createdUserIds.push(userId);
    createdDeviceTokens.push(tokenA, tokenDead);

    await prisma.user.create({
      data: {
        id: userId,
        firebaseUid: `fb_${userId}`,
        name: `Token User ${suffix}`,
        email: `${userId}@test.kudicart.in`,
        phone: `+919811${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });

    const reg = await deviceTokensService.registerToken(userId, Role.CUSTOMER, 'android', tokenA);
    expect(reg.success).toBe(true);
    expect(await deviceTokensService.getActiveTokensForUser(userId, Role.CUSTOMER)).toContain(tokenA);

    await deviceTokensService.unregisterToken(userId, tokenA);
    expect(await deviceTokensService.getActiveTokensForUser(userId, Role.CUSTOMER)).not.toContain(
      tokenA,
    );

    await deviceTokensService.registerToken(userId, Role.CUSTOMER, 'ios', tokenDead);
    await deviceTokensService.deactivateInvalidTokens([tokenDead]);
    expect(await deviceTokensService.getActiveTokensForUser(userId, Role.CUSTOMER)).not.toContain(
      tokenDead,
    );
  });

  it('isolates driver notification feeds strictly per driver profile', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const driver2UserId = `${runId}_n2u_${suffix}`;
    const driver2ProfId = `${runId}_n2p_${suffix}`;
    createdUserIds.push(driver2UserId);
    createdDriverProfileIds.push(driver2ProfId);

    await prisma.user.create({
      data: {
        id: driver2UserId,
        firebaseUid: `fb_${driver2UserId}`,
        name: `Driver Two ${suffix}`,
        email: `${driver2UserId}@test.kudicart.in`,
        phone: `+919822${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'DRIVER',
        status: 'ACTIVE',
      },
    });
    await prisma.driverProfile.create({
      data: {
        id: driver2ProfId,
        userId: driver2UserId,
        fullName: `Driver Two ${suffix}`,
        phone: `+919822${Math.floor(100000 + Math.random() * 899999)}`,
      },
    });

    const n1 = await prisma.notification.create({
      data: {
        userId: 'usr-driver-1',
        role: Role.DRIVER as any,
        title: `Only Driver 1 ${runId}`,
        body: 'Secret assignment for drv-1',
        category: 'SYSTEM',
        isRead: false,
      },
    });
    const n2 = await prisma.notification.create({
      data: {
        userId: driver2UserId,
        role: Role.DRIVER as any,
        title: `Only Driver 2 ${runId}`,
        body: 'Private note for driver 2',
        category: 'SYSTEM',
        isRead: false,
      },
    });
    createdNotifIds.push(n1.id, n2.id);

    const feed1 = await driverNotificationsService.getNotifications('drv-1');
    const feed2 = await driverNotificationsService.getNotifications(driver2ProfId);

    expect(feed1.notifications.some((n: any) => n.id === n1.id)).toBe(true);
    expect(feed1.notifications.some((n: any) => n.id === n2.id)).toBe(false);
    expect(feed2.notifications.some((n: any) => n.id === n2.id)).toBe(true);
    expect(feed2.notifications.some((n: any) => n.id === n1.id)).toBe(false);
  });
});
