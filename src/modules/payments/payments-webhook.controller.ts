import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RazorpayClientService } from './razorpay-client.service';
import { QueueJobType } from '../queue/queue.constants';

@Controller('api/v1/webhooks')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpayClient: RazorpayClientService,
  ) {}

  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  async handleRazorpayWebhook(
    @Req() req: any,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventIdHeader?: string,
  ) {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }

    const rawBody: Buffer = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(
          typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}),
          'utf8',
        );

    // Fail closed if secret missing, signature header missing, or HMAC invalid (returns 401)
    this.razorpayClient.verifyWebhookSignatureOrThrow(rawBody, signature);

    let payload: any = req.body;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      payload = req.body || {};
    }

    const eventType = payload?.event || 'unknown';
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const eventId = eventIdHeader?.trim() || `${eventType}:${payloadHash}`;

    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    if (existingEvent) {
      return {
        received: true,
        duplicate: true,
        eventId,
      };
    }

    const paymentEntity = payload?.payload?.payment?.entity;
    const refundEntity = payload?.payload?.refund?.entity;
    const orderEntity = payload?.payload?.order?.entity;

    const rzpOrderId =
      paymentEntity?.order_id ||
      orderEntity?.id ||
      refundEntity?.notes?.razorpayOrderId ||
      null;
    const paymentId = paymentEntity?.id || refundEntity?.payment_id || null;

    let resolvedGroup: any = null;
    let resolvedOrder: any = null;

    if (rzpOrderId) {
      resolvedGroup = await this.prisma.checkoutGroup.findFirst({
        where: { razorpayOrderId: rzpOrderId },
        include: { orders: true },
      });
      if (!resolvedGroup) {
        resolvedOrder = await this.prisma.order.findFirst({
          where: { razorpayOrderId: rzpOrderId },
          include: { checkoutGroup: { include: { orders: true } } },
        });
        if (resolvedOrder?.checkoutGroup) {
          resolvedGroup = resolvedOrder.checkoutGroup;
        }
      }
    }

    const notesGroupId = paymentEntity?.notes?.checkoutGroupId;
    const notesOrderId = paymentEntity?.notes?.orderId;

    if (!resolvedGroup && notesGroupId) {
      resolvedGroup = await this.prisma.checkoutGroup.findUnique({
        where: { id: notesGroupId },
        include: { orders: true },
      });
    }
    if (!resolvedGroup && !resolvedOrder && notesOrderId) {
      resolvedOrder = await this.prisma.order.findUnique({
        where: { id: notesOrderId },
        include: { checkoutGroup: { include: { orders: true } } },
      });
      if (resolvedOrder?.checkoutGroup) {
        resolvedGroup = resolvedOrder.checkoutGroup;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (eventType === 'payment.captured' || eventType === 'order.paid') {
        const ordersToUpdate = resolvedGroup
          ? resolvedGroup.orders
          : resolvedOrder
            ? [resolvedOrder]
            : [];
        const activeOrders = ordersToUpdate.filter(
          (o: any) => o.status !== 'FAILED' && o.status !== 'CANCELLED',
        );
        const activeIds = activeOrders.map((o: any) => o.id);

        if (resolvedGroup) {
          await tx.checkoutGroup.update({
            where: { id: resolvedGroup.id },
            data: {
              paymentStatus: activeOrders.length > 0 ? 'COMPLETED' : 'REFUND_PENDING',
              razorpayPaymentId: paymentId || resolvedGroup.razorpayPaymentId,
            },
          });
        }

        if (activeIds.length > 0) {
          await tx.order.updateMany({
            where: {
              id: { in: activeIds },
              status: { notIn: ['FAILED', 'CANCELLED'] },
            },
            data: {
              paymentStatus: 'COMPLETED',
              razorpayPaymentId: paymentId || undefined,
            },
          });
        }

        if (paymentId) {
          const existingCapture = await tx.paymentTransaction.findFirst({
            where: { paymentId, transactionType: 'CAPTURE' },
          });
          if (!existingCapture) {
            await tx.paymentTransaction.create({
              data: {
                checkoutGroupId: resolvedGroup?.id || null,
                orderId: ordersToUpdate.length === 1 ? ordersToUpdate[0].id : null,
                paymentId,
                razorpayOrderId: rzpOrderId || null,
                amount: paymentEntity?.amount ? Number(paymentEntity.amount) / 100 : (resolvedGroup?.grandTotal ?? resolvedOrder?.grandTotal ?? 0),
                currency: paymentEntity?.currency || 'INR',
                status: 'COMPLETED',
                method: paymentEntity?.method || 'Razorpay',
                eventId,
                transactionType: 'CAPTURE',
              },
            });
          }
        }
      } else if (eventType === 'payment.failed') {
        if (resolvedGroup && resolvedGroup.paymentStatus === 'PENDING') {
          await tx.checkoutGroup.update({
            where: { id: resolvedGroup.id },
            data: { paymentStatus: 'FAILED' },
          });
          await tx.order.updateMany({
            where: { checkoutGroupId: resolvedGroup.id, paymentStatus: 'PENDING' },
            data: { paymentStatus: 'FAILED' },
          });
        } else if (resolvedOrder && resolvedOrder.paymentStatus === 'PENDING') {
          await tx.order.update({
            where: { id: resolvedOrder.id },
            data: { paymentStatus: 'FAILED' },
          });
        }

        if (paymentId) {
          await tx.paymentTransaction.create({
            data: {
              checkoutGroupId: resolvedGroup?.id || null,
              orderId: resolvedOrder?.id || null,
              paymentId,
              razorpayOrderId: rzpOrderId || null,
              amount: paymentEntity?.amount ? Number(paymentEntity.amount) / 100 : 0,
              currency: paymentEntity?.currency || 'INR',
              status: 'FAILED',
              method: paymentEntity?.method || 'Razorpay',
              failureReason:
                paymentEntity?.error_description || paymentEntity?.error_reason || 'Payment failed',
              eventId,
              transactionType: 'CAPTURE',
            },
          });
        }
      } else if (eventType === 'refund.processed' || eventType === 'refund.created') {
        const refundId = refundEntity?.id;
        const refundAmountInr = refundEntity?.amount ? Number(refundEntity.amount) / 100 : 0;
        const refundNoteOrderId =
          refundEntity?.notes?.orderId || refundEntity?.notes?.targetOrderId || null;

        let targetOrders: any[] = [];
        if (refundNoteOrderId) {
          const noted = await tx.order.findFirst({
            where: {
              id: String(refundNoteOrderId),
              ...(paymentId ? { razorpayPaymentId: paymentId } : {}),
            },
          });
          if (noted) targetOrders = [noted];
        }

        if (targetOrders.length === 0 && paymentId) {
          const candidates = await tx.order.findMany({
            where: { razorpayPaymentId: paymentId },
          });
          const pending = candidates.filter((o) => o.paymentStatus === 'REFUND_PENDING');

          if (pending.length === 1) {
            targetOrders = pending;
          } else if (pending.length > 1 && refundAmountInr > 0) {
            const exact = pending.find((o) => Math.abs(o.grandTotal - refundAmountInr) < 1);
            targetOrders = exact
              ? [exact]
              : refundAmountInr >= pending.reduce((sum, o) => sum + o.grandTotal, 0) - 1
                ? pending
                : [pending[0]];
          } else if (candidates.length === 1) {
            targetOrders = candidates;
          } else if (candidates.length > 1 && refundAmountInr > 0) {
            const totalAll = candidates.reduce((sum, o) => sum + o.grandTotal, 0);
            if (refundAmountInr >= totalAll - 1) {
              targetOrders = candidates;
            } else {
              const exactCancelled = candidates.find(
                (o) =>
                  (o.status === 'CANCELLED' || o.status === 'FAILED') &&
                  Math.abs(o.grandTotal - refundAmountInr) < 1,
              );
              const exactAny =
                exactCancelled ||
                candidates.find((o) => Math.abs(o.grandTotal - refundAmountInr) < 1);
              if (exactAny) {
                targetOrders = [exactAny];
              }
            }
          }
        }

        const orderIds = targetOrders.map((o) => o.id);
        if (orderIds.length > 0) {
          await tx.order.updateMany({
            where: {
              id: { in: orderIds },
              paymentStatus: { in: ['REFUND_PENDING', 'COMPLETED'] },
            },
            data: { paymentStatus: 'REFUNDED' },
          });
          await tx.tryAndBuySession.updateMany({
            where: { orderId: { in: orderIds } },
            data: { paymentStatus: 'REFUNDED' },
          });

          const groupId = targetOrders[0]?.checkoutGroupId;
          if (groupId) {
            const remainingNonRefunded = await tx.order.count({
              where: {
                checkoutGroupId: groupId,
                paymentStatus: { not: 'REFUNDED' },
              },
            });
            if (remainingNonRefunded === 0) {
              await tx.checkoutGroup.update({
                where: { id: groupId },
                data: { paymentStatus: 'REFUNDED' },
              });
            }
          }
        }

        if (refundId && paymentId) {
          const existingRefund = await tx.paymentTransaction.findUnique({
            where: { refundId },
          });
          if (!existingRefund) {
            await tx.paymentTransaction.create({
              data: {
                checkoutGroupId: targetOrders[0]?.checkoutGroupId || resolvedGroup?.id || null,
                orderId: orderIds.length === 1 ? orderIds[0] : null,
                paymentId,
                refundId,
                transactionType: 'REFUND',
                amount: refundAmountInr,
                currency: refundEntity?.currency || 'INR',
                status: 'REFUNDED',
                method: 'Razorpay',
                eventId,
              },
            });
          }
        }
      }

      await tx.webhookEvent.create({
        data: {
          provider: 'RAZORPAY',
          eventId,
          eventType,
          payloadHash,
          orderId: resolvedOrder?.id || null,
          checkoutGroupId: resolvedGroup?.id || null,
        },
      });

      await tx.auditLog.create({
        data: {
          userRole: 'SYSTEM',
          action: `WEBHOOK_${eventType.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`,
          entityType: resolvedGroup ? 'CheckoutGroup' : 'Order',
          entityId: resolvedGroup?.id || resolvedOrder?.id || eventId,
          details: JSON.stringify({ eventId, eventType, paymentId, rzpOrderId }),
        },
      });

      if (eventType === 'payment.captured' && resolvedGroup?.customerId) {
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'PAYMENT',
            aggregateId: resolvedGroup.id,
            eventType: QueueJobType.PAYMENT_CAPTURED_NOTIFICATION,
            payload: {
              userId: resolvedGroup.customerId,
              checkoutGroupId: resolvedGroup.id,
              title: 'Payment Received',
              message: `Payment of ₹${Math.round(resolvedGroup.grandTotal)} confirmed for ${resolvedGroup.groupNumber}.`,
            },
          },
        });
      }
    });

    this.logger.log(`Processed Razorpay webhook event ${eventType} (${eventId})`);
    return {
      received: true,
      duplicate: false,
      eventId,
      eventType,
    };
  }
}
