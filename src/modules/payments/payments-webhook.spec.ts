import * as crypto from 'crypto';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FulfillmentType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import * as express from 'express';
import request = require('supertest');
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersDomainModule } from '../orders/orders-domain.module';
import { TrackingModule } from '../orders/tracking.module';
import { QueueModule } from '../queue/queue.module';
import { PaymentsWebhookController } from './payments-webhook.controller';

describe('PaymentsWebhookController (HMAC Raw-Body & Deduplication)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let prisma: PrismaService;

  const webhookSecret = 'test_webhook_secret_spec';
  const prevWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const runId = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const createdGroupIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, NotificationsModule, OrdersDomainModule, TrackingModule, QueueModule],
      controllers: [PaymentsWebhookController],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(
      express.json({
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    if (createdEventIds.length > 0) {
      await prisma.webhookEvent.deleteMany({
        where: { eventId: { in: createdEventIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: [...createdGroupIds, ...createdOrderIds, ...createdEventIds] } },
      });
      createdEventIds.length = 0;
    }
    if (createdGroupIds.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: createdGroupIds } },
      });
      await prisma.paymentTransaction.deleteMany({
        where: { checkoutGroupId: { in: createdGroupIds } },
      });
    }
    if (createdOrderIds.length > 0) {
      await prisma.paymentTransaction.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.tryAndBuySession.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
      createdOrderIds.length = 0;
    }
    if (createdGroupIds.length > 0) {
      await prisma.checkoutGroup.deleteMany({
        where: { id: { in: createdGroupIds } },
      });
      createdGroupIds.length = 0;
    }
  });

  afterAll(async () => {
    if (prevWebhookSecret === undefined) {
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    } else {
      process.env.RAZORPAY_WEBHOOK_SECRET = prevWebhookSecret;
    }
    await app?.close();
    await moduleRef?.close();
  });

  function signPayload(raw: string): string {
    return crypto.createHmac('sha256', webhookSecret).update(raw, 'utf8').digest('hex');
  }

  it('rejects requests without a valid HMAC signature with 401 Unauthorized', async () => {
    const raw = JSON.stringify({ event: 'payment.captured', payload: {} });

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'invalid_signature')
      .send(raw)
      .expect(401);

    const ctrl = moduleRef.get(PaymentsWebhookController);
    await expect(
      ctrl.handleRazorpayWebhook({ rawBody: Buffer.from(raw), body: {} }, undefined),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('processes signed payment.captured webhooks across CheckoutGroup split orders and deduplicates repeats', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const groupId = `${runId}_grp_${suffix}`;
    const ord1 = `${runId}_ord1_${suffix}`;
    const ord2 = `${runId}_ord2_${suffix}`;
    const rzpOrderId = `order_${runId}_${suffix}`;
    const rzpPayId = `pay_${runId}_${suffix}`;
    const eventId = `evt_${runId}_cap_${suffix}`;

    createdGroupIds.push(groupId);
    createdOrderIds.push(ord1, ord2);
    createdEventIds.push(eventId);

    await prisma.checkoutGroup.create({
      data: {
        id: groupId,
        groupNumber: `CG-${suffix}`.toUpperCase(),
        customerId: 'usr-1',
        itemTotal: 2000,
        grandTotal: 2100,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PENDING,
        razorpayOrderId: rzpOrderId,
      },
    });

    await prisma.order.createMany({
      data: [
        {
          id: ord1,
          orderNumber: `KC-W1-${suffix}`,
          checkoutGroupId: groupId,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          addressId: 'addr-1',
          fulfillmentType: FulfillmentType.DARK_STORE,
          status: OrderStatus.PLACED,
          paymentMethod: PaymentMethod.RAZORPAY,
          paymentStatus: PaymentStatus.PENDING,
          razorpayOrderId: rzpOrderId,
          itemTotal: 1000,
          taxes: 50,
          grandTotal: 1050,
        },
        {
          id: ord2,
          orderNumber: `KC-W2-${suffix}`,
          checkoutGroupId: groupId,
          customerId: 'usr-1',
          vendorId: 'vend-affordz-official',
          addressId: 'addr-1',
          fulfillmentType: FulfillmentType.VENDOR,
          status: OrderStatus.PLACED,
          paymentMethod: PaymentMethod.RAZORPAY,
          paymentStatus: PaymentStatus.PENDING,
          razorpayOrderId: rzpOrderId,
          itemTotal: 1000,
          taxes: 50,
          grandTotal: 1050,
        },
      ],
    });

    const bodyObj = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpPayId,
            order_id: rzpOrderId,
            amount: 210000,
            currency: 'INR',
            method: 'upi',
          },
        },
      },
    };
    const raw = JSON.stringify(bodyObj);
    const sig = signPayload(raw);

    const first = await request(app.getHttpServer())
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .set('x-razorpay-event-id', eventId)
      .send(raw)
      .expect(200);

    expect(first.body).toEqual({
      received: true,
      duplicate: false,
      eventId,
      eventType: 'payment.captured',
    });

    const updatedOrders = await prisma.order.findMany({
      where: { id: { in: [ord1, ord2] } },
    });
    expect(updatedOrders.every((o) => o.paymentStatus === 'COMPLETED')).toBe(true);
    expect(updatedOrders.every((o) => o.razorpayPaymentId === rzpPayId)).toBe(true);

    const outboxRows = await prisma.outboxEvent.findMany({
      where: { aggregateId: groupId },
    });
    expect(outboxRows).toHaveLength(1);

    const second = await request(app.getHttpServer())
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .set('x-razorpay-event-id', eventId)
      .send(raw)
      .expect(200);

    expect(second.body.duplicate).toBe(true);

    const outboxAfterDup = await prisma.outboxEvent.findMany({
      where: { aggregateId: groupId },
    });
    expect(outboxAfterDup).toHaveLength(1);
  });

  it('handles signed payment.failed and refund.processed webhooks accurately', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const groupId = `${runId}_fgrp_${suffix}`;
    const ordId = `${runId}_ford_${suffix}`;
    const rzpOrderId = `order_f_${runId}_${suffix}`;
    const rzpPayId = `pay_rfnd_${runId}_${suffix}`;
    const evtFail = `evt_fail_${runId}_${suffix}`;
    const evtRfnd = `evt_rfnd_${runId}_${suffix}`;

    createdGroupIds.push(groupId);
    createdOrderIds.push(ordId);
    createdEventIds.push(evtFail, evtRfnd);

    await prisma.checkoutGroup.create({
      data: {
        id: groupId,
        groupNumber: `CGF-${suffix}`.toUpperCase(),
        customerId: 'usr-1',
        itemTotal: 800,
        grandTotal: 840,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PENDING,
        razorpayOrderId: rzpOrderId,
      },
    });

    await prisma.order.create({
      data: {
        id: ordId,
        orderNumber: `KC-RF-${suffix}`,
        checkoutGroupId: groupId,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.PLACED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PENDING,
        razorpayOrderId: rzpOrderId,
        itemTotal: 800,
        taxes: 40,
        grandTotal: 840,
      },
    });

    const failRaw = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: `pay_fail_${suffix}`,
            order_id: rzpOrderId,
            amount: 84000,
            error_description: 'Insufficient funds',
          },
        },
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signPayload(failRaw))
      .set('x-razorpay-event-id', evtFail)
      .send(failRaw)
      .expect(200);

    const failedOrder = await prisma.order.findUnique({ where: { id: ordId } });
    expect(failedOrder?.paymentStatus).toBe('FAILED');

    await prisma.order.update({
      where: { id: ordId },
      data: {
        paymentStatus: PaymentStatus.REFUND_PENDING,
        razorpayPaymentId: rzpPayId,
      },
    });

    const refundRaw = JSON.stringify({
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: `rfnd_${suffix}`,
            payment_id: rzpPayId,
            amount: 84000,
            currency: 'INR',
          },
        },
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signPayload(refundRaw))
      .set('x-razorpay-event-id', evtRfnd)
      .send(refundRaw)
      .expect(200);

    const refundedOrder = await prisma.order.findUnique({ where: { id: ordId } });
    expect(refundedOrder?.paymentStatus).toBe('REFUNDED');
  });

  it('scopes partial refund.processed webhooks in a split CheckoutGroup to only the target child order', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const groupId = `${runId}_sgrp_${suffix}`;
    const ordA = `${runId}_sordA_${suffix}`;
    const ordB = `${runId}_sordB_${suffix}`;
    const rzpOrderId = `order_s_${runId}_${suffix}`;
    const rzpPayId = `pay_s_${runId}_${suffix}`;
    const evtPartialRfnd = `evt_${runId}_prf_${suffix}`;

    const failedGroupId = `${runId}_fgrp_cap_${suffix}`;
    const ordCancelled = `${runId}_cord_${suffix}`;
    const rzpCapOrderId = `order_c_${runId}_${suffix}`;
    const rzpCapPayId = `pay_c_${runId}_${suffix}`;
    const evtCapCancelled = `evt_${runId}_ccap_${suffix}`;

    createdGroupIds.push(groupId, failedGroupId);
    createdOrderIds.push(ordA, ordB, ordCancelled);
    createdEventIds.push(evtPartialRfnd, evtCapCancelled);

    await prisma.checkoutGroup.create({
      data: {
        id: groupId,
        groupNumber: `CG-S-${suffix}`.toUpperCase(),
        customerId: 'usr-1',
        itemTotal: 1300,
        grandTotal: 1350,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        razorpayOrderId: rzpOrderId,
        razorpayPaymentId: rzpPayId,
      },
    });

    await prisma.order.createMany({
      data: [
        {
          id: ordA,
          orderNumber: `KC-SA-${suffix}`,
          checkoutGroupId: groupId,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          addressId: 'addr-1',
          fulfillmentType: FulfillmentType.DARK_STORE,
          status: OrderStatus.CANCELLED,
          paymentMethod: PaymentMethod.RAZORPAY,
          paymentStatus: PaymentStatus.COMPLETED,
          razorpayOrderId: rzpOrderId,
          razorpayPaymentId: rzpPayId,
          itemTotal: 420,
          taxes: 30,
          grandTotal: 450,
        },
        {
          id: ordB,
          orderNumber: `KC-SB-${suffix}`,
          checkoutGroupId: groupId,
          customerId: 'usr-1',
          vendorId: 'vend-affordz-official',
          addressId: 'addr-1',
          fulfillmentType: FulfillmentType.VENDOR,
          status: OrderStatus.PLACED,
          paymentMethod: PaymentMethod.RAZORPAY,
          paymentStatus: PaymentStatus.COMPLETED,
          razorpayOrderId: rzpOrderId,
          razorpayPaymentId: rzpPayId,
          itemTotal: 850,
          taxes: 50,
          grandTotal: 900,
        },
      ],
    });

    const partialRefundRaw = JSON.stringify({
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: `rfnd_${runId}_${suffix}`,
            payment_id: rzpPayId,
            amount: 45000,
            currency: 'INR',
            notes: { orderId: ordA },
          },
        },
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signPayload(partialRefundRaw))
      .set('x-razorpay-event-id', evtPartialRfnd)
      .send(partialRefundRaw)
      .expect(200);

    const [updatedA, updatedB, updatedGroup] = await Promise.all([
      prisma.order.findUnique({ where: { id: ordA } }),
      prisma.order.findUnique({ where: { id: ordB } }),
      prisma.checkoutGroup.findUnique({ where: { id: groupId } }),
    ]);

    expect(updatedA?.paymentStatus).toBe('REFUNDED');
    expect(updatedB?.paymentStatus).toBe('COMPLETED');
    expect(updatedGroup?.paymentStatus).toBe('COMPLETED');

    await prisma.checkoutGroup.create({
      data: {
        id: failedGroupId,
        groupNumber: `CG-FC-${suffix}`.toUpperCase(),
        customerId: 'usr-1',
        itemTotal: 500,
        grandTotal: 525,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PENDING,
        razorpayOrderId: rzpCapOrderId,
      },
    });

    await prisma.order.create({
      data: {
        id: ordCancelled,
        orderNumber: `KC-FC-${suffix}`,
        checkoutGroupId: failedGroupId,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.CANCELLED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.PENDING,
        razorpayOrderId: rzpCapOrderId,
        itemTotal: 500,
        taxes: 25,
        grandTotal: 525,
      },
    });

    const capturedCancelledRaw = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpCapPayId,
            order_id: rzpCapOrderId,
            amount: 52500,
            currency: 'INR',
            method: 'upi',
          },
        },
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signPayload(capturedCancelledRaw))
      .set('x-razorpay-event-id', evtCapCancelled)
      .send(capturedCancelledRaw)
      .expect(200);

    const updatedFailedGroup = await prisma.checkoutGroup.findUnique({ where: { id: failedGroupId } });
    const updatedCancelledOrd = await prisma.order.findUnique({ where: { id: ordCancelled } });
    expect(updatedFailedGroup?.paymentStatus).toBe('REFUND_PENDING');
    expect(updatedCancelledOrd?.paymentStatus).toBe('PENDING');
  });
});
