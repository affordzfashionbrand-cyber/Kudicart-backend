import { Test, TestingModule } from '@nestjs/testing';
import { DispatchService } from '../orders/dispatch.service';
import { DriverOrdersService } from '../driver/driver-orders.service';
import { DriverProfileService } from '../driver/driver-profile.service';
import { DriverTryAndBuyService } from '../driver/driver-try-and-buy.service';
import { PaymentsProcessor } from './processors/payments.processor';
import { OutboxService } from './outbox.service';
import { QueueService } from './queue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachineService } from '../orders/state-machine.service';
import { QueueJobType } from './queue.constants';

describe('Phase 12 — FIFO Re-Entry, Refund Policy Safeguards & Outbox Concurrency', () => {
  let dispatchService: DispatchService;
  let driverOrdersService: DriverOrdersService;
  let driverProfileService: DriverProfileService;
  let driverTryAndBuyService: DriverTryAndBuyService;
  let paymentsProcessor: PaymentsProcessor;
  let outboxService: OutboxService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        StateMachineService,
        DispatchService,
        DriverOrdersService,
        DriverProfileService,
        DriverTryAndBuyService,
        PaymentsProcessor,
        OutboxService,
        {
          provide: QueueService,
          useValue: {
            enqueueNotification: jest.fn().mockResolvedValue({ id: 'job-123' }),
            enqueuePaymentJob: jest.fn().mockResolvedValue({ id: 'pay-123' }),
          },
        },
      ],
    }).compile();

    dispatchService = module.get<DispatchService>(DispatchService);
    driverOrdersService = module.get<DriverOrdersService>(DriverOrdersService);
    driverProfileService = module.get<DriverProfileService>(DriverProfileService);
    driverTryAndBuyService = module.get<DriverTryAndBuyService>(DriverTryAndBuyService);
    paymentsProcessor = module.get<PaymentsProcessor>(PaymentsProcessor);
    outboxService = module.get<OutboxService>(OutboxService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('1. FIFO Re-Entry After Delivery Completion (Section 2)', () => {
    it('consumes availableSince on assignment, keeps occupied driver ineligible, and re-enters at the tail upon completion', async () => {
      const store = prisma.getStore();

      // Setup two online drivers:
      // Driver A entered at 09:00:00 (earlier)
      // Driver B entered at 09:05:00 (later)
      const time0900 = new Date('2026-11-03T09:00:00Z').toISOString();
      const time0905 = new Date('2026-11-03T09:05:00Z').toISOString();

      store.drivers = [
        {
          id: 'drv-A',
          userId: 'usr-A',
          name: 'Driver Alpha',
          isOnline: true,
          kycStatus: 'APPROVED',
          availableSince: time0900,
          completedDeliveries: 0,
        },
        {
          id: 'drv-B',
          userId: 'usr-B',
          name: 'Driver Beta',
          isOnline: true,
          kycStatus: 'APPROVED',
          availableSince: time0905,
          completedDeliveries: 0,
        },
      ];

      // Setup Order 1
      const order1: any = {
        id: 'ord-fifo-1',
        orderNumber: 'ORD-F1',
        status: 'READY_FOR_PICKUP',
        items: [{ id: 'item-1', price: 999, quantity: 1 }],
        history: [],
      };
      store.orders = [order1];

      // 1. Dispatch Order 1: Earliest driver (Driver A) MUST be selected
      const dispatch1 = await dispatchService.dispatchOrderFifo('ord-fifo-1');
      expect(dispatch1.success).toBe(true);
      expect(dispatch1.driver.id).toBe('drv-A');

      // 2. Critical Check: Driver A's availableSince is CONSUMED (set to null) while occupied
      const driverA = store.drivers.find((d: any) => d.id === 'drv-A');
      expect(driverA.availableSince).toBeNull();

      // 3. Setup Order 2 while Driver A is occupied
      const order2: any = {
        id: 'ord-fifo-2',
        orderNumber: 'ORD-F2',
        status: 'READY_FOR_PICKUP',
        items: [{ id: 'item-2', price: 500, quantity: 1 }],
        history: [],
      };
      store.orders.push(order2);

      // GPS update from Driver A during transit does NOT make Driver A eligible
      await driverProfileService.updateLocation('drv-A', { latitude: 12.9716, longitude: 77.5946 });
      expect(driverA.availableSince).toBeNull();

      // 4. Dispatch Order 2: Driver B MUST be selected (Driver A is occupied and has null availableSince)
      const dispatch2 = await dispatchService.dispatchOrderFifo('ord-fifo-2');
      expect(dispatch2.success).toBe(true);
      expect(dispatch2.driver.id).toBe('drv-B');

      const driverB = store.drivers.find((d: any) => d.id === 'drv-B');
      expect(driverB.availableSince).toBeNull();

      // 5. Driver A completes delivery of Order 1 at 10:00:00
      order1.driverId = 'drv-A';
      order1.status = 'OUT_FOR_DELIVERY';
      const deliverRes = await driverOrdersService.deliverOrder('drv-A', 'ord-fifo-1');
      expect(deliverRes.success).toBe(true);
      expect(driverA.completedDeliveries).toBe(1);

      // 6. Critical Check: Driver A now re-entered queue with a NEW timestamp at 10:00:00
      expect(driverA.availableSince).not.toBeNull();
      const driverANewTime = new Date(driverA.availableSince).getTime();

      // 7. Make Driver B complete delivery 2 seconds later at 10:00:02
      order2.driverId = 'drv-B';
      order2.status = 'OUT_FOR_DELIVERY';
      // Simulate slight delay
      await new Promise((resolve) => setTimeout(resolve, 50));
      await driverOrdersService.deliverOrder('drv-B', 'ord-fifo-2');
      const driverBNewTime = new Date(driverB.availableSince).getTime();

      // Driver A completed earlier than Driver B, so Driver A is now ahead of Driver B for Order 3
      expect(driverANewTime).toBeLessThan(driverBNewTime);

      // 8. Order 3 arrives
      const order3: any = {
        id: 'ord-fifo-3',
        orderNumber: 'ORD-F3',
        status: 'READY_FOR_PICKUP',
        items: [{ id: 'item-3', price: 1200, quantity: 1 }],
        history: [],
      };
      store.orders.push(order3);

      const dispatch3 = await dispatchService.dispatchOrderFifo('ord-fifo-3');
      expect(dispatch3.success).toBe(true);
      expect(dispatch3.driver.id).toBe('drv-A');
    });
  });

  describe('2. Try & Buy Refund Policy Safeguards (Section 3)', () => {
    it('blocks automated Try & Buy refunds by default and flags cases as PENDING_REVIEW', async () => {
      // Default environment: ENABLE_AUTO_REFUND is undefined or false
      delete process.env.ENABLE_AUTO_REFUND;

      const mockJob: any = {
        name: QueueJobType.REFUND_PROCESSING,
        data: {
          orderId: 'ord-tb-refund-1',
          amount: 1400,
          isTryAndBuy: true,
        },
      };

      const result = await paymentsProcessor.processJob(mockJob);

      expect(result.processed).toBe(false);
      expect(result.status).toBe('PENDING_REVIEW');
      expect(result.reason).toBe('AUTOMATED_REFUND_POLICY_UNAPPROVED');
    });

    it('requires supervisor confirmation before inventory is reconciled', async () => {
      const store = prisma.getStore();
      const tbOrder: any = {
        id: 'ord-tb-store-1',
        orderNumber: 'ORD-TB-1',
        driverId: 'drv-tb-1',
        isTryAndBuy: true,
        items: [
          { id: 'i1', name: 'Item 1', decision: 'RETURN' },
          { id: 'i2', name: 'Item 2', decision: 'KEEP' },
        ],
        history: [],
      };
      store.orders = [tbOrder];
      store.drivers = [
        {
          id: 'drv-tb-1',
          userId: 'usr-tb-1',
          name: 'Rider TB',
          isOnline: true,
          completedDeliveries: 0,
        },
      ];

      // Reconcile without supervisor confirmation MUST throw BadRequestException
      await expect(
        driverTryAndBuyService.reconcileStoreReturn('drv-tb-1', 'ord-tb-store-1', {
          supervisorConfirmed: false,
        } as any),
      ).rejects.toThrow();

      // With supervisor confirmation, succeeds and updates availableSince
      const reconcileRes = await driverTryAndBuyService.reconcileStoreReturn(
        'drv-tb-1',
        'ord-tb-store-1',
        {
          supervisorConfirmed: true,
          supervisorName: 'Darkstore Lead',
          signature: 'sig_ok',
        } as any,
      );

      expect(reconcileRes.success).toBe(true);
      expect(tbOrder.storeReconciliationStatus).toBe('RECONCILED');
      expect(tbOrder.status).toBe('DELIVERED');
      expect(store.drivers[0].availableSince).not.toBeNull();
    });
  });

  describe('3. Transactional Outbox Concurrency & Leasing (Section 5)', () => {
    it('prevents competing outbox pollers from processing the same event twice', async () => {
      const store = prisma.getStore();
      store.outboxEvents = [
        {
          id: 'evt-atomic-1',
          eventType: 'ORDER_STATUS_NOTIFICATION',
          payload: { orderId: 'ord-123', status: 'DELIVERED' },
          status: 'PENDING',
          attempts: 0,
        },
      ];

      // Poller 1 runs
      const res1 = await outboxService.dispatchPendingEvents();
      expect(res1.processedCount).toBe(1);

      // Poller 2 runs immediately after on the same event
      const res2 = await outboxService.dispatchPendingEvents();
      // Should not re-process because event is already PUBLISHED
      expect(res2.processedCount).toBe(0);
    });
  });
});

