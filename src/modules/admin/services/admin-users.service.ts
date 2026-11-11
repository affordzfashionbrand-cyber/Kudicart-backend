import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateCustomerStatusDto } from '../dto/admin-actions.dto';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDb() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }
  }

  async listCustomers(query: AdminQueryDto) {
    this.ensureDb();

    const where: any = { role: 'CUSTOMER' };

    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { id: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    if (query.dateRange && query.dateRange !== 'ALL') {
      const now = new Date();
      if (query.dateRange === 'TODAY') {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        where.createdAt = { gte: today };
      } else if (query.dateRange === '7_DAYS' || query.dateRange === '7DAYS') {
        const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
        where.createdAt = { gte: d7 };
      } else if (query.dateRange === '30_DAYS' || query.dateRange === '30DAYS') {
        const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
        where.createdAt = { gte: d30 };
      }
    }

    const total = await this.prisma.user.count({ where });
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const dbUsers = await this.prisma.user.findMany({
      where,
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] },
        orders: { select: { id: true, grandTotal: true, status: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    const data = dbUsers.map((u) => {
      const totalOrders = u.orders.length;
      const totalSpent = u.orders.reduce((sum, o) => sum + (o.grandTotal || 0), 0);
      const avgOrderValue = totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0;
      return {
        id: u.id,
        customerNumber: `#CUS-${u.id.replace(/^usr-/, '').toUpperCase()}`,
        name: u.name,
        email: u.email || '—',
        phone: u.phone,
        avatar: u.avatar,
        registrationDate: u.createdAt.toISOString(),
        status: u.status,
        totalOrders,
        totalSpent,
        avgOrderValue,
        addresses: u.addresses,
      };
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getCustomerById(id: string) {
    this.ensureDb();

    const rawId = id.trim();
    const cleanId = rawId.replace(/^#/, '').replace(/^CUS-/i, 'usr-');
    const lowerClean = rawId.replace(/^#/, '').replace(/^CUS-/i, '').toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: rawId }, { id: cleanId }, { id: `usr-${lowerClean}` }],
        role: 'CUSTOMER',
      },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] },
        orders: {
          orderBy: { createdAt: 'desc' },
          include: { items: true, vendor: true },
        },
        reviews: { orderBy: { createdAt: 'desc' } },
        tickets: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!user) {
      throw new NotFoundException(`Customer record "${id}" was not found.`);
    }

    const totalOrders = user.orders.length;
    const totalSpent = user.orders.reduce((sum, o) => sum + (o.grandTotal || 0), 0);
    const avgOrderValue = totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0;

    return {
      id: user.id,
      customerNumber: `#CUS-${user.id.replace(/^usr-/, '').toUpperCase()}`,
      name: user.name,
      email: user.email || '—',
      phone: user.phone,
      avatar: user.avatar,
      registrationDate: user.createdAt.toISOString(),
      status: user.status,
      totalOrders,
      totalSpent,
      avgOrderValue,
      addresses: user.addresses,
      orders: user.orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt.toISOString(),
        vendorName: o.vendor?.storeName || 'Affordz Official Store',
        itemCount: o.items ? o.items.length : 0,
        totalAmount: o.grandTotal,
        paymentMethod: o.paymentMethod === 'RAZORPAY' ? 'Razorpay UPI' : 'Cash on Delivery',
        paymentStatus: o.paymentStatus === 'COMPLETED' ? 'PAID' : 'PENDING',
        status: o.status,
      })),
      reviews: user.reviews || [],
      tickets: user.tickets || [],
    };
  }

  async updateCustomerStatus(
    id: string,
    dto: UpdateCustomerStatusDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDb();

    const rawId = id.trim();
    const cleanId = rawId.replace(/^#/, '').replace(/^CUS-/i, 'usr-');
    const lowerClean = rawId.replace(/^#/, '').replace(/^CUS-/i, '').toLowerCase();

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: rawId }, { id: cleanId }, { id: `usr-${lowerClean}` }],
        role: 'CUSTOMER',
      },
    });

    if (!existing) {
      throw new NotFoundException(`Customer record "${id}" was not found.`);
    }

    const previousStatus = existing.status;
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: { status: dto.status as any },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId || 'ADMIN',
          userEmail: actorName || null,
          userRole: 'ADMIN',
          action: 'CUSTOMER_STATUS_UPDATE',
          entityType: 'Customer',
          entityId: updated.id,
          details: JSON.stringify({
            customerName: updated.name,
            previousStatus,
            newStatus: dto.status,
            reason: dto.reason || 'Admin status change',
          }),
        },
      });

      return updated;
    });

    return {
      success: true,
      message: `Customer status updated to ${dto.status} successfully`,
      customer: user,
    };
  }
}
