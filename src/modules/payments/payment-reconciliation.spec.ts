import { Test, TestingModule } from '@nestjs/testing';
import {
  FulfillmentType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersDomainModule } from '../orders/orders-domain.module';
import { TrackingModule } from '../orders/tracking.module';
import { QueueModule } from '../queue/queue.module';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { RazorpayClientService } from './razorpay-client.service';

describe('PaymentReconciliationService (15m Expiry, Stock Restore, Refunds)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: PaymentReconciliationService;
  let razorpayClient: RazorpayClientService;

  const runId = `recon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdGroupIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdProductIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, NotificationsModule, OrdersDomainModule, TrackingModule, QueueModule],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    service = moduleRef.get<PaymentReconciliationService>(PaymentReconciliationService);
    razorpayClient = moduleRef.get<RazorpayClientService>(RazorpayClientService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();

    if (createdOrderIds.length > 0) {
      await prisma.paymentTransaction.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: [...createdOrderIds, ...createdGroupIds] } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
      createdOrderIds.length = 0;
    }
    if (createdGroupIds.length > 0) {
      await prisma.paymentTransaction.deleteMany({
        where: { checkoutGroupId: { in: createdGroupIds } },
      });
      await prisma.checkoutGroup.deleteMany({
        where: { id: { in: createdGroupIds } },
      });
      createdGroupIds.length = 0;
    }
    if (createdProductIds.length > 0) {
      await prisma.product.deleteMany({
        where: { id: { in: createdProductIds } },
      });
      createdProductIds.length = 0;
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('marks expired unpaid RAZORPAY orders as FAILED and restores reserved stock (DCR-009)', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const prodId = `${runId}_prd_${suffix}`;
    const groupId = `${runId}_grp_${suffix}`;
    const expiredOrderId = `${runId}_exp_${suffix}`;
    const activeOrderId = `${runId}_act_${suffix}`;

    createdProductIds.push(prodId);
    createdGroupIds.push(groupId);
    createdOrderIds.push(expiredOrderId, activeOrderId);

    await prisma.product.create({
      data: {
        id: prodId,
        title: `Recon Stock Product ${suffix}`,
        brand: 'KudiCart Test',
        description: 'Temporary product for stock restore verification',
        vendorId: 'vend-1',
        categoryId: 'cat-1',
        price: 500,
        originalPrice: 600,
        discount: '16% OFF',
        sizes: ['M'],
        image: 'https://example.com/p.jpg',
        altText: 'Recon stock test product',
        galleryImages: [],
        stockQuantity: 4,
        fulfillmentType: FulfillmentType.DARK_STORE,
      },
    });

    await prisma.checkoutGroup.create({
      data: {
        id: groupId,
        groupNumber: `CGR-${suffix}`.toUpperCase(),
        customerId: 'usr-1',
        itemTotal: 1000,
        grandTotal: 1050,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PENDING,
      },
    });

    await prisma.order.create({
      data: {
        id: expiredOrderId,
        orderNumber: `KC-EXP-${suffix}`,
        checkoutGroupId: groupId,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.PLACED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() - 3 * 60_000),
        itemTotal: 1000,
        taxes: 50,
        grandTotal: 1050,
        items: {
          create: [
            {
              productId: prodId,
              title: `Recon Stock Product ${suffix}`,
              brand: 'KudiCart Test',
              size: 'M',
              price: 500,
              quantity: 2,
              image: 'https://example.com/p.jpg',
            },
          ],
        },
      },
    });

    await prisma.order.create({
      data: {
        id: activeOrderId,
        orderNumber: `KC-ACT-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.PLACED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() + 12 * 60_000),
        itemTotal: 500,
        taxes: 25,
        grandTotal: 525,
      },
    });

    const summary = await service.reconcile();

    expect(summary.success).toBe(true);
    expect(summary.expiredCount).toBeGreaterThanOrEqual(1);
    expect(summary.restoredStockItems).toBeGreaterThanOrEqual(2);

    const expiredOrder = await prisma.order.findUnique({ where: { id: expiredOrderId } });
    const expiredGroup = await prisma.checkoutGroup.findUnique({ where: { id: groupId } });
    const restoredProduct = await prisma.product.findUnique({ where: { id: prodId } });
    const activeOrder = await prisma.order.findUnique({ where: { id: activeOrderId } });
    const historyRows = await prisma.orderStatusHistory.findMany({
      where: { orderId: expiredOrderId },
    });

    expect(expiredOrder?.status).toBe('FAILED');
    expect(expiredOrder?.paymentStatus).toBe('FAILED');
    expect(expiredGroup?.paymentStatus).toBe('FAILED');
    expect(restoredProduct?.stockQuantity).toBe(6);
    expect(activeOrder?.status).toBe('PLACED');
    expect(activeOrder?.paymentStatus).toBe('PENDING');
    expect(historyRows.some((h) => h.status === 'FAILED')).toBe(true);
  });

  it('recovers missed Razorpay captures from gateway before expiring orders', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const orderId = `${runId}_rec_${suffix}`;
    const rzpOrderId = `order_rec_${runId}_${suffix}`;
    const capturedPayId = `pay_rec_${runId}_${suffix}`;

    createdOrderIds.push(orderId);

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-RC-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.PLACED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PENDING,
        razorpayOrderId: rzpOrderId,
        expiresAt: new Date(Date.now() - 2 * 60_000),
        itemTotal: 900,
        taxes: 45,
        grandTotal: 945,
      },
    });

    jest.spyOn(razorpayClient, 'fetchOrderPayments').mockImplementation(async (rzpId) => {
      if (rzpId === rzpOrderId) {
        return [{ id: capturedPayId, status: 'captured', amount: 94500, currency: 'INR', method: 'card' }];
      }
      return [];
    });

    const summary = await service.reconcile();
    expect(summary.reconciledCount).toBeGreaterThanOrEqual(1);

    const updated = await prisma.order.findUnique({ where: { id: orderId } });
    expect(updated?.status).toBe('PLACED');
    expect(updated?.paymentStatus).toBe('COMPLETED');
  });

  it('processes REFUND_PENDING orders to REFUNDED and writes REFUND ledger transaction', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const orderId = `${runId}_rfnd_${suffix}`;
    const paymentId = `pay_for_rfnd_${runId}_${suffix}`;

    createdOrderIds.push(orderId);

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-RFND-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.CANCELLED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.REFUND_PENDING,
        razorpayPaymentId: paymentId,
        itemTotal: 1100,
        taxes: 55,
        grandTotal: 1155,
      },
    });

    const summary = await service.reconcile();
    expect(summary.refundsCompletedCount).toBeGreaterThanOrEqual(1);

    const updated = await prisma.order.findUnique({ where: { id: orderId } });
    const refundTx = await prisma.paymentTransaction.findFirst({
      where: { orderId, transactionType: 'REFUND' },
    });

    expect(updated?.paymentStatus).toBe('REFUNDED');
    expect(refundTx?.status).toBe('REFUNDED');
    expect(refundTx?.amount).toBe(1155);
  });
});
