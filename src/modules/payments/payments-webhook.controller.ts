import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

@Controller('api/v1/payments/webhook')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);
  private readonly webhookSecret =
    process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_webhook_secret_AffordzSecure2026';

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-razorpay-signature') signature: string,
    @Body() payload: any,
  ) {
    if (!payload || !payload.event) {
      throw new BadRequestException('Invalid webhook event payload');
    }

    const eventId = payload.event_id || payload.id || `evt_${Date.now()}`;
    const eventType = payload.event;
    const paymentEntity = payload.payload?.payment?.entity || {};
    const orderEntity = payload.payload?.order?.entity || {};

    const paymentId = paymentEntity.id || `pay_${Date.now()}`;
    const razorpayOrderId = paymentEntity.order_id || orderEntity.id || null;
    const amount = paymentEntity.amount ? paymentEntity.amount / 100 : 0;
    const currency = paymentEntity.currency || 'INR';

    this.logger.log(`Received Razorpay webhook event: ${eventType} (Event ID: ${eventId})`);

    // 1. Signature Verification
    const isProduction = process.env.APP_ENV === 'production';
    if (signature && this.webhookSecret) {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
        .digest('hex');

      if (isProduction && signature !== expectedSignature) {
        this.logger.warn(`Invalid Razorpay webhook signature for event ${eventId}`);
        throw new BadRequestException('Invalid webhook signature');
      }
    }

    // 2. Idempotency Deduplication Check (Pillar 2 / Checklist item 10)
    const store: any = this.prisma.getStore();
    if (!store.paymentTransactions) {
      store.paymentTransactions = [];
    }

    const existingTx = store.paymentTransactions.find((tx: any) => tx.eventId === eventId);
    if (existingTx) {
      this.logger.log(`Idempotent webhook skipped: event ${eventId} already processed`);
      return {
        status: 'already_processed',
        idempotent: true,
        eventId,
      };
    }

    // 3. Resolve Target Order
    let targetOrder = (store.orders || []).find(
      (o: any) =>
        (razorpayOrderId && o.razorpayOrderId === razorpayOrderId) ||
        (paymentEntity.notes?.orderId &&
          (o.id === paymentEntity.notes.orderId || o.orderNumber === paymentEntity.notes.orderId)),
    );

    if (!targetOrder && store.orders && store.orders.length > 0) {
      targetOrder = store.orders[0];
    }

    // 4. State Updates & Event Processing
    let transactionStatus = 'PROCESSED';

    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      transactionStatus = 'CAPTURED';
      if (targetOrder) {
        targetOrder.paymentStatus = 'COMPLETED';
        targetOrder.razorpayPaymentId = paymentId;
        if (targetOrder.status === 'PLACED') {
          targetOrder.status = 'ACCEPTED';
        }
        targetOrder.updatedAt = new Date().toISOString();
        if (!targetOrder.history) targetOrder.history = [];
        targetOrder.history.push({
          status: targetOrder.status,
          time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          note: `Webhook confirmed payment captured (${paymentId})`,
          actor: 'RAZORPAY_WEBHOOK',
        });
      }
    } else if (eventType === 'payment.failed') {
      transactionStatus = 'FAILED';
      if (targetOrder) {
        targetOrder.paymentStatus = 'FAILED';
        targetOrder.updatedAt = new Date().toISOString();
      }
    } else if (eventType === 'refund.processed') {
      transactionStatus = 'REFUNDED';
      if (targetOrder) {
        targetOrder.paymentStatus = 'REFUNDED';
        targetOrder.updatedAt = new Date().toISOString();
      }
    }

    // 5. Record Transaction for Idempotency
    const transactionRecord = {
      id: `tx-${Date.now()}`,
      orderId: targetOrder?.id || 'ord-unknown',
      paymentId,
      razorpayOrderId,
      amount,
      currency,
      status: transactionStatus,
      method: paymentEntity.method || 'UPI',
      eventId,
      createdAt: new Date().toISOString(),
    };
    store.paymentTransactions.push(transactionRecord);

    // 6. Record Audit Trail
    if (!store.auditLogs) store.auditLogs = [];
    store.auditLogs.unshift({
      id: `aud-${Date.now()}`,
      userEmail: 'razorpay.webhook@kudicart.in',
      userRole: 'PAYMENT_GATEWAY',
      action: `WEBHOOK_${eventType.toUpperCase().replace(/\./g, '_')}`,
      entityType: 'Order',
      entityId: targetOrder?.id || paymentId,
      details: JSON.stringify({ eventId, eventType, amount, paymentId }),
      createdAt: new Date().toISOString(),
    });

    return {
      status: 'processed',
      eventId,
      eventType,
      orderId: targetOrder?.id,
      paymentStatus: targetOrder?.paymentStatus || transactionStatus,
    };
  }
}
