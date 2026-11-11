import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { AdminAssignDriverDto } from '../dto/admin-domain.dto';
import { OrderTransitionService } from '../../orders/order-transition.service';
import { Role } from '../../../common/enums/role.enum';
import { OrderStatus } from '../../../common/contracts/order-contracts';

const ADMIN_ORDER_INCLUDE = {
  customer: {
    select: { id: true, name: true, phone: true, email: true },
  },
  vendor: true,
  address: true,
  driver: {
    select: { id: true, name: true, phone: true },
  },
  driverProfile: true,
  items: true,
  history: { orderBy: { createdAt: 'asc' as const } },
  tryAndBuySession: true,
  checkoutGroup: true,
};

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderTransition: OrderTransitionService,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private mapOrderToAdmin(order: any) {
    const addr = order.deliveryAddress || order.address || {};
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      version: order.version ?? 1,
      checkoutGroupId: order.checkoutGroupId ?? null,
      groupNumber: order.checkoutGroup?.groupNumber ?? null,
      status: order.status,
      fulfillmentType: order.fulfillmentType || 'DARK_STORE',
      isTryAndBuy: Boolean(order.isTryAndBuy),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      razorpayOrderId: order.razorpayOrderId ?? null,
      razorpayPaymentId: order.razorpayPaymentId ?? null,
      customerId: order.customerId,
      customerName: order.customer?.name || addr.recipientName || 'Customer',
      customerPhone: order.customer?.phone || addr.recipientPhone || null,
      deliveryAddress: {
        line1: addr.line1 || null,
        line2: addr.line2 || null,
        locality: addr.locality || null,
        city: addr.city || null,
        pincode: addr.pincode || null,
        label: addr.label || null,
      },
      vendorId: order.vendorId ?? null,
      vendorName: order.vendor?.storeName || 'Affordz Official Store',
      driverId: order.driverId ?? null,
      driverProfileId: order.driverProfileId ?? null,
      driverName: order.driverProfile?.fullName || order.driver?.name || null,
      driverPhone: order.driverProfile?.phone || order.driver?.phone || null,
      driverVehicle: order.driverProfile?.vehicleType || null,
      itemTotal: Math.round(order.itemTotal || 0),
      deliveryFee: Math.round(order.deliveryFee || 0),
      taxes: Math.round(order.taxes || 0),
      giftWrapFee: Math.round(order.giftWrapFee || 0),
      donationAmount: Math.round(order.donationAmount || 0),
      discountAmount: Math.round(order.discountAmount || 0),
      couponCode: order.couponCode ?? null,
      grandTotal: Math.round(order.grandTotal || 0),
      etaMinutes: order.etaMinutes ?? 0,
      arrivedAt: order.arrivedAt ? new Date(order.arrivedAt).toISOString() : null,
      deliveredAt: order.deliveredAt ? new Date(order.deliveredAt).toISOString() : null,
      cancelledAt: order.cancelledAt ? new Date(order.cancelledAt).toISOString() : null,
      cancellationReason: order.cancellationReason ?? null,
      rejectedByVendor: Boolean(order.rejectedByVendor),
      expiresAt: order.expiresAt ? new Date(order.expiresAt).toISOString() : null,
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
      updatedAt: order.updatedAt ? new Date(order.updatedAt).toISOString() : null,
      items: order.items || [],
      history: (order.history || []).map((h: any) => ({
        id: h.id,
        status: h.status,
        note: h.note,
        actorId: h.actorId ?? null,
        actorRole: h.actorRole ?? null,
        createdAt: h.createdAt ? new Date(h.createdAt).toISOString() : null,
      })),
      tryAndBuySession: order.tryAndBuySession || null,
    };
  }

  async listOrders(query: AdminQueryDto) {
    this.ensureDbConnected();

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;

    const where: any = {};
    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }
    if (query.fulfillmentType && query.fulfillmentType !== 'ALL') {
      if (query.fulfillmentType === 'TRY_AND_BUY') {
        where.isTryAndBuy = true;
      } else {
        where.fulfillmentType = query.fulfillmentType;
      }
    }
    if (query.vendor && query.vendor !== 'ALL') {
      where.vendorId = query.vendor;
    }

    const rawOrders = await this.prisma.order.findMany({
      where,
      include: ADMIN_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    let mapped = rawOrders.map((o) => this.mapOrderToAdmin(o));

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      mapped = mapped.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          (o.customerName || '').toLowerCase().includes(q) ||
          (o.vendorName || '').toLowerCase().includes(q) ||
          (o.driverName || '').toLowerCase().includes(q),
      );
    }

    const total = mapped.length;
    const paginated = mapped.slice((page - 1) * limit, page * limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getOrderById(id: string) {
    this.ensureDbConnected();
    const cleanId = id.trim().replace(/^#/, '');

    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id }, { id: cleanId }, { orderNumber: cleanId }],
      },
      include: ADMIN_ORDER_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException(`Order #${id} could not be located.`);
    }

    return this.mapOrderToAdmin(order);
  }

  async assignDriver(
    orderId: string,
    dto: AdminAssignDriverDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDbConnected();
    const cleanId = orderId.trim().replace(/^#/, '');

    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }],
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found.`);
    }

    const driver = await this.prisma.driverProfile.findFirst({
      where: {
        OR: [{ id: dto.driverId }, { userId: dto.driverId }],
      },
      include: { user: true },
    });

    if (!driver) {
      throw new NotFoundException(`Delivery partner '${dto.driverId}' not found.`);
    }

    if (driver.kycStatus !== 'APPROVED') {
      throw new BadRequestException(
        `Cannot assign rider '${driver.fullName}': KYC status is '${driver.kycStatus}'.`,
      );
    }

    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'ASSIGNED' as OrderStatus,
      actorRole: Role.ADMIN,
      actorId: actorId || null,
      actorName: actorName || 'Operations Admin',
      note:
        dto.note?.trim() ||
        `Admin ${actorName || actorId || ''} manually assigned rider ${driver.fullName}`.trim(),
      auditAction: 'ADMIN_MANUAL_DRIVER_ASSIGNED',
      extraOrderUpdate: {
        driverId: driver.userId,
        driverProfileId: driver.id,
      },
    });

    return {
      success: true,
      message: `Successfully assigned ${driver.fullName} to order #${order.orderNumber}.`,
      order: this.mapOrderToAdmin(updated),
    };
  }

  async listAssignments(query: AdminQueryDto) {
    this.ensureDbConnected();

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['READY_FOR_PICKUP', 'ASSIGNED'] },
      },
      include: ADMIN_ORDER_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    let mapped = orders.map((o) => this.mapOrderToAdmin(o));

    if (query.status && query.status !== 'ALL') {
      if (query.status === 'READY') {
        mapped = mapped.filter((o) => o.status === 'READY_FOR_PICKUP');
      } else {
        mapped = mapped.filter((o) => o.status === query.status);
      }
    }

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      mapped = mapped.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          (o.customerName || '').toLowerCase().includes(q) ||
          (o.vendorName || '').toLowerCase().includes(q) ||
          (o.driverName || '').toLowerCase().includes(q),
      );
    }

    return {
      data: mapped,
      total: mapped.length,
      readyCount: mapped.filter((o) => o.status === 'READY_FOR_PICKUP').length,
      assignedCount: mapped.filter((o) => o.status === 'ASSIGNED').length,
    };
  }
}
