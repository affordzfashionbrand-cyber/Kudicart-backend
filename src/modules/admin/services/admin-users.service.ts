import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateCustomerStatusDto } from '../dto/admin-actions.dto';

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(private prisma: PrismaService) {}

  async listCustomers(query: AdminQueryDto) {
    if (this.prisma.isConnectedToDb) {
      try {
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
        const page = Number(query.page) || 1;
        const limit = Number(query.limit) || 10;
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
      } catch (err: any) {
        this.logger.error(`Database listCustomers failed: ${err.message}`, err.stack);
      }
    }

    // In-memory store fallback for offline dev/test
    const store = this.prisma.getStore();
    let customers = store.users
      .filter((u: any) => u.role === 'CUSTOMER')
      .map((u: any) => {
        const addresses = store.addresses.filter((a: any) => a.userId === u.id);
        const orders = store.orders.filter((o: any) => o.customerId === u.id);
        const totalOrders = orders.length;
        const totalSpent = orders.reduce((sum: number, o: any) => sum + (o.grandTotal || 0), 0);
        const avgOrderValue = totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0;

        return {
          id: u.id,
          customerNumber: `#CUS-${u.id.replace(/^usr-/, '').toUpperCase()}`,
          name: u.name,
          email: u.email || '—',
          phone: u.phone,
          avatar: u.avatar,
          registrationDate: u.createdAt || new Date().toISOString(),
          status: u.status || 'ACTIVE',
          totalOrders,
          totalSpent,
          avgOrderValue,
          addresses,
        };
      });

    // Filter by search term
    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      customers = customers.filter(
        (c: any) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.customerNumber.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q),
      );
    }

    // Filter by status
    if (query.status && query.status !== 'ALL') {
      customers = customers.filter((c: any) => c.status === query.status);
    }

    // Filter by date range
    if (query.dateRange && query.dateRange !== 'ALL') {
      const now = new Date();
      customers = customers.filter((c: any) => {
        const regDate = new Date(c.registrationDate || c.createdAt);
        const diffDays = (now.getTime() - regDate.getTime()) / (1000 * 3600 * 24);
        if (query.dateRange === 'TODAY') return diffDays <= 1;
        if (query.dateRange === '7_DAYS' || query.dateRange === '7DAYS') return diffDays <= 7;
        if (query.dateRange === '30_DAYS' || query.dateRange === '30DAYS') return diffDays <= 30;
        return true;
      });
    }

    const total = customers.length;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const paginated = customers.slice(startIndex, startIndex + limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getCustomerById(id: string) {
    const cleanId = id.trim().replace(/^#/, '').replace(/^CUS-/, 'usr-');

    if (this.prisma.isConnectedToDb) {
      try {
        const user = await this.prisma.user.findFirst({
          where: {
            OR: [
              { id: cleanId },
              { id: id.trim() },
              { id: `usr-${cleanId}` },
            ],
            role: 'CUSTOMER',
          },
          include: {
            addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] },
            orders: {
              orderBy: { createdAt: 'desc' },
              include: { items: true },
            },
            reviews: { orderBy: { createdAt: 'desc' } },
            tickets: { orderBy: { createdAt: 'desc' } },
          },
        });

        if (user) {
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
              vendorName: 'Avanya Ethnic Boutique',
              itemCount: o.items ? o.items.length : 1,
              totalAmount: o.grandTotal,
              paymentMethod: o.paymentMethod === 'RAZORPAY' ? 'Razorpay UPI' : 'Cash on Delivery',
              paymentStatus: o.paymentStatus === 'COMPLETED' ? 'PAID' : 'PENDING',
              status: o.status,
            })),
            reviews: user.reviews || [],
            tickets: user.tickets || [],
          };
        }
      } catch (err: any) {
        this.logger.error(`Database getCustomerById failed: ${err.message}`, err.stack);
      }
    }

    // In-memory store fallback
    const store = this.prisma.getStore();
    const user = store.users.find(
      (u: any) =>
        (u.id === cleanId ||
          u.id === id.trim() ||
          u.id === `usr-${cleanId}` ||
          (u as any).customerNumber?.replace(/^#/, '') === cleanId) &&
        u.role === 'CUSTOMER',
    );

    if (!user) {
      throw new NotFoundException(`Customer record "${id}" was not found.`);
    }

    const addresses = store.addresses.filter((a: any) => a.userId === user.id);
    const orders = store.orders.filter((o: any) => o.customerId === user.id);
    const reviews = store.reviews.filter((r: any) => r.userId === user.id);
    const tickets = store.tickets.filter((t: any) => t.userId === user.id);

    const totalOrders = orders.length;
    const totalSpent = orders.reduce((sum: number, o: any) => sum + (o.grandTotal || 0), 0);
    const avgOrderValue = totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0;

    return {
      id: user.id,
      customerNumber: `#CUS-${user.id.replace(/^usr-/, '').toUpperCase()}`,
      name: user.name,
      email: user.email || '—',
      phone: user.phone,
      avatar: user.avatar,
      registrationDate: user.createdAt || new Date().toISOString(),
      status: (user as any).status || 'ACTIVE',
      totalOrders,
      totalSpent,
      avgOrderValue,
      addresses,
      orders: orders.map((o: any) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        vendorName: o.vendorName || 'Avanya Ethnic Boutique',
        itemCount: o.items ? o.items.length : 1,
        totalAmount: o.grandTotal,
        paymentMethod: o.paymentMethod === 'RAZORPAY' ? 'Razorpay UPI' : 'Cash on Delivery',
        paymentStatus: o.paymentStatus === 'COMPLETED' ? 'PAID' : 'PENDING',
        status: o.status,
      })),
      reviews,
      tickets,
    };
  }

  async updateCustomerStatus(
    id: string,
    dto: UpdateCustomerStatusDto,
    actorId?: string,
    actorName?: string,
  ) {
    const cleanId = id.trim().replace(/^#/, '').replace(/^CUS-/, 'usr-');
    let user: any = null;

    if (this.prisma.isConnectedToDb) {
      try {
        user = await this.prisma.user.findFirst({
          where: {
            OR: [{ id: cleanId }, { id: id.trim() }, { id: `usr-${cleanId}` }],
            role: 'CUSTOMER',
          },
        });
        if (user) {
          const previousStatus = user.status;
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: { status: dto.status as any },
          });

          // Sync store
          const storeUser = this.prisma.getStore().users.find((u: any) => u.id === user.id);
          if (storeUser) (storeUser as any).status = dto.status;

          // Record audit event
          this.prisma.recordAuditEvent({
            actorId,
            actorName,
            actionType: 'CUSTOMER_STATUS_UPDATE' as any,
            entityId: user.id,
            entityName: user.name,
            entityType: 'Customer' as any,
            summary: `Customer account status updated for ${user.name}: ${previousStatus} -> ${dto.status}`,
            targetDescription: `Customer Profile #${user.id}`,
            changePayload: {
              previousStatus,
              newStatus: dto.status,
              reason: dto.reason || 'Admin status change',
            },
            entityLink: `/admin/users/${user.id}`,
          });

          return {
            success: true,
            message: `Customer status updated to ${dto.status} successfully`,
            customer: user,
          };
        }
      } catch (err: any) {
        this.logger.error(`Database updateCustomerStatus failed: ${err.message}`, err.stack);
      }
    }

    // In-memory store fallback
    const store = this.prisma.getStore();
    user = store.users.find(
      (u: any) =>
        (u.id === cleanId ||
          u.id === id.trim() ||
          u.id === `usr-${cleanId}` ||
          (u as any).customerNumber?.replace(/^#/, '') === cleanId) &&
        u.role === 'CUSTOMER',
    );

    if (!user) {
      throw new NotFoundException(`Customer record "${id}" was not found.`);
    }

    const previousStatus = (user as any).status || 'ACTIVE';
    (user as any).status = dto.status;

    // Record audit event
    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'CUSTOMER_STATUS_UPDATE' as any,
      entityId: user.id,
      entityName: user.name,
      entityType: 'Customer' as any,
      summary: `Customer account status updated for ${user.name}: ${previousStatus} -> ${dto.status}`,
      targetDescription: `Customer Profile #${user.id}`,
      changePayload: {
        previousStatus,
        newStatus: dto.status,
        reason: dto.reason || 'Admin status change',
      },
      entityLink: `/admin/users/${user.id}`,
    });

    return {
      success: true,
      message: `Customer status updated to ${dto.status} successfully`,
      customer: user,
    };
  }
}
