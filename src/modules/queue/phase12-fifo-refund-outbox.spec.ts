import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { PaymentsProcessor } from './processors/payments.processor';
import { DriverTryAndBuyService } from '../driver/driver-try-and-buy.service';

describe('Phase 12 Integration: Outbox SKIP LOCKED, Refunds & Try&Buy Return Reconciliation', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let outboxService: OutboxService;
  let paymentsProcessor: PaymentsProcessor;
  let driverTryAndBuyService: DriverTryAndBuyService;

  const runId = `p12_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdUserIds: string[] = [];
  const createdVendorIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdOutboxIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    outboxService = moduleRef.get(OutboxService);
    paymentsProcessor = moduleRef.get(PaymentsProcessor);
    driverTryAndBuyService = moduleRef.get(DriverTryAndBuyService);
  });

  afterEach(async () => {
    if (createdOutboxIds.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { id: { in: createdOutboxIds } },
      });
      createdOutboxIds.length = 0;
    }
    if (createdOrderIds.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: createdOrderIds } },
      });
      await prisma.ledgerEntry.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.paymentTransaction.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.tryAndBuySession.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: createdOrderIds } },
      });
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
      createdOrderIds.length = 0;
    }
    if (createdProductIds.length > 0) {
      await prisma.product.deleteMany({
        where: { id: { in: createdProductIds } },
      });
      createdProductIds.length = 0;
    }
    if (createdDriverProfileIds.length > 0) {
      await prisma.driverProfile.deleteMany({
        where: { id: { in: createdDriverProfileIds } },
      });
      createdDriverProfileIds.length = 0;
    }
    if (createdVendorIds.length > 0) {
      await prisma.vendor.deleteMany({
        where: { id: { in: createdVendorIds } },
      });
      createdVendorIds.length = 0;
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

  it('dispatches pending OutboxEvents atomically across concurrent workers via SKIP LOCKED', async () => {
    const e1 = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'ORDER',
        aggregateId: `${runId}_agg_1`,
        eventType: QueueJobType.ORDER_STATUS_NOTIFICATION,
        status: 'PENDING',
        payload: { orderId: `${runId}_agg_1`, userId: 'usr-1', status: 'PREPARING' },
      },
    });
    const e2 = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'ORDER',
        aggregateId: `${runId}_agg_2`,
        eventType: QueueJobType.ORDER_STATUS_NOTIFICATION,
        status: 'PENDING',
        payload: { orderId: `${runId}_agg_2`, userId: 'usr-1', status: 'READY_FOR_PICKUP' },
      },
    });
    createdOutboxIds.push(e1.id, e2.id);

    const [workerA, workerB] = await Promise.all([
      outboxService.dispatchPendingEvents(20),
      outboxService.dispatchPendingEvents(20),
    ]);

    expect(workerA.publishedCount + workerB.publishedCount).toBeGreaterThanOrEqual(2);

    const rows = await prisma.outboxEvent.findMany({
      where: { id: { in: [e1.id, e2.id] } },
    });
    expect(rows.every((r) => r.status === 'PUBLISHED' && r.publishedAt !== null)).toBe(true);
  });

  it('executes REFUND_PROCESSING job via PaymentsProcessor and settles REFUND_PENDING orders', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const orderId = `${runId}_rfnd_${suffix}`;
    createdOrderIds.push(orderId);

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-P12R-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.RETURNED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.REFUND_PENDING,
        razorpayPaymentId: `pay_p12_${suffix}`,
        itemTotal: 1500,
        taxes: 75,
        grandTotal: 1575,
      },
    });

    await paymentsProcessor.processPaymentJob({
      id: `job-rfnd-${suffix}`,
      name: QueueJobType.REFUND_PROCESSING,
      data: { orderId },
    } as any);

    const updated = await prisma.order.findUnique({ where: { id: orderId } });
    const tx = await prisma.paymentTransaction.findFirst({
      where: { orderId, transactionType: 'REFUND' },
    });

    expect(updated?.paymentStatus).toBe('REFUNDED');
    expect(tx?.status).toBe('REFUNDED');
  });

  it('enforces supervisor confirmation on Try & Buy store reconciliation, restores returned stock, and posts balanced 12.5% commission ledger', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const drvUserId = `${runId}_du_${suffix}`;
    const vendUserId = `${runId}_vu_${suffix}`;
    const vendId = `${runId}_vnd_${suffix}`;
    const drvProfId = `${runId}_dp_${suffix}`;
    const prodKeepId = `${runId}_pk_${suffix}`;
    const prodRetId = `${runId}_pr_${suffix}`;
    const orderId = `${runId}_tnb_${suffix}`;

    createdUserIds.push(drvUserId, vendUserId);
    createdVendorIds.push(vendId);
    createdDriverProfileIds.push(drvProfId);
    createdProductIds.push(prodKeepId, prodRetId);
    createdOrderIds.push(orderId);

    await prisma.user.createMany({
      data: [
        {
          id: drvUserId,
          firebaseUid: `fb_${drvUserId}`,
          name: `Recon Driver ${suffix}`,
          email: `${drvUserId}@test.affordz.in`,
          phone: `+919833${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
        {
          id: vendUserId,
          firebaseUid: `fb_${vendUserId}`,
          name: `Recon Vendor ${suffix}`,
          email: `${vendUserId}@test.affordz.in`,
          phone: `+919834${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'VENDOR',
          status: 'ACTIVE',
        },
      ],
    });

    await prisma.vendor.create({
      data: {
        id: vendId,
        userId: vendUserId,
        storeName: `Affordz Recon Store ${suffix}`,
        commissionRate: 12.5,
      },
    });

    await prisma.driverProfile.create({
      data: {
        id: drvProfId,
        userId: drvUserId,
        fullName: `Recon Driver ${suffix}`,
        phone: `+919833${Math.floor(100000 + Math.random() * 899999)}`,
        kycStatus: 'APPROVED',
        isOnline: true,
      },
    });

    await prisma.product.createMany({
      data: [
        {
          id: prodKeepId,
          title: `Keep Shirt ${suffix}`,
          brand: 'Affordz Studio',
          description: 'Kept item',
          vendorId: vendId,
          categoryId: 'cat-1',
          price: 1000,
          originalPrice: 1200,
          discount: '16% OFF',
          sizes: ['M'],
          image: 'https://example.com/k.jpg',
          altText: 'Keep Shirt',
          galleryImages: [],
          stockQuantity: 10,
          fulfillmentType: FulfillmentType.DARK_STORE,
          tryAndBuyEligible: true,
        },
        {
          id: prodRetId,
          title: `Return Jacket ${suffix}`,
          brand: 'Affordz Studio',
          description: 'Returned item',
          vendorId: vendId,
          categoryId: 'cat-1',
          price: 2000,
          originalPrice: 2400,
          discount: '16% OFF',
          sizes: ['L'],
          image: 'https://example.com/r.jpg',
          altText: 'Return Jacket',
          galleryImages: [],
          stockQuantity: 3,
          fulfillmentType: FulfillmentType.DARK_STORE,
          tryAndBuyEligible: true,
        },
      ],
    });

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-TNB-${suffix}`,
        customerId: 'usr-1',
        vendorId: vendId,
        driverId: drvUserId,
        driverProfileId: drvProfId,
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.RETURNING,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        razorpayPaymentId: `pay_tnb_${suffix}`,
        isTryAndBuy: true,
        itemTotal: 3000,
        deliveryFee: 0,
        taxes: 150,
        grandTotal: 3150,
        items: {
          create: [
            {
              productId: prodKeepId,
              title: `Keep Shirt ${suffix}`,
              brand: 'KudiCart Studio',
              size: 'M',
              price: 1000,
              quantity: 1,
              image: 'https://example.com/k.jpg',
              tryAndBuyDecision: 'KEEP',
            },
            {
              productId: prodRetId,
              title: `Return Jacket ${suffix}`,
              brand: 'KudiCart Studio',
              size: 'L',
              price: 2000,
              quantity: 1,
              image: 'https://example.com/r.jpg',
              tryAndBuyDecision: 'RETURN',
            },
          ],
        },
      },
    });

    // Missing supervisor confirmation must reject
    await expect(
      driverTryAndBuyService.reconcileStoreReturn(drvProfId, orderId, {
        supervisorConfirmed: false,
      } as any),
    ).rejects.toThrow(BadRequestException);

    const recon = await driverTryAndBuyService.reconcileStoreReturn(drvProfId, orderId, {
      supervisorConfirmed: true,
      note: 'Verified returned tag intact',
    } as any);

    expect(recon.success).toBe(true);
    expect(recon.restoredItemsCount).toBe(1);
    expect(recon.refundQueued).toBe(true);
    expect(recon.order.status).toBe('RETURNED');

    const restoredProd = await prisma.product.findUnique({ where: { id: prodRetId } });
    expect(restoredProd?.stockQuantity).toBe(4);

    const updatedOrder = await prisma.order.findUnique({ where: { id: orderId } });
    expect(updatedOrder?.status).toBe('RETURNED');
    expect(updatedOrder?.paymentStatus).toBe('REFUND_PENDING');

    const ledgerRows = await prisma.ledgerEntry.findMany({ where: { orderId } });
    const rev = ledgerRows.find((l) => l.entryType === 'ORDER_REVENUE');
    const comm = ledgerRows.find((l) => l.entryType === 'COMMISSION_DEDUCTED');
    const payout = ledgerRows.find((l) => l.entryType === 'VENDOR_PAYOUT');

    expect(rev).toBeDefined();
    expect(comm).toBeDefined();
    expect(payout).toBeDefined();
    expect(Number(rev!.amount)).toBe(1000);
    expect(Number(comm!.amount)).toBe(-125);
    expect(Number(payout!.amount)).toBe(875);
    expect(Math.abs(Number(comm!.amount)) + Number(payout!.amount)).toBeCloseTo(
      Number(rev!.amount),
      2,
    );
  });
});
