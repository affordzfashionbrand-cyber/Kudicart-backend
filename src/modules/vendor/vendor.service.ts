import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class VendorService {
  private readonly logger = new Logger(VendorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  private resolveVendorId(userId?: string): string {
    const store = this.prisma.getStore();
    const vendor = store.vendors.find((v) => v.userId === userId || v.id === userId);
    return vendor ? vendor.id : userId || 'vend-1';
  }

  async getOrders(userId: string, role: string, status?: string) {
    const vendorId = this.resolveVendorId(userId);
    const store = this.prisma.getStore();

    let orders: any[];
    if (this.prisma.isConnectedToDb) {
      try {
        const whereClause: any = role === Role.ADMIN ? {} : { vendorId };
        if (status && status !== 'ALL') {
          whereClause.status = status;
        }
        const dbOrders = await this.prisma.order.findMany({
          where: whereClause,
          include: {
            items: true,
            history: { orderBy: { createdAt: 'asc' } },
            address: true,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (dbOrders && dbOrders.length > 0) {
          orders = dbOrders;
        } else {
          orders = store.orders.filter((o) => role === Role.ADMIN || o.vendorId === vendorId);
        }
      } catch (err: any) {
        this.logger.error(`Database getOrders failed: ${err.message}`);
        orders = store.orders.filter((o) => role === Role.ADMIN || o.vendorId === vendorId);
      }
    } else {
      orders = store.orders.filter((o) => role === Role.ADMIN || o.vendorId === vendorId);
    }

    if (status && status !== 'ALL') {
      orders = orders.filter((o) => o.status === status);
    }

    return orders.map((o) => this.formatVendorOrder(o));
  }

  async getOrderById(userId: string, role: string, orderId: string) {
    const vendorId = this.resolveVendorId(userId);
    const order = await this.ordersService.getOrderById(orderId);

    if (role !== Role.ADMIN && order.vendorId && order.vendorId !== vendorId) {
      throw new ForbiddenException('You are not authorized to view orders for this vendor');
    }

    return this.formatVendorOrder(order);
  }

  async acceptOrder(userId: string, role: string, orderId: string) {
    await this.getOrderById(userId, role, orderId);
    return this.ordersService.vendorAccept(orderId, Role.VENDOR);
  }

  async prepareOrder(userId: string, role: string, orderId: string) {
    await this.getOrderById(userId, role, orderId);
    return this.ordersService.vendorPrepare(orderId, Role.VENDOR);
  }

  async readyForPickup(userId: string, role: string, orderId: string) {
    await this.getOrderById(userId, role, orderId);
    return this.ordersService.vendorReadyForPickup(orderId, Role.VENDOR);
  }

  private formatVendorOrder(order: any) {
    const store = this.prisma.getStore();
    const customer = store.users.find((u) => u.id === order.customerId);
    const address = order.deliveryAddress || store.addresses.find((a) => a.id === order.addressId);

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      placedTime: order.createdAt || new Date().toISOString(),
      customerName: customer?.name || 'Customer',
      customerArea: address ? `${address.locality || ''}, ${address.city || ''}` : 'Bengaluru',
      items: (order.items || []).map((i: any) => ({
        id: i.id,
        productId: i.productId,
        title: i.title,
        variant: `Size: ${i.size || 'M'}`,
        quantity: i.quantity || 1,
        price: i.price || 0,
      })),
      totalAmount: order.grandTotal || order.itemTotal || 0,
      fulfillmentType: order.isTryAndBuy ? 'Try & Buy' : 'Standard',
      deliveryFee: order.deliveryFee,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
    };
  }
}

