import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { DeviceTokensService } from './device-tokens.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { DriverNotificationsService } from '../driver/driver-notifications.service';
import { NotificationsProcessor } from '../queue/processors/notifications.processor';
import { QueueJobType } from '../queue/queue.constants';
import { Role } from '../../common/enums/role.enum';

describe('Phase 3: Production Native Push Notifications & FCM Integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let notificationsService: NotificationsService;
  let deviceTokensService: DeviceTokensService;
  let firebaseAdmin: FirebaseAdminService;
  let driverNotificationsService: DriverNotificationsService;
  let notificationsProcessor: NotificationsProcessor;

  const runId = `p3_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdUserIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdDeviceTokens: string[] = [];
  const createdNotificationIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    notificationsService = moduleRef.get(NotificationsService);
    deviceTokensService = moduleRef.get(DeviceTokensService);
    firebaseAdmin = (notificationsService as any).firebaseAdmin || moduleRef.get(FirebaseAdminService);
    driverNotificationsService = moduleRef.get(DriverNotificationsService);
    notificationsProcessor = moduleRef.get(NotificationsProcessor);
  });

  afterEach(async () => {
    if (createdDeviceTokens.length > 0) {
      await prisma.deviceToken.deleteMany({
        where: { token: { in: createdDeviceTokens } },
      });
      createdDeviceTokens.length = 0;
    }
    if (createdNotificationIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { id: { in: createdNotificationIds } },
      });
      createdNotificationIds.length = 0;
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

  it('registers and unregisters real FCM device tokens with persistent records and active state', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const userId = `${runId}_usr_${suffix}`;
    const token = `fcm_device_token_${runId}_${suffix}`;

    createdUserIds.push(userId);
    createdDeviceTokens.push(token);

    await prisma.user.create({
      data: {
        id: userId,
        firebaseUid: `fb_${userId}`,
        name: `Notification Tester ${suffix}`,
        email: `${userId}@kudicart.test`,
        phone: `+919911${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });

    // 1. Register token for customer
    const regResult = await deviceTokensService.registerToken(
      userId,
      Role.CUSTOMER,
      'android',
      token,
    );
    expect(regResult.success).toBe(true);
    expect(regResult.token).toBe(token);
    expect(regResult.isActive).toBe(true);

    // 2. Query active tokens for user
    const activeTokens = await deviceTokensService.getActiveTokensForUser(userId, Role.CUSTOMER);
    expect(activeTokens).toContain(token);

    // 3. Unregister token
    const unregResult = await deviceTokensService.unregisterToken(userId, token);
    expect(unregResult.success).toBe(true);
    expect(unregResult.deactivatedCount).toBe(1);

    // 4. Verify token is no longer active
    const postUnregTokens = await deviceTokensService.getActiveTokensForUser(userId, Role.CUSTOMER);
    expect(postUnregTokens).not.toContain(token);
  });

  it('selects appropriate notification channels (kudicart_driver_alerts vs affordz_critical_alerts) based on role', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const customerUserId = `${runId}_cust_${suffix}`;
    const driverUserId = `${runId}_drv_${suffix}`;
    const custToken = `fcm_cust_tok_${runId}_${suffix}`;
    const drvToken = `fcm_drv_tok_${runId}_${suffix}`;

    createdUserIds.push(customerUserId, driverUserId);
    createdDeviceTokens.push(custToken, drvToken);

    await prisma.user.createMany({
      data: [
        {
          id: customerUserId,
          firebaseUid: `fb_${customerUserId}`,
          name: `Customer ${suffix}`,
          email: `${customerUserId}@kudicart.test`,
          phone: `+919922${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
        {
          id: driverUserId,
          firebaseUid: `fb_${driverUserId}`,
          name: `Driver ${suffix}`,
          email: `${driverUserId}@kudicart.test`,
          phone: `+919933${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      ],
    });

    await deviceTokensService.registerToken(customerUserId, Role.CUSTOMER, 'android', custToken);
    await deviceTokensService.registerToken(driverUserId, Role.DRIVER, 'android', drvToken);

    const multicastSpy = jest.spyOn(firebaseAdmin, 'sendMulticastPush');

    // 1. Send push to customer
    const custResult = await notificationsService.sendNotification({
      recipientUserId: customerUserId,
      recipientRole: Role.CUSTOMER,
      title: 'Order Out for Delivery',
      body: 'Your pilot is on the way!',
      category: 'ORDER',
      data: { orderId: `ord_${suffix}`, status: 'OUT_FOR_DELIVERY' },
    });

    expect(custResult.delivered).toBe(true);
    if (custResult.notificationId) {
      createdNotificationIds.push(custResult.notificationId);
    }
    expect(multicastSpy).toHaveBeenCalledWith(
      expect.arrayContaining([custToken]),
      expect.objectContaining({
        channelId: 'affordz_critical_alerts',
        title: 'Order Out for Delivery',
      }),
    );

    // 2. Send push to driver
    const drvResult = await notificationsService.sendNotification({
      recipientUserId: driverUserId,
      recipientRole: Role.DRIVER,
      title: 'New Delivery Assigned',
      body: `Order #KC-${suffix} has been assigned to you`,
      category: 'DELIVERY',
      data: { orderId: `ord_${suffix}`, status: 'ASSIGNED' },
    });

    expect(drvResult.delivered).toBe(true);
    if (drvResult.notificationId) {
      createdNotificationIds.push(drvResult.notificationId);
    }
    expect(multicastSpy).toHaveBeenCalledWith(
      expect.arrayContaining([drvToken]),
      expect.objectContaining({
        channelId: 'kudicart_driver_alerts',
        title: 'New Delivery Assigned',
      }),
    );

    multicastSpy.mockRestore();
  });

  it('deactivates invalid / expired tokens reported by FCM multicast delivery', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const userId = `${runId}_stale_${suffix}`;
    const liveToken = `fcm_live_${runId}_${suffix}`;
    const deadToken = `fcm_dead_${runId}_${suffix}`;

    createdUserIds.push(userId);
    createdDeviceTokens.push(liveToken, deadToken);

    await prisma.user.create({
      data: {
        id: userId,
        firebaseUid: `fb_${userId}`,
        name: `Stale Token User ${suffix}`,
        email: `${userId}@kudicart.test`,
        phone: `+919944${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });

    await deviceTokensService.registerToken(userId, Role.CUSTOMER, 'android', liveToken);
    await deviceTokensService.registerToken(userId, Role.CUSTOMER, 'android', deadToken);

    // Mock sendMulticastPush returning deadToken in invalidTokens
    jest.spyOn(firebaseAdmin, 'sendMulticastPush').mockResolvedValueOnce({
      successCount: 1,
      failureCount: 1,
      invalidTokens: [deadToken],
    });

    const res = await notificationsService.sendNotification({
      recipientUserId: userId,
      recipientRole: Role.CUSTOMER,
      title: 'Test Multicast Cleanup',
      body: 'Cleaning up uninstalled tokens',
    });

    if (res.notificationId) {
      createdNotificationIds.push(res.notificationId);
    }

    const remainingTokens = await deviceTokensService.getActiveTokensForUser(userId, Role.CUSTOMER);
    expect(remainingTokens).toContain(liveToken);
    expect(remainingTokens).not.toContain(deadToken);

    jest.restoreAllMocks();
  });

  it('processes BullMQ driver assignment job and dispatches push with correct payload to driver', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const driverUserId = `${runId}_wdrv_${suffix}`;
    const driverProfId = `${runId}_wprof_${suffix}`;
    const token = `fcm_wdrv_${runId}_${suffix}`;

    createdUserIds.push(driverUserId);
    createdDriverProfileIds.push(driverProfId);
    createdDeviceTokens.push(token);

    await prisma.user.create({
      data: {
        id: driverUserId,
        firebaseUid: `fb_${driverUserId}`,
        name: `Worker Driver ${suffix}`,
        email: `${driverUserId}@kudicart.test`,
        phone: `+919955${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'DRIVER',
        status: 'ACTIVE',
      },
    });

    await prisma.driverProfile.create({
      data: {
        id: driverProfId,
        userId: driverUserId,
        fullName: `Worker Driver ${suffix}`,
        phone: `+919955${Math.floor(100000 + Math.random() * 899999)}`,
        kycStatus: 'APPROVED',
        isOnline: true,
      },
    });

    await deviceTokensService.registerToken(driverUserId, Role.DRIVER, 'android', token);

    const multicastSpy = jest.spyOn(firebaseAdmin, 'sendMulticastPush');

    const jobResult: any = await notificationsProcessor.processNotificationJob({
      name: QueueJobType.DRIVER_ASSIGNMENT_NOTIFICATION,
      data: {
        driverUserId,
        orderId: `ord_assign_${suffix}`,
        orderNumber: `KC-JOB-${suffix}`,
        title: 'New Urgent Delivery',
        message: 'Order #KC-JOB-123 ready for pickup',
      },
    });

    expect(jobResult.delivered).toBe(true);
    if (jobResult.notificationId) {
      createdNotificationIds.push(jobResult.notificationId);
    }

    expect(multicastSpy).toHaveBeenCalledWith(
      expect.arrayContaining([token]),
      expect.objectContaining({
        title: 'New Urgent Delivery',
        channelId: 'kudicart_driver_alerts',
        data: expect.objectContaining({
          orderId: `ord_assign_${suffix}`,
          status: 'ASSIGNED',
        }),
      }),
    );

    multicastSpy.mockRestore();
  });
});
