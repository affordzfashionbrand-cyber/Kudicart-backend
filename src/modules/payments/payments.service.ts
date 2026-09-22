import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async createRazorpayOrder(amount: number) {
    const razorpayOrderId = `rzp_order_${Math.floor(100000 + Math.random() * 900000)}`;
    return {
      success: true,
      razorpayOrderId,
      amount,
      currency: 'INR',
      keyId: 'rzp_test_KudiCartClientKey',
    };
  }

  async verifyRazorpaySignature(orderId: string, paymentId: string, signature: string) {
    if (!paymentId || !signature) {
      throw new BadRequestException('Razorpay signature verification failed');
    }
    const store = this.prisma.getStore();
    const order: any = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);
    if (order) {
      order.paymentStatus = 'COMPLETED';
      order.razorpayOrderId = orderId;
      order.razorpayPaymentId = paymentId;
    }
    return {
      verified: true,
      status: 'PAID',
    };
  }

  async confirmCod(orderId: string) {
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);
    if (order) {
      order.paymentMethod = 'COD';
      order.paymentStatus = 'PENDING';
    }
    return {
      confirmed: true,
      paymentMethod: 'COD',
    };
  }
}
