import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';

export const CANONICAL_SUPPORT_CATEGORIES = [
  'DELIVERY',
  'TRY_AND_BUY',
  'ORDER_ISSUE',
  'PAYMENT_REFUND',
  'PRODUCT_QUALITY',
  'ACCOUNT',
  'GENERAL',
] as const;

export type CanonicalSupportCategory = (typeof CANONICAL_SUPPORT_CATEGORIES)[number];

const CATEGORY_ALIAS_MAP: Record<string, CanonicalSupportCategory> = {
  DELIVERY: 'DELIVERY',
  'DELIVERY ISSUE': 'DELIVERY',
  'DELIVERY & RIDER HELP': 'DELIVERY',
  DELIVERY_RIDER_HELP: 'DELIVERY',
  'LATE DELIVERY': 'DELIVERY',
  TRY_AND_BUY: 'TRY_AND_BUY',
  'TRY & BUY': 'TRY_AND_BUY',
  'TRY AND BUY': 'TRY_AND_BUY',
  ORDER_ISSUE: 'ORDER_ISSUE',
  ORDER: 'ORDER_ISSUE',
  'ORDER ISSUE': 'ORDER_ISSUE',
  'DAMAGED / WRONG ITEM': 'ORDER_ISSUE',
  'WRONG ITEM': 'ORDER_ISSUE',
  PAYMENT_REFUND: 'PAYMENT_REFUND',
  PAYMENT: 'PAYMENT_REFUND',
  REFUND: 'PAYMENT_REFUND',
  'PAYMENT & REFUND': 'PAYMENT_REFUND',
  'PAYMENT / REFUND': 'PAYMENT_REFUND',
  PRODUCT_QUALITY: 'PRODUCT_QUALITY',
  QUALITY: 'PRODUCT_QUALITY',
  'PRODUCT QUALITY': 'PRODUCT_QUALITY',
  SIZING: 'PRODUCT_QUALITY',
  ACCOUNT: 'ACCOUNT',
  'ACCOUNT & APP': 'ACCOUNT',
  ACCOUNT_APP: 'ACCOUNT',
  PROFILE: 'ACCOUNT',
  GENERAL: 'GENERAL',
  OTHER: 'GENERAL',
};

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async resolveCanonicalUserId(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: userId }, { firebaseUid: userId }],
      },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Authenticated customer profile not found.');
    }

    return user.id;
  }

  private normalizeCategory(rawCategory: string): CanonicalSupportCategory {
    const normalizedKey = rawCategory.trim().toUpperCase().replace(/\s+/g, ' ');
    const mapped =
      CATEGORY_ALIAS_MAP[normalizedKey] ||
      CATEGORY_ALIAS_MAP[normalizedKey.replace(/[^A-Z]+/g, '_')];
    if (!mapped) {
      throw new BadRequestException(
        `Unsupported support category '${rawCategory}'. Expected one of: ${CANONICAL_SUPPORT_CATEGORIES.join(', ')}`,
      );
    }
    return mapped;
  }

  private normalizePriority(priority?: string): 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' {
    if (!priority) return 'NORMAL';
    const upper = priority.trim().toUpperCase();
    if (upper === 'MEDIUM') return 'NORMAL';
    if (upper === 'LOW' || upper === 'NORMAL' || upper === 'HIGH' || upper === 'URGENT') {
      return upper;
    }
    throw new BadRequestException(
      `Unsupported priority '${priority}'. Expected LOW, NORMAL, HIGH, or URGENT.`,
    );
  }

  async createTicket(userId: string, dto: CreateTicketDto) {
    this.ensureDbConnected();

    const canonicalUserId = await this.resolveCanonicalUserId(userId);
    const category = this.normalizeCategory(dto.category);
    const priority = this.normalizePriority(dto.priority);

    let resolvedOrderId: string | null = null;
    if (dto.orderId && dto.orderId.trim().length > 0) {
      const order = await this.prisma.order.findFirst({
        where: {
          OR: [{ id: dto.orderId.trim() }, { orderNumber: dto.orderId.trim() }],
        },
        select: { id: true, customerId: true },
      });

      if (!order) {
        throw new NotFoundException(`Order '${dto.orderId}' not found.`);
      }

      if (order.customerId !== canonicalUserId) {
        throw new ForbiddenException('You can only open order support tickets for your own orders.');
      }

      resolvedOrderId = order.id;
    }

    return this.prisma.supportTicket.create({
      data: {
        id: `tkt-${randomUUID().slice(0, 8)}`,
        userId: canonicalUserId,
        orderId: resolvedOrderId,
        title: dto.title.trim(),
        description: dto.description?.trim() || '',
        category,
        priority,
        status: 'OPEN',
      },
    });
  }

  async getTickets(userId: string) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId);

    return this.prisma.supportTicket.findMany({
      where: { userId: canonicalUserId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTicketById(userId: string, id: string) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId);

    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });

    if (!ticket) {
      throw new NotFoundException(`Support ticket '${id}' not found.`);
    }

    if (ticket.userId !== canonicalUserId) {
      throw new ForbiddenException('Access denied for this support ticket.');
    }

    return ticket;
  }
}
