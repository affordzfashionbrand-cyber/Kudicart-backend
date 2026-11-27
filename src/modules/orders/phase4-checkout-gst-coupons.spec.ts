import { BadRequestException } from '@nestjs/common';
import {
  GST_TAX_RATE,
  INCLUSIVE_GST_RATE,
  computeInclusiveGstBreakdown,
} from './order-pricing.util';
import { CartService } from '../cart/cart.service';
import { OrdersService } from './orders.service';
import { formatOrderPacket } from '../driver/driver-order.formatter';
import { Role } from '../../common/enums/role.enum';

describe('Phase 4: MRP GST-Inclusive Pricing, Per-Account Coupon Limits, Invoice & Delivery Preferences', () => {
  it('sets extra GST_TAX_RATE to 0 and computes accurate inclusive CGST/SGST breakdown', () => {
    expect(GST_TAX_RATE).toBe(0);
    expect(INCLUSIVE_GST_RATE).toBe(0.05);

    const gst = computeInclusiveGstBreakdown(2100);
    expect(gst.grossAmount).toBe(2100);
    expect(gst.taxableValue).toBe(2000);
    expect(gst.totalGst).toBe(100);
    expect(gst.cgst).toBe(50);
    expect(gst.sgst).toBe(50);
    expect(gst.taxableValue + gst.cgst + gst.sgst).toBeCloseTo(2100, 2);
  });

  it('CartService validates ATELIER500/EXPRESS18 and enforces perUserLimit per account', async () => {
    const now = Date.now();
    const couponByCode: Record<string, any> = {
      ATELIER500: {
        id: 'cpn-atelier',
        code: 'ATELIER500',
        discountType: 'FLAT',
        discountValue: 500,
        minOrderValue: 2499,
        maxDiscount: null,
        usageLimit: null,
        usedCount: 0,
        perUserLimit: 1,
        startDate: new Date(now - 86400_000),
        endDate: new Date(now + 86400_000),
        isActive: true,
      },
      EXPRESS18: {
        id: 'cpn-express18',
        code: 'EXPRESS18',
        discountType: 'FLAT',
        discountValue: 40,
        minOrderValue: 0,
        maxDiscount: null,
        usageLimit: null,
        usedCount: 0,
        perUserLimit: 1,
        startDate: new Date(now - 86400_000),
        endDate: new Date(now + 86400_000),
        isActive: true,
      },
    };

    let mockCart: any = {
      id: 'cart-u1',
      userId: 'usr-1',
      couponCode: null,
      giftWrap: false,
      donationAmount: 0,
      items: [
        {
          id: 'ci-1',
          productId: 'prod-1',
          size: 'M',
          quantity: 1,
          trialSize: null,
          color: null,
          product: {
            id: 'prod-1',
            title: 'Atelier Suit',
            brand: 'Affordz',
            price: 2600,
            originalPrice: 3200,
            stockQuantity: 10,
            fulfillmentType: 'VENDOR',
            image: 'https://example.com/1.jpg',
            vendor: { id: 'vend-1', storeName: 'Atelier' },
          },
        },
      ],
    };

    const countMock = jest.fn().mockResolvedValue(0);
    const mockPrisma: any = {
      isConnectedToDb: true,
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'usr-1' }),
      },
      cart: {
        findUnique: jest.fn().mockImplementation(async () => mockCart),
        findFirst: jest.fn().mockImplementation(async () => mockCart),
        upsert: jest.fn().mockImplementation(async () => mockCart),
        create: jest.fn(),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          mockCart = { ...mockCart, ...data };
          return mockCart;
        }),
      },
      coupon: {
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          const code = typeof where?.code === 'string' ? where.code : where?.code?.equals;
          return (code && couponByCode[code]) || null;
        }),
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          const code = typeof where?.code === 'string' ? where.code : where?.code?.equals;
          return (code && couponByCode[code]) || null;
        }),
      },
      couponUsage: {
        count: countMock,
      },
    };

    const cartService = new CartService(mockPrisma);

    // 1. Valid coupon ATELIER500 on 2600 >= 2499 -> 500 off, extra taxes = 0
    const applied = await cartService.applyCoupon('usr-1', 'ATELIER500');
    expect(applied.discountAmount).toBe(500);
    expect(applied.taxes).toBe(0);
    expect(applied.grandTotal).toBe(2100);

    // 2. EXPRESS18 applies ₹40 flat off even on lower carts
    const expressRes = await cartService.applyCoupon('usr-1', 'EXPRESS18');
    expect(expressRes.discountAmount).toBe(40);
    expect(expressRes.taxes).toBe(0);

    // 3. Per-user limit reached -> rejects cleanly
    countMock.mockResolvedValueOnce(1);
    await expect(cartService.applyCoupon('usr-1', 'ATELIER500')).rejects.toThrow(BadRequestException);
  });

  it('OrdersService.getOrderInvoice generates MRP-inclusive GST invoice JSON + HTML with buyer GSTIN', async () => {
    const orderRecord: any = {
      id: 'ord-gst-1',
      orderNumber: 'KC-GST-101',
      customerId: 'usr-1',
      vendorId: 'vend-1',
      status: 'DELIVERED',
      paymentMethod: 'RAZORPAY',
      paymentStatus: 'COMPLETED',
      fulfillmentType: 'VENDOR',
      itemTotal: 2100,
      discountAmount: 0,
      couponCode: null,
      deliveryFee: 0,
      giftWrapFee: 0,
      donationAmount: 0,
      taxes: 0,
      grandTotal: 2100,
      deliveryInstructions: 'Leave with Guard, Call Before Delivery',
      needGstInvoice: true,
      customerGstin: '29AABCU9603R1ZM',
      gstBusinessName: 'Acme Apparel LLP',
      createdAt: new Date('2026-11-27T10:00:00Z'),
      customer: { id: 'usr-1', name: 'Ananya', phone: '+91 98450 12890', email: 'ananya@example.com' },
      address: {
        label: 'Office',
        recipientName: 'Ananya',
        recipientPhone: '+91 98450 12890',
        line1: 'MG Road',
        locality: 'Indiranagar',
        city: 'Bengaluru',
        pincode: '560038',
      },
      items: [
        {
          id: 'oi-1',
          productId: 'prod-1',
          title: 'Silk Kurta',
          brand: 'Affordz',
          size: 'M',
          price: 2100,
          quantity: 1,
        },
      ],
    };

    const mockPrisma: any = {
      isConnectedToDb: true,
      order: {
        findFirst: jest.fn().mockResolvedValue(orderRecord),
      },
    };

    const ordersService = new OrdersService(
      mockPrisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const invoice = await ordersService.getOrderInvoice('ord-gst-1', 'usr-1', Role.CUSTOMER);
    expect(invoice.invoiceNumber).toBe('INV-KC-GST-101');
    expect(invoice.mrpGstInclusive).toBe(true);
    expect(invoice.buyer.needGstInvoice).toBe(true);
    expect(invoice.buyer.gstin).toBe('29AABCU9603R1ZM');
    expect(invoice.buyer.businessName).toBe('Acme Apparel LLP');
    expect(invoice.totals.taxableSubtotal).toBe(2000);
    expect(invoice.totals.cgstTotal).toBe(50);
    expect(invoice.totals.sgstTotal).toBe(50);
    expect(invoice.totals.grandTotal).toBe(2100);
    expect(invoice.html).toContain('TAX INVOICE');
    expect(invoice.html).toContain('29AABCU9603R1ZM');
    expect(invoice.html).toContain('Acme Apparel LLP');

    // Driver packet includes persisted customer deliveryInstructions
    const driverPacket = formatOrderPacket(orderRecord);
    expect(driverPacket.deliveryInstructions).toBe('Leave with Guard, Call Before Delivery');
  });
});
