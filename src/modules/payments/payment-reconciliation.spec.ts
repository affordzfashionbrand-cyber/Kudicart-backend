import { Test, TestingModule } from '@nestjs/testing';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PaymentReconciliationService (Checklist Item 12 & D-020)', () => {
  let reconciler: PaymentReconciliationService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentReconciliationService, PrismaService],
    }).compile();

    reconciler = module.get<PaymentReconciliationService>(PaymentReconciliationService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('reconciles pending orders with valid gateway references older than threshold', async () => {
    const store: any = prisma.getStore();
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();

    const testOrder = {
      id: 'ord-recon-1',
      orderNumber: 'AF-REC-1',
      customerId: 'usr-1',
      status: 'PLACED',
      paymentStatus: 'PENDING',
      razorpayOrderId: 'rzp_order_recon_123',
      grandTotal: 1999,
      createdAt: threeMinAgo,
      items: [{ productId: 'prod-1', quantity: 1, price: 1999 }],
    };

    store.orders = store.orders || [];
    store.orders.push(testOrder as any);

    const report = await reconciler.reconcile({ pendingThresholdMinutes: 2 });

    expect(report.success).toBe(true);
    expect(report.reconciledCount).toBeGreaterThanOrEqual(1);

    const found = store.orders.find((o: any) => o.id === 'ord-recon-1');
    expect(found.paymentStatus).toBe('COMPLETED');
    expect(found.status).toBe('ACCEPTED');

    // Audit log was recorded
    const audit = (store.auditLogs || []).find((a: any) =>
      a.action.includes('PAYMENT_RECONCILED'),
    );
    expect(audit).toBeDefined();
  });

  it('expires abandoned orders older than 30 minutes and restores inventory stock', async () => {
    const store: any = prisma.getStore();
    const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();

    // Setup initial product stock
    const product = (store.products || [])[0];
    const initialStock = product.stockQuantity;

    const testOrder = {
      id: 'ord-abandoned-1',
      orderNumber: 'AF-ABN-1',
      customerId: 'usr-1',
      status: 'PLACED',
      paymentStatus: 'PENDING',
      grandTotal: 1299,
      createdAt: fortyMinAgo,
      items: [{ productId: product.id, quantity: 2, price: 1299 }],
    };

    store.orders = store.orders || [];
    store.orders.push(testOrder as any);

    const report = await reconciler.reconcile({ expiryThresholdMinutes: 30 });

    expect(report.success).toBe(true);
    expect(report.expiredCount).toBeGreaterThanOrEqual(1);
    expect(report.restoredStockItems).toBeGreaterThanOrEqual(2);

    const found = store.orders.find((o: any) => o.id === 'ord-abandoned-1');
    expect(found.paymentStatus).toBe('EXPIRED');
    expect(found.status).toBe('CANCELLED');

    // Product stock was restored
    expect(product.stockQuantity).toBe(initialStock + 2);
  });
});
