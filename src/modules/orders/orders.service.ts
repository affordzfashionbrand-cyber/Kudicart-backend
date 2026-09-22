import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachineService, OrderStatus } from './state-machine.service';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private stateMachine: StateMachineService,
  ) {}

  async checkout(userId: string, addressId: string, paymentMethod: 'RAZORPAY' | 'COD') {
    const store = this.prisma.getStore();
    const userCartItems = store.cartItems.filter((ci) => ci.userId === userId);

    const items = userCartItems.map((ci) => {
      const prod = store.products.find((p) => p.id === ci.productId);
      return {
        id: `oi-${Date.now()}`,
        productId: ci.productId,
        title: prod?.title || 'KudiCart Item',
        brand: prod?.brand || 'Avanya Ethnic',
        size: ci.size,
        price: prod?.price || 1299,
        quantity: ci.quantity,
        image: prod?.image || '',
      };
    });

    const itemTotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const deliveryFee = 40;
    const taxes = Math.round(itemTotal * 0.05);
    const grandTotal = itemTotal + deliveryFee + taxes;

    const orderNumber = `KC-${Math.floor(10000 + Math.random() * 90000)}`;

    const newOrder = {
      id: `ord-${Date.now()}`,
      orderNumber,
      customerId: userId,
      driverId: 'drv-1',
      addressId,
      status: 'PLACED' as OrderStatus,
      paymentMethod,
      paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'COMPLETED',
      itemTotal,
      deliveryFee,
      taxes,
      grandTotal,
      etaMinutes: 35,
      createdAt: new Date().toISOString(),
      driver: {
        name: 'Rajesh Kumar',
        phone: '+91 98765 43210',
        vehicle: 'KA 03 EV 4821 (Electric Scooter)',
        photo: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB-9n0OJClXNM6d0TX37sDPYy2u14Q2urWrIDrGrcsqp-xeOqvJWO4kLCkJM2p4l8e4m4L2wDCHqTawwJ4RiTjZPrGzg0jToIbTJpMggV8VY-XM8NL1FIq9KmGLwPNEJ_9rmCB4K-W2qmOS5AXnWOrQVPZSlvSNve7Z3L9QAVxRKy5jXEY_LUYbxNPc7m3PZ877qBOS_WWQ8dabL-BBYfbKqFLHaaegb80kVZpY-Z_FPvHZPdgyE2SFDA',
      },
      items,
      history: [
        { status: 'PLACED', time: new Date().toLocaleTimeString(), note: 'Order created' },
      ],
    };

    store.orders.unshift(newOrder as any);
    store.cartItems = store.cartItems.filter((ci) => ci.userId !== userId);

    return newOrder;
  }

  async getOrders(userId: string) {
    return this.prisma.getStore().orders.filter((o) => o.customerId === userId);
  }

  async getOrderById(id: string) {
    const order = this.prisma.getStore().orders.find((o) => o.id === id || o.orderNumber === id);
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  async trackOrder(id: string) {
    const order = await this.getOrderById(id);
    const milestones = this.stateMachine.getMilestones(order.status as OrderStatus);
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      etaMinutes: order.etaMinutes,
      grandTotal: order.grandTotal,
      driver: order.driver,
      milestones,
      history: order.history,
    };
  }

  async updateStatus(id: string, nextStatus: OrderStatus, note?: string) {
    const order = await this.getOrderById(id);
    this.stateMachine.validateTransition(order.status as OrderStatus, nextStatus);
    order.status = nextStatus;
    order.history.push({
      status: nextStatus,
      time: new Date().toLocaleTimeString(),
      note: note || `Transitioned to ${nextStatus}`,
    });
    return order;
  }
}
