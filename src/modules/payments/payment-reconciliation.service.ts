import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RazorpayClientService } from './razorpay-client.service';
import { OrderTransitionService } from '../orders/order-transition.service';

export interface ReconciliationReport {
  success: boolean;
  processedCount: number;
  reconciledCount: number;
  expiredCount: number;
  refundsCompletedCount: number;
  restoredStockItems: number;
  details: Array<{
    orderId: string;
    orderNumber: string;
    action: 'RECONCILED' | 'EXPIRED' | 'REFUNDED' | 'SKIPPED';
    reason: string;
  }>;
  timestamp: string;
}

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpayClient: RazorpayClientService,
    private readonly orderTransition: OrderTransitionService,
  ) {}

  async reconcile(
    options: { pendingThresholdMinutes?: number; expiryThresholdMinutes?: number } = {},
  ): Promise<ReconciliationReport> {
    const details: ReconciliationReport['details'] = [];
    if (!this.prisma.isConnectedToDb) {
      return {
        success: false,
        processedCount: 0,
        reconciledCount: 0,
        expiredCount: 0,
        refundsCompletedCount: 0,
        restoredStockItems: 0,
        details,
        timestamp: new Date().toISOString(),
      };
    }

    const expiryMinutes = options.expiryThresholdMinutes ?? 15;
    const now = new Date();
    const fallbackExpiryCutoff = new Date(now.getTime() - expiryMinutes * 60 * 1000);

    let reconciledCount = 0;
    let expiredCount = 0;
    let refundsCompletedCount = 0;
    let restoredStockItems = 0;

    // 1. Check all unpaid RAZORPAY orders still in PLACED state
    const pendingRazorpayOrders = await this.prisma.order.findMany({
      where: {
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PENDING',
        status: 'PLACED',
      },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const order of pendingRazorpayOrders) {
      const effectiveExpiry = order.expiresAt || fallbackExpiryCutoff;
      const isExpired = order.expiresAt
        ? order.expiresAt <= now
        : order.createdAt <= fallbackExpiryCutoff;

      if (order.razorpayOrderId) {
        try {
          const gatewayPayments = await this.razorpayClient.fetchOrderPayments(
            order.razorpayOrderId,
          );
          const captured = gatewayPayments.find((p: any) => p.status === 'captured');
          if (captured) {
            await this.prisma.$transaction(async (tx) => {
              if (order.checkoutGroupId) {
                await tx.checkoutGroup.update({
                  where: { id: order.checkoutGroupId },
                  data: { paymentStatus: 'COMPLETED', razorpayPaymentId: captured.id },
                });
                await tx.order.updateMany({
                  where: { checkoutGroupId: order.checkoutGroupId },
                  data: { paymentStatus: 'COMPLETED', razorpayPaymentId: captured.id },
                });
              } else {
                await tx.order.update({
                  where: { id: order.id },
                  data: { paymentStatus: 'COMPLETED', razorpayPaymentId: captured.id },
                });
              }
            });
            reconciledCount++;
            details.push({
              orderId: order.id,
              orderNumber: order.orderNumber,
              action: 'RECONCILED',
              reason: `Recovered captured payment ${captured.id} from Razorpay`,
            });
            continue;
          }
        } catch (err: any) {
          this.logger.warn(
            `Gateway check skipped for Order #${order.orderNumber}: ${err?.message}`,
          );
        }
      }

      if (isExpired) {
        try {
          await this.orderTransition.executeTransition({
            orderId: order.id,
            nextStatus: 'FAILED',
            actorRole: 'SYSTEM',
            note: `Unpaid Razorpay payment window expired (${effectiveExpiry.toISOString()}) — stock restored`,
            auditAction: 'ORDER_PAYMENT_WINDOW_EXPIRED',
          });

          if (order.checkoutGroupId) {
            await this.prisma.checkoutGroup.updateMany({
              where: { id: order.checkoutGroupId, paymentStatus: 'PENDING' },
              data: { paymentStatus: 'FAILED' },
            });
          }

          expiredCount++;
          restoredStockItems += (order.items || []).reduce(
            (s, it) => s + (it.quantity || 1),
            0,
          );
          details.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            action: 'EXPIRED',
            reason: 'Payment window elapsed; order marked FAILED and stock restored',
          });
        } catch (err: any) {
          details.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            action: 'SKIPPED',
            reason: err?.message || 'Concurrent state modification',
          });
        }
      }
    }

    // 2. Retry pending refunds
    const refundPendingOrders = await this.prisma.order.findMany({
      where: {
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'REFUND_PENDING',
      },
      include: { tryAndBuySession: true },
    });

    for (const order of refundPendingOrders) {
      if (!order.razorpayPaymentId) {
        details.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          action: 'SKIPPED',
          reason: 'No captured razorpayPaymentId present for refund',
        });
        continue;
      }

      // 1. Atomic Concurrency Lock: Use CAS on order.version to prevent concurrent reconciliation
      // workers from executing duplicate refund calls against Razorpay simultaneously.
      const claim = await this.prisma.order.updateMany({
        where: {
          id: order.id,
          paymentStatus: 'REFUND_PENDING',
          version: order.version,
        },
        data: {
          version: { increment: 1 },
        },
      });

      if (claim.count === 0) {
        details.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          action: 'SKIPPED',
          reason: 'Concurrent reconciliation lock: another process claimed this refund',
        });
        continue;
      }

      // 2. Check existing refund transactions for this order to prevent duplicate submissions
      const existingRefund = await this.prisma.paymentTransaction.findFirst({
        where: { orderId: order.id, transactionType: 'REFUND' },
        orderBy: { createdAt: 'desc' },
      });

      if (existingRefund) {
        // A. Successfully completed refund: ensure order reflects REFUNDED and skip re-submission
        if (existingRefund.status === 'REFUNDED' || existingRefund.status === 'COMPLETED') {
          await this.prisma.order.updateMany({
            where: { id: order.id, paymentStatus: 'REFUND_PENDING' },
            data: { paymentStatus: 'REFUNDED' },
          });
          details.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            action: 'SKIPPED',
            reason: `Refund already completed successfully (${existingRefund.refundId || existingRefund.id})`,
          });
          continue;
        }

        // B. Pending refund awaiting provider settlement: skip duplicate submission
        if (existingRefund.status === 'PENDING') {
          details.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            action: 'SKIPPED',
            reason: `Refund submission already pending provider confirmation (${existingRefund.refundId || existingRefund.id})`,
          });
          continue;
        }

        // C. Previously failed refund: proceed to retry
        if (existingRefund.status === 'FAILED') {
          this.logger.warn(
            `Retrying previously failed refund for Order #${order.orderNumber} (previous failure: ${existingRefund.failureReason || 'unknown'})`,
          );
        }
      }

      const refundAmount =
        order.tryAndBuySession?.refundAmount && order.tryAndBuySession.refundAmount > 0
          ? order.tryAndBuySession.refundAmount
          : order.grandTotal;

      try {
        const res = await this.razorpayClient.refundPayment({
          paymentId: order.razorpayPaymentId,
          amountInPaisa: Math.round(refundAmount * 100),
          notes: { orderId: order.id, orderNumber: order.orderNumber },
        });

        const isProcessed = res.status === 'processed';
        const finalStatus = isProcessed ? 'REFUNDED' : 'PENDING';

        await this.prisma.$transaction(async (tx) => {
          if (isProcessed) {
            await tx.order.updateMany({
              where: { id: order.id, paymentStatus: 'REFUND_PENDING' },
              data: { paymentStatus: 'REFUNDED' },
            });
            if (order.tryAndBuySession) {
              await tx.tryAndBuySession.updateMany({
                where: { id: order.tryAndBuySession.id, paymentStatus: 'REFUND_PENDING' },
                data: { paymentStatus: 'REFUNDED' },
              });
            }
          }
          const exists = await tx.paymentTransaction.findUnique({
            where: { refundId: res.refundId },
          });
          if (!exists) {
            await tx.paymentTransaction.create({
              data: {
                orderId: order.id,
                checkoutGroupId: order.checkoutGroupId,
                paymentId: order.razorpayPaymentId!,
                refundId: res.refundId,
                transactionType: 'REFUND',
                amount: refundAmount,
                currency: 'INR',
                status: finalStatus,
                method: 'Razorpay',
              },
            });
          }
        });

        refundsCompletedCount++;
        details.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          action: 'REFUNDED',
          reason: `Refund ${res.refundId} processed (₹${refundAmount})`,
        });
      } catch (err: any) {
        await this.prisma.paymentTransaction
          .create({
            data: {
              orderId: order.id,
              checkoutGroupId: order.checkoutGroupId,
              paymentId: order.razorpayPaymentId!,
              transactionType: 'REFUND',
              amount: refundAmount,
              currency: 'INR',
              status: 'FAILED',
              failureReason: err?.message || 'Razorpay refund execution failed',
              method: 'Razorpay',
            },
          })
          .catch(() => {});

        details.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          action: 'SKIPPED',
          reason: `Refund attempt failed and recorded for retry: ${err?.message}`,
        });
      }
    }

    return {
      success: true,
      processedCount: details.length,
      reconciledCount,
      expiredCount,
      refundsCompletedCount,
      restoredStockItems,
      details,
      timestamp: new Date().toISOString(),
    };
  }
}
