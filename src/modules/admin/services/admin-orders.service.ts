import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { AdminAssignDriverDto } from '../dto/admin-domain.dto';

@Injectable()
export class AdminOrdersService {
  constructor(private prisma: PrismaService) {}

  private mapOrderToAdmin(order: any, store: any) {
    const customer = (store.users || []).find((u: any) => u.id === order.customerId) || {
      name: 'Ananya Sharma',
      phone: '+91 98450 12890',
    };
    const address = (store.addresses || []).find((a: any) => a.id === order.addressId) || {
      line1: 'Apt 4B, Sunrise Heights, 42 Westend Boulevard',
      locality: 'Indiranagar',
      city: 'Bengaluru',
      pincode: '560038',
      label: 'Home',
    };
    const vendor = (store.adminVendors || []).find((v: any) => v.id === order.vendorId) || {
      storeName: 'Avanya Ethnic Boutique',
      operatingHub: 'Indiranagar Express Hub, Bengaluru',
      registeredAddress: '100ft Road, HAL 2nd Stage, Indiranagar',
    };

    let assignedDriverInfo = null;
    if (order.driverId) {
      const driver = (store.adminDrivers || []).find(
        (d: any) => d.id === order.driverId || d.userId === order.driverId,
      ) || (store.drivers || []).find((d: any) => d.id === order.driverId);

      if (driver) {
        assignedDriverInfo = {
          id: driver.id,
          fullName: driver.fullName || driver.name || 'Rajesh Kumar',
          phone: driver.phone || '+91 98765 43210',
          vehicleType: driver.vehicleType || 'EV Scooty',
          vehicleModel: driver.vehicleModel || (driver.vehicleDetails ? driver.vehicleDetails.model : 'Ather 450X Gen 3'),
          vehicleRegistration: driver.vehicleRegistration || (driver.vehicleDetails ? driver.vehicleDetails.registrationNumber : 'KA 03 EV 4821'),
          completedDeliveries: driver.completedDeliveries || 428,
          kycStatus: driver.kycStatus || 'APPROVED',
        };
      }
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      customerName: order.customerName || customer.name,
      customerPhone: order.customerPhone || customer.phone,
      customerAddress: {
        line1: address.line1,
        locality: address.locality,
        city: address.city,
        pincode: address.pincode,
        label: address.label,
      },
      vendorId: order.vendorId || vendor.id,
      vendorName: order.vendorName || vendor.storeName,
      pickupHub: order.pickupHub || vendor.operatingHub || 'Indiranagar Express Hub',
      pickupAddress: order.pickupAddress || vendor.registeredAddress || 'Shop 14, 100ft Road, Indiranagar',
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      fulfillmentType: order.isTryAndBuy ? 'Try & Buy' : 'Express (60m)',
      itemTotal: order.itemTotal,
      deliveryFee: order.deliveryFee,
      taxes: order.taxes,
      discountAmount: order.discountAmount || 0,
      grandTotal: order.grandTotal,
      isTryAndBuy: !!order.isTryAndBuy,
      tryAndBuyDetails: order.isTryAndBuy
        ? {
            stage: 'HANDOVER_PENDING',
            trialDurationMinutes: 20,
            handoverConfirmedAt: order.history?.find((h: any) => h.status === 'OUT_FOR_DELIVERY')?.time,
          }
        : undefined,
      assignedDriver: assignedDriverInfo,
      createdAt: order.createdAt,
      items: (order.items || []).map((it: any) => ({
        id: it.id,
        productId: it.productId,
        title: it.title,
        brand: it.brand,
        size: it.size,
        trialSize: it.trialSize || null,
        price: it.price,
        originalPrice: it.price * 1.5,
        quantity: it.quantity,
        image: it.image || 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=400&q=80',
      })),
      history: (order.history || []).map((h: any) => ({
        status: h.status,
        timestamp: h.time || h.timestamp || h.createdAt || 'Today',
        performer: h.actor || h.performer || 'System',
        note: h.note,
      })),
    };
  }

  async listOrders(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let orders = store.orders.map((o: any) => this.mapOrderToAdmin(o, store));

    // Filter by tab / status
    if (query.status && query.status !== 'ALL') {
      orders = orders.filter((o: any) => o.status === query.status);
    }

    // Filter by fulfillment type
    if (query.fulfillmentType && query.fulfillmentType !== 'ALL') {
      orders = orders.filter((o: any) => o.fulfillmentType === query.fulfillmentType);
    }

    // Filter by date range
    if (query.dateRange && query.dateRange !== 'ALL') {
      const now = new Date();
      orders = orders.filter((o: any) => {
        const orderDate = new Date(o.createdAt);
        const diffDays = (now.getTime() - orderDate.getTime()) / (1000 * 3600 * 24);
        if (query.dateRange === 'TODAY') return diffDays <= 1;
        if (query.dateRange === '7DAYS') return diffDays <= 7;
        if (query.dateRange === '30DAYS') return diffDays <= 30;
        return true;
      });
    }

    // Filter by search query
    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      orders = orders.filter(
        (o: any) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.customerPhone.includes(q) ||
          o.vendorName.toLowerCase().includes(q) ||
          o.pickupHub.toLowerCase().includes(q) ||
          o.items.some((item: any) => item.title.toLowerCase().includes(q)),
      );
    }

