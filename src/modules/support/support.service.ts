import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  async createTicket(userId: string, data: { title: string; category?: string; orderId?: string }) {
    const store = this.prisma.getStore();
    const newTicket = {
      id: `ticket-${Date.now()}`,
      userId,
      orderId: data.orderId || 'ord-89241',
      title: data.title,
      category: data.category || 'Order Delivery Issue',
      status: 'Open',
      createdAt: new Date().toISOString(),
    };
    store.tickets.push(newTicket);
    return newTicket;
  }

  async getTickets(userId: string) {
    return this.prisma.getStore().tickets.filter((t) => t.userId === userId);
  }
}
