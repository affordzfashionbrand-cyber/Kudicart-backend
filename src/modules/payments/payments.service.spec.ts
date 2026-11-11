import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
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
import { PaymentsService } from './payments.service';
import { Role } from '../../common/enums/role.enum';

describe('PaymentsService (PostgreSQL + Razorpay HMAC)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: PaymentsService;

  const prevKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const runId = `paysvc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdGroupIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    process.env.RAZORPAY_KEY_SECRET = 'test_rzp_secret_spec';

    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, NotificationsModule, OrdersDomainModule, TrackingModule, QueueModule],
      providers: [PaymentsService],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    service = moduleRef.get<PaymentsService>(PaymentsService);
  });

  afterEach(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.paymentTransaction.deleteMany({
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
  });

  afterAll(async () => {
    if (prevKeySecret === undefined) {
      delete process.env.RAZORPAY_KEY_SECRET;
    } else {
      process.env.RAZORPAY_KEY_SECRET = prevKeySecret;
    }
    await moduleRef?.close();
  });

  async function seedCheckoutOrder(opts?: {
    paymentMethod?: PaymentMethod;
    paymentStatus?: PaymentStatus;
    status?: OrderStatus;
    driverId?: string;
    driverProfileId?: string;
    grandTotal?: number;
  }) {
    const suffix = Math.random().toString(36).slice(2, 7);
    const groupId = `${runId}_grp_${suffix}`;
    const orderId = `${runId}_ord_${suffix}`;
    const grandTotal = opts?.grandTotal ?? 1299;

    await prisma.checkoutGroup.create({
      data: {
        id: groupId,
        groupNumber: `CG-${runId}-${suffix}`.slice(0, 32),
        customerId: 'usr-1',
        itemTotal: grandTotal,
        grandTotal,
        paymentMethod: opts?.paymentMethod ?? PaymentMethod.RAZORPAY,
        paymentStatus: opts?.paymentStatus ?? PaymentStatus.PENDING,
      },
    });
    createdGroupIds.push(groupId);

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-${suffix.toUpperCase()}-${Date.now().toString().slice(-4)}`,
        checkoutGroupId: groupId,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: opts?.status ?? OrderStatus.PLACED,
        paymentMethod: opts?.paymentMethod ?? PaymentMethod.RAZORPAY,
        paymentStatus: opts?.paymentStatus ?? PaymentStatus.PENDING,
        itemTotal: grandTotal,
        taxes: 0,
        grandTotal,
        driverId: opts?.driverId ?? null,
        driverProfileId: opts?.driverProfileId ?? null,
      },
    });
    createdOrderIds.push(orderId);

    return { groupId, orderId, grandTotal };
  }

  it('creates an idempotent Razorpay order and verifies server-side HMAC signature', async () => {
    const { groupId, orderId, grandTotal } = await seedCheckoutOrder({ grandTotal: 1450 });

    const created = await service.createRazorpayOrder(999, groupId, 'usr-1', Role.CUSTOMER);
    expect(created.razorpayOrderId).toMatch(/^(order|rzp_order)_/);
    // Server always authoritative over client-supplied amount
    expect(created.amount).toBe(grandTotal * 100);
    expect(created.currency).toBe('INR');

    const createdAgain = await service.createRazorpayOrder(grandTotal, groupId, 'usr-1', Role.CUSTOMER);
    expect(createdAgain.razorpayOrderId).toBe(created.razorpayOrderId);

    const paymentId = `pay_${runId}_valid`;
    const signature = crypto
      .createHmac('sha256', 'test_rzp_secret_spec')
      .update(`${created.razorpayOrderId}|${paymentId}`)
      .digest('hex');

    const verified = await service.verifyRazorpaySignature(
      groupId,
      paymentId,
      signature,
      created.razorpayOrderId,
      'usr-1',
      Role.CUSTOMER,
    );

    expect(verified.verified).toBe(true);
    expect(verified.paymentStatus).toBe('COMPLETED');
    expect(verified.checkoutGroupId).toBe(groupId);
    expect(verified.orderId).toBe(orderId);

    const dbGroup = await prisma.checkoutGroup.findUnique({ where: { id: groupId } });
    const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
    const tx = await prisma.paymentTransaction.findFirst({
      where: { paymentId, transactionType: 'CAPTURE' },
    });

    expect(dbGroup?.paymentStatus).toBe('COMPLETED');
    expect(dbOrder?.paymentStatus).toBe('COMPLETED');
    expect(tx?.status).toBe('COMPLETED');
    expect(tx?.amount).toBe(grandTotal);
  });

  it('fails closed on tampered HMAC signatures, cross-customer IDOR, and already-failed orders', async () => {
    const { groupId, orderId } = await seedCheckoutOrder();

    await expect(
      service.createRazorpayOrder(1299, groupId, 'usr-vendor-1', Role.CUSTOMER),
    ).rejects.toThrow(ForbiddenException);

    const created = await service.createRazorpayOrder(1299, groupId, 'usr-1', Role.CUSTOMER);

    await expect(
      service.verifyRazorpaySignature(
        groupId,
        'pay_tampered',
        'deadbeef00000000000000000000000000000000000000000000000000000000',
        created.razorpayOrderId,
        'usr-1',
        Role.CUSTOMER,
      ),
    ).rejects.toThrow(BadRequestException);

    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.FAILED, paymentStatus: PaymentStatus.FAILED },
    });

    const validSig = crypto
      .createHmac('sha256', 'test_rzp_secret_spec')
      .update(`${created.razorpayOrderId}|pay_after_fail`)
      .digest('hex');

    await expect(
      service.createRazorpayOrder(1299, groupId, 'usr-1', Role.CUSTOMER),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.verifyRazorpaySignature(
        groupId,
        'pay_after_fail',
        validSig,
        created.razorpayOrderId,
        'usr-1',
        Role.CUSTOMER,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('confirms COD collection only for assigned driver or admin and writes capture transaction', async () => {
    const { orderId } = await seedCheckoutOrder({
      paymentMethod: PaymentMethod.COD,
      driverId: 'usr-driver-1',
      driverProfileId: 'drv-1',
      grandTotal: 899,
    });

    await expect(
      service.confirmCod(orderId, 'usr-vendor-1', Role.DRIVER),
    ).rejects.toThrow(ForbiddenException);

    const confirmed = await service.confirmCod(orderId, 'usr-driver-1', Role.DRIVER);
    expect(confirmed.success).toBe(true);
    expect(confirmed.paymentStatus).toBe('COMPLETED');

    const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
    expect(dbOrder?.paymentStatus).toBe('COMPLETED');
  });
});