    const total = orders.length;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 8;
    const startIndex = (page - 1) * limit;
    const paginated = orders.slice(startIndex, startIndex + limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getOrderById(id: string) {
    const store = this.prisma.getStore();
    const cleanId = id.trim().replace(/^#/, '');

    const order = store.orders.find(
      (o: any) => o.id === cleanId || o.orderNumber.replace(/^#/, '') === cleanId,
    );

    if (!order) {
      throw new NotFoundException(`Order record '${id}' was not found.`);
    }

    return this.mapOrderToAdmin(order, store);
  }

  async assignDriver(
    orderId: string,
    dto: AdminAssignDriverDto,
    actorId?: string,
    actorName?: string,
  ) {
    const store = this.prisma.getStore();
    const cleanOrderId = orderId.trim().replace(/^#/, '');

    const order = store.orders.find(
      (o: any) => o.id === cleanOrderId || o.orderNumber.replace(/^#/, '') === cleanOrderId,
    );

    if (!order) {
      throw new NotFoundException(`Order record '${orderId}' was not found.`);
    }

    // Validate order status
    if (order.status !== 'READY_FOR_PICKUP' && order.status !== 'ASSIGNED') {
      throw new BadRequestException(
        `Order #${order.orderNumber} is in '${order.status}' status. Only orders Ready for Pickup can be assigned.`,
      );
    }

    // Validate driver
    const driver = (store.adminDrivers || []).find(
      (d: any) => d.id === dto.driverId || d.driverCode?.replace(/^#/, '') === dto.driverId,
    ) || (store.drivers || []).find((d: any) => d.id === dto.driverId);

    if (!driver) {
      throw new NotFoundException(`Delivery partner with ID '${dto.driverId}' was not found.`);
    }

    const previousStatus = order.status;
    order.status = 'ASSIGNED';
    order.driverId = driver.id;
    order.updatedAt = new Date().toISOString();

    const now = new Date();
    const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;

    if (!order.history) (order as any).history = [];
    (order.history as any).push({
      status: 'ASSIGNED',
      time: timeStr,
      timestamp: now.toISOString(),
      actor: 'ADMIN',
      performer: actorName || 'Operations Admin',
      note: dto.note || `Admin assigned rider ${driver.fullName || driver.name}`,
    });

    // Record audit event
    const pickupHub = (order as any).pickupHub || 'Pickup Hub';
    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'DRIVER_ASSIGNED_MANUAL' as any,
      entityId: order.orderNumber,
      entityName: `Order #${order.orderNumber}`,
      entityType: 'Order' as any,
      summary: `Manually assigned delivery partner ${driver.fullName || driver.name} to order #${order.orderNumber}`,
      targetDescription: `Order #${order.orderNumber} Ready for Pickup at ${pickupHub}`,
      changePayload: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        previousStatus,
        newStatus: 'ASSIGNED',
        assignedDriverId: driver.id,
        assignedDriverName: driver.fullName || driver.name,
      },
      entityLink: `/admin/orders/${order.id}`,
    });

    // Record driver notification
    if (store.operationalNotifications) {
      store.operationalNotifications.unshift({
        id: `NOTIF-${Date.now().toString().slice(-4)}`,
        timestamp: timeStr,
        timestampFull: now.toLocaleString(),
        category: 'Assignment',
        targetRole: 'Driver',
        recipientName: driver.fullName || driver.name,
        recipientId: driver.id,
        title: `New Delivery Assignment #${order.orderNumber}`,
        messagePreview: `Order #${order.orderNumber} is ready for boutique pickup.`,
        messageFull: `Order #${order.orderNumber} assigned for express delivery. Pickup: ${pickupHub}.`,
        deliveryStatus: 'Delivered',
        deliveryChannel: 'Push Notification',
        read: false,
        priority: 'Informational',
      });
    }

    return {
      success: true,
      message: `Successfully assigned ${driver.fullName || driver.name} to order #${order.orderNumber}.`,
      order: this.mapOrderToAdmin(order, store),
    };
  }

  async listAssignments(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let orders = store.orders
      .filter((o: any) => o.status === 'READY_FOR_PICKUP' || o.status === 'ASSIGNED')
      .map((o: any) => this.mapOrderToAdmin(o, store));

    if (query.status && query.status !== 'ALL') {
      if (query.status === 'READY') {
        orders = orders.filter((o: any) => o.status === 'READY_FOR_PICKUP');
      } else if (query.status === 'ASSIGNED') {
        orders = orders.filter((o: any) => o.status === 'ASSIGNED');
      }
    }

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      orders = orders.filter(
        (o: any) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.vendorName.toLowerCase().includes(q) ||
          (o.assignedDriver && o.assignedDriver.fullName.toLowerCase().includes(q)),
      );
    }

    return {
      data: orders,
      total: orders.length,
      readyCount: orders.filter((o: any) => o.status === 'READY_FOR_PICKUP').length,
      assignedCount: orders.filter((o: any) => o.status === 'ASSIGNED').length,
    };
  }
}
