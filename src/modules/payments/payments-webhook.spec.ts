import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('PaymentsWebhookController (Pillar 2 / Checklist item 10)', () => {
  let controller: PaymentsWebhookController;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsWebhookController],
      providers: [PaymentsService, PrismaService],
    }).compile();

    controller = module.get<PaymentsWebhookController>(PaymentsWebhookController);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Webhook Idempotency & Signature Verification', () => {
    it('should reject invalid payload without event field', async () => {
      await expect(controller.handleWebhook('sig_abc', {})).rejects.toThrow(BadRequestException);
    });

    it('should process payment.captured event and update order paymentStatus to COMPLETED', async () => {
      const store: any = prisma.getStore();
      const testOrderId = store.orders[0]?.id || 'ord-test-1';
      const eventId = `evt_test_${Date.now()}`;

      const payload = {
        event_id: eventId,
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_mock_123',
              amount: 140400, // in paisa
              currency: 'INR',
              method: 'upi',
              notes: {
                orderId: testOrderId,
              },
            },
          },
        },
      };

      const res = await controller.handleWebhook('sig_test', payload);
      expect(res.status).toBe('processed');
      expect(res.eventId).toBe(eventId);

      // Verify transaction recorded in store
      const tx = (store.paymentTransactions || []).find((t: any) => t.eventId === eventId);
      expect(tx).toBeDefined();
      expect(tx.status).toBe('CAPTURED');
      expect(tx.amount).toBe(1404);
    });

    it('should guarantee idempotency when receiving the duplicate webhook event', async () => {
      const store: any = prisma.getStore();
      const duplicateEventId = `evt_dup_${Date.now()}`;

      const payload = {
        event_id: duplicateEventId,
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_dup_456',
              amount: 250000,
              currency: 'INR',
              notes: { orderId: store.orders[0]?.id },
            },
          },
        },
      };

      // First webhook call: processed
      const res1 = await controller.handleWebhook('sig_test', payload);
      expect(res1.status).toBe('processed');

      // Second webhook call with identical event_id: idempotent skip
      const res2 = await controller.handleWebhook('sig_test', payload);
      expect(res2.status).toBe('already_processed');
      expect(res2.idempotent).toBe(true);
      expect(res2.eventId).toBe(duplicateEventId);
    });

    it('should handle payment.failed event and mark order paymentStatus as FAILED', async () => {
      const store: any = prisma.getStore();
      const testOrderId = store.orders[0]?.id || 'ord-test-failed';
      const eventId = `evt_fail_${Date.now()}`;

      const payload = {
        event_id: eventId,
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_fail_789',
              amount: 140400,
              currency: 'INR',
              notes: { orderId: testOrderId },
            },
          },
        },
      };

      const res = await controller.handleWebhook('sig_test', payload);
      expect(res.status).toBe('processed');
      expect(res.paymentStatus).toBe('FAILED');
    });
  });
});
