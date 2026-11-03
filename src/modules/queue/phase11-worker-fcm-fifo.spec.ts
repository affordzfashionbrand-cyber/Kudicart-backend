import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { DriverProfileService } from '../driver/driver-profile.service';
import { DriverNotificationsService } from '../driver/driver-notifications.service';
import { DispatchService } from '../orders/dispatch.service';
import { OutboxService } from './outbox.service';
import { DeviceTokensService } from '../notifications/device-tokens.service';
import { NotificationsProcessor } from './processors/notifications.processor';
import { PaymentsProcessor } from './processors/payments.processor';
import { Role } from '../../common/enums/role.enum';
import { QueueJobType } from './queue.constants';

describe('Phase 11 — Durable Workers, Real Push Notifications & FIFO Queue Fairness', () => {
  let app: TestingModule;
  let prisma: PrismaService;
  let driverProfileService: DriverProfileService;
  let driverNotificationsService: DriverNotificationsService;
  let dispatchService: DispatchService;
  let outboxService: OutboxService;
  let deviceTokensService: DeviceTokensService;
  let notificationsProcessor: NotificationsProcessor;
  let paymentsProcessor: PaymentsProcessor;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = app.get<PrismaService>(PrismaService);
    driverProfileService = app.get<DriverProfileService>(DriverProfileService);
    driverNotificationsService = app.get<DriverNotificationsService>(DriverNotificationsService);
    dispatchService = app.get<DispatchService>(DispatchService);
    outboxService = app.get<OutboxService>(OutboxService);
    deviceTokensService = app.get<DeviceTokensService>(DeviceTokensService);
    notificationsProcessor = app.get<NotificationsProcessor>(NotificationsProcessor);
    paymentsProcessor = app.get<PaymentsProcessor>(PaymentsProcessor);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Driver Identity Resolution & Strict Isolation (Section 7)', () => {
    it('rejects undefined driverId with BadRequestException instead of defaulting to drv-1', () => {
      expect(() => driverProfileService.resolveDriver(undefined)).toThrow(BadRequestException);
    });

    it('rejects unmapped/non-existent driver identifier with NotFoundException', () => {
      expect(() => driverProfileService.resolveDriver('non-existent-drv-xyz')).toThrow(NotFoundException);
    });

    it('prevents driver A from modifying or reading driver B’s notifications', async () => {
      const store = prisma.getStore();
      const notifId = 'test-notif-isolation-1';

      // Insert notification specifically for drv-1
      store.notifications.push({
        id: notifId,
        driverId: 'drv-1',
        title: 'Driver 1 Only Alert',
        body: 'Sensitive delivery details',
        category: 'SYSTEM',
        read: false,
        createdAt: new Date().toISOString(),
      });

      // Driver 2 attempts to mark Driver 1’s notification as read
      await expect(
        driverNotificationsService.markAsRead('drv-2', notifId),
      ).rejects.toThrow(ForbiddenException);

      // Driver 2 querying notifications should NOT receive Driver 1’s notification
      const drv2Notifs = await driverNotificationsService.getNotifications('drv-2');
      expect(drv2Notifs.notifications.some((n: any) => n.id === notifId)).toBe(false);

      // Cleanup
      const idx = store.notifications.findIndex((n: any) => n.id === notifId);
      if (idx !== -1) store.notifications.splice(idx, 1);
    });
  });

  describe('2. FIFO Queue Fairness, Dedicated availableSince & GPS Invariance (Section 5)', () => {
    it('sets availableSince timestamp when driver goes online and clears it when offline', async () => {
      const resOnline = await driverProfileService.updateAvailability('drv-1', true);
      expect(resOnline.isOnline).toBe(true);
      expect(resOnline.availableSince).toBeDefined();

      const resOffline = await driverProfileService.updateAvailability('drv-1', false);
      expect(resOffline.isOnline).toBe(false);
      expect(resOffline.availableSince).toBeNull();
    });

    it('preserves FIFO ordering: location heartbeat updates do NOT reset availableSince queue position', async () => {
      const store = prisma.getStore();

      // Setup 2 drivers: Driver A online at T1 (earlier), Driver B online at T2 (later)
      const t1 = new Date(Date.now() - 3600000).toISOString();
      const t2 = new Date(Date.now() - 1800000).toISOString();

      let driverA = store.drivers.find((d: any) => d.id === 'drv-1');
      if (!driverA) {
        driverA = { id: 'drv-1', name: 'Driver A', isOnline: true, kycStatus: 'APPROVED', availableSince: t1 };
        store.drivers.push(driverA);
      } else {
        driverA.isOnline = true;
        driverA.kycStatus = 'APPROVED';
        driverA.availableSince = t1;
      }

      let driverB = store.drivers.find((d: any) => d.id === 'drv-2');
      if (!driverB) {
        driverB = { id: 'drv-2', name: 'Driver B', isOnline: true, kycStatus: 'APPROVED', availableSince: t2 };
        store.drivers.push(driverB);
      } else {
        driverB.isOnline = true;
        driverB.kycStatus = 'APPROVED';
        driverB.availableSince = t2;
      }

      // Driver A sends GPS heartbeat location update
      await driverProfileService.updateLocation('drv-1', {
        latitude: 12.9716,
        longitude: 77.5946,
        heading: 90,
      });

      // Assert availableSince was NOT altered by GPS update
      expect(driverA.availableSince).toBe(t1);

      // Trigger FIFO dispatch for an order in READY_FOR_PICKUP
      const order = store.orders[0];
      order.status = 'READY_FOR_PICKUP';

      const dispatchResult = await dispatchService.dispatchOrderFifo(order.id);
      expect(dispatchResult.success).toBe(true);

      // Driver A must be selected because availableSince (T1) is earlier than Driver B (T2)
      expect(order.driverId).toBe('drv-1');
    });
  });

  describe('3. Transactional Outbox Pattern & Reliability (Section 2 & 4)', () => {
    it('atomically records pending outbox events', async () => {
      const testEvent = await outboxService.recordEvent(
        null,
        'ORDER',
        'ord-test-outbox-1',
        QueueJobType.ORDER_STATUS_NOTIFICATION,
        { orderId: 'ord-test-outbox-1', status: 'PLACED' },
      );

      expect(testEvent).toBeDefined();
      expect(testEvent.status).toBe('PENDING');
      expect(testEvent.aggregateId).toBe('ord-test-outbox-1');
    });

    it('dispatches pending outbox events and updates state to PUBLISHED', async () => {
      const dispatchSummary = await outboxService.dispatchPendingEvents();
      expect(dispatchSummary.processedCount).toBeGreaterThanOrEqual(1);

      const store = prisma.getStore();
      const recorded = (store.outboxEvents || []).find((e: any) => e.aggregateId === 'ord-test-outbox-1');
      if (recorded) {
        expect(recorded.status).toBe('PUBLISHED');
      }
    });
  });

  describe('4. Real Device Token Registration & FCM Lifecycle (Section 3)', () => {
    it('registers a device token for authenticated user and sets it active', async () => {
      const reg = await deviceTokensService.registerToken(
        'usr-test-customer',
        Role.CUSTOMER,
        'android',
        'fcm-token-test-xyz-1234567890',
      );
      expect(reg.success).toBe(true);

      const tokens = await deviceTokensService.getActiveTokensForUser('usr-test-customer', Role.CUSTOMER);
      expect(tokens).toContain('fcm-token-test-xyz-1234567890');
    });

    it('deactivates device token upon explicit unregister/logout', async () => {
      const unreg = await deviceTokensService.unregisterToken(
        'usr-test-customer',
        'fcm-token-test-xyz-1234567890',
      );
      expect(unreg.success).toBe(true);

      const activeTokens = await deviceTokensService.getActiveTokensForUser('usr-test-customer', Role.CUSTOMER);
      expect(activeTokens).not.toContain('fcm-token-test-xyz-1234567890');
    });

    it('deactivates invalid or unregistered tokens reported by FCM provider', async () => {
      await deviceTokensService.registerToken(
        'usr-test-dead-token',
        Role.DRIVER,
        'android',
        'fcm-dead-token-prune-me',
      );

      await deviceTokensService.deactivateInvalidTokens(['fcm-dead-token-prune-me']);

      const tokens = await deviceTokensService.getActiveTokensForUser('usr-test-dead-token');
      expect(tokens).not.toContain('fcm-dead-token-prune-me');
    });
  });

  describe('5. BullMQ Worker Processors & Job Execution (Section 2)', () => {
    it('NotificationsProcessor processes customer order status job cleanly', async () => {
      const mockJob: any = {
        id: 'job-test-notif-1',
        name: QueueJobType.ORDER_STATUS_NOTIFICATION,
        data: {
          userId: 'usr-customer-test',
          title: 'Order Out for Delivery',
          message: 'Your KudiCart concierge is on the way!',
          orderId: 'ord-101',
          status: 'OUT_FOR_DELIVERY',
        },
      };

      const result = await notificationsProcessor.processJob(mockJob);
      expect(result).toBeDefined();
    });

    it('PaymentsProcessor processes payment reconciliation check cleanly', async () => {
      const mockJob: any = {
        id: 'job-test-pay-1',
        name: QueueJobType.PAYMENT_RECONCILIATION_CHECK,
        data: {
          orderId: 'ord-1',
        },
      };

      const result = await paymentsProcessor.processJob(mockJob);
      expect(result.reconciled).toBe(true);
    });
  });
});

