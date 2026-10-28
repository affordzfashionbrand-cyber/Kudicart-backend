import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateCustomerStatusDto } from '../dto/admin-actions.dto';

@Injectable()
export class AdminUsersService {
  constructor(private prisma: PrismaService) {}

  async listCustomers(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let customers = store.adminCustomers || [];

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
    const store = this.prisma.getStore();
    const cleanId = id.trim().replace(/^#/, '');

    const customer = (store.adminCustomers || []).find(
      (c: any) =>
        c.id === cleanId ||
        c.customerNumber.replace(/^#/, '') === cleanId ||
        c.id === `usr-${cleanId}`,
    );

    if (!customer) {
      throw new NotFoundException(`Customer record "${id}" was not found.`);
    }

    // Link live addresses, orders, reviews, tickets if available
    const addresses = store.addresses.filter((a: any) => a.userId === customer.id);
    const orders = store.orders.filter((o: any) => o.customerId === customer.id);
    const reviews = store.reviews.filter((r: any) => r.userId === customer.id);
    const tickets = store.tickets.filter((t: any) => t.userId === customer.id);

    return {
      ...customer,
      addresses: addresses.length > 0 ? addresses : customer.addresses || [],
      orders: orders.length > 0
        ? orders.map((o: any) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            createdAt: o.createdAt,
            vendorName: o.vendorName || 'Avanya Ethnic Boutique',
            itemCount: o.items ? o.items.length : 1,
            totalAmount: o.grandTotal,
            paymentMethod: o.paymentMethod === 'RAZORPAY' ? 'Razorpay UPI' : 'Cash on Delivery',
            paymentStatus: o.paymentStatus === 'COMPLETED' ? 'PAID' : 'PENDING',
            status: o.status,
          }))
        : customer.orders || [],
      reviews: reviews.length > 0 ? reviews : customer.reviews || [],
      tickets: tickets.length > 0 ? tickets : customer.tickets || [],
    };
  }

  async updateCustomerStatus(
    id: string,
    dto: UpdateCustomerStatusDto,
    actorId?: string,
    actorName?: string,
  ) {
    const store = this.prisma.getStore();
    const cleanId = id.trim().replace(/^#/, '');

    const customer = (store.adminCustomers || []).find(
      (c: any) =>
        c.id === cleanId ||
        c.customerNumber.replace(/^#/, '') === cleanId ||
        c.id === `usr-${cleanId}`,
    );

    if (!customer) {
      throw new NotFoundException(`Customer record "${id}" was not found.`);
    }

    const previousStatus = customer.status;
    customer.status = dto.status;

    // Record audit event
    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'CUSTOMER_TIER_UPGRADE' as any,
      entityId: customer.id,
      entityName: customer.name,
      entityType: 'Customer' as any,
      summary: `Customer account status updated for ${customer.name}: ${previousStatus} -> ${dto.status}`,
      targetDescription: `Customer Profile #${customer.customerNumber}`,
      changePayload: {
        previousStatus,
        newStatus: dto.status,
        reason: dto.reason || 'Admin status change',
      },
      entityLink: `/admin/users/${customer.id}`,
    });

    return {
      success: true,
      message: `Customer status updated to ${dto.status} successfully`,
      customer,
    };
  }
}

