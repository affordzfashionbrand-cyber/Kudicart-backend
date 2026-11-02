import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('PaymentsService — Razorpay Secure Gateway & Verification', () => {
  let service: PaymentsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentsService, PrismaService],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRazorpayOrder', () => {
    it('should throw BadRequestException if amount is <= 0', async () => {
      await expect(service.createRazorpayOrder(0)).rejects.toThrow(BadRequestException);
      await expect(service.createRazorpayOrder(-100)).rejects.toThrow(BadRequestException);
    });

    it('should create order payload with paisa calculation and keyId', async () => {
      const res = await service.createRazorpayOrder(1499.5, 'ord-test-1');
      expect(res.success).toBe(true);
      expect(res.amountInPaisa).toBe(149950);
      expect(res.currency).toBe('INR');
      expect(res.razorpayOrderId).toBeDefined();
      expect(res.keyId).toBeDefined();
    });
  });

  describe('verifyRazorpaySignature', () => {
    it('should throw BadRequestException if required parameters are missing', async () => {
      await expect(service.verifyRazorpaySignature('', 'pay_123', 'sig')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.verifyRazorpaySignature('ord-1', '', 'sig')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.verifyRazorpaySignature('ord-1', 'pay_123', '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should verify legitimate HMAC-SHA256 signature and update order to COMPLETED', async () => {
      const store: any = prisma.getStore();
      const testOrderId = 'ord-verify-hmac';
      store.orders.unshift({
        id: testOrderId,
        orderNumber: 'AF-VHMAC',
        customerId: 'usr-1',
        status: 'PLACED',
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PENDING',
        razorpayOrderId: 'order_rzp_real_123',
        itemTotal: 1000,
        deliveryFee: 40,
        taxes: 50,
        grandTotal: 1090,
        items: [],
        history: [],
      });

      const paymentId = 'pay_real_456';
      const expectedData = `order_rzp_real_123|${paymentId}`;
      const validSignature = crypto
        .createHmac('sha256', service.razorpayKeySecret)
        .update(expectedData)
        .digest('hex');

      const res = await service.verifyRazorpaySignature(
        testOrderId,
        paymentId,
        validSignature,
        'order_rzp_real_123',
      );

      expect(res.verified).toBe(true);
      expect(res.status).toBe('PAID');
      expect(res.paymentId).toBe(paymentId);

      const updatedOrder = store.orders.find((o: any) => o.id === testOrderId);
      expect(updatedOrder.paymentStatus).toBe('COMPLETED');
      expect(updatedOrder.razorpayPaymentId).toBe(paymentId);
    });

    it('should reject tampered / invalid signatures', async () => {
      const store: any = prisma.getStore();
      const testOrderId = 'ord-tamper-test';
      store.orders.unshift({
        id: testOrderId,
        orderNumber: 'AF-TAMPER',
        customerId: 'usr-1',
        status: 'PLACED',
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PENDING',
        razorpayOrderId: 'order_rzp_tamper',
        itemTotal: 500,
        deliveryFee: 0,
        taxes: 25,
        grandTotal: 525,
        items: [],
        history: [],
      });

      await expect(
        service.verifyRazorpaySignature(
          testOrderId,
          'pay_tampered_123',
          'invalid_tampered_signature_hex_12345',
        ),
      ).rejects.toThrow(BadRequestException);

      const updatedOrder = store.orders.find((o: any) => o.id === testOrderId);
      expect(updatedOrder.paymentStatus).toBe('FAILED');
    });
  });

  describe('generateCheckoutHtml', () => {
    it('should generate valid HTML containing Razorpay checkout script and order details', async () => {
      const store: any = prisma.getStore();
      const testOrderId = 'ord-checkout-html';
      store.orders.unshift({
        id: testOrderId,
        orderNumber: 'AF-CHKHTML',
        customerId: 'usr-1',
        status: 'PLACED',
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PENDING',
        razorpayOrderId: 'order_rzp_chkt_99',
        itemTotal: 2000,
        deliveryFee: 0,
        taxes: 100,
        grandTotal: 2100,
        items: [],
        history: [],
      });

      const html = await service.generateCheckoutHtml(testOrderId);
      expect(html).toContain('checkout.razorpay.com/v1/checkout.js');
      expect(html).toContain('AF-CHKHTML');
      expect(html).toContain('order_rzp_chkt_99');
      expect(html).toContain('2100');
    });
  });
});
