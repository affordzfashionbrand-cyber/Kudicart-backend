import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  async createTicket(userId: string, dto: CreateTicketDto) {
    const store = this.prisma.getStore();
    const newTicket = {
      id: `tkt-${Date.now()}`,
      userId,
      orderId: dto.orderId || null,
      title: dto.title,
      category: dto.category,
      description: dto.description || '',
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.tickets.unshift(newTicket);
    return newTicket;
  }

  async getTickets(userId: string) {
    const store = this.prisma.getStore();
    return store.tickets.filter((t) => t.userId === userId);
  }

  async getTicketById(userId: string, id: string) {
    const store = this.prisma.getStore();
    const ticket = store.tickets.find((t) => t.id === id && t.userId === userId);
    if (!ticket) {
      throw new NotFoundException(`Support ticket with ID ${id} not found`);
    }
    return ticket;
  }
}
