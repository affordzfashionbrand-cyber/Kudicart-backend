import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachineService, OrderStatus } from './state-machine.service';
import { CheckoutDto } from './dto/checkout.dto';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private stateMachine: StateMachineService,
  ) {}

  async checkout(userId: string, dto: CheckoutDto) {
    const store = this.prisma.getStore();

    // 1. Validate Address
    const address = store.addresses.find((a) => a.id === dto.addressId && a.userId === userId);
    if (!address) {
      throw new NotFoundException(`Delivery address with ID ${dto.addressId} not found`);
    }

    // 2. Validate Cart
    const userCartItems = store.cartItems.filter((ci) => ci.userId === userId);
    if (userCartItems.length === 0) {
      throw new BadRequestException('Cannot checkout with an empty cart');
    }

    // 3. Validate Stock & Prepare Items
    const items = [];
    let detectedVendorId = 'vend-1';

    for (const ci of userCartItems) {
      const prod = store.products.find((p) => p.id === ci.productId);
      if (!prod) {
        throw new NotFoundException(`Product ${ci.productId} not found in catalog`);
      }
      if (prod.stockQuantity < ci.quantity) {
        throw new BadRequestException(
          `Insufficient stock for '${prod.title}'. Available: ${prod.stockQuantity}, Requested: ${ci.quantity}`,
        );
      }
      // Decrement available stock
      prod.stockQuantity -= ci.quantity;
      if (prod.vendorId) {
        detectedVendorId = prod.vendorId;
      }

      items.push({
        id: `oi-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        productId: ci.productId,
        title: prod.title,
        brand: prod.brand,
        size: ci.size,
        price: prod.price,
        quantity: ci.quantity,
        image: prod.image,
      });
    }

    // 4. Authoritative Pricing
    const itemTotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const deliveryFee = 40;
    const taxes = Math.round(itemTotal * 0.05); // 5% GST
    const grandTotal = itemTotal + deliveryFee + taxes;

    const orderNumber = `KC-${Math.floor(10000 + Math.random() * 90000)}`;
    const razorpayOrderId =
      dto.paymentMethod === 'RAZORPAY' ? `rzp_order_${Date.now()}` : undefined;

    const newOrder = {
      id: `ord-${Date.now()}`,
      orderNumber,
      customerId: userId,
      driverId: null as string | null,
      addressId: dto.addressId,
      vendorId: detectedVendorId,
      status: 'PLACED' as OrderStatus,
      paymentMethod: dto.paymentMethod,
      paymentStatus: 'PENDING',
      razorpayOrderId,
      razorpayPaymentId: null as string | null,
      itemTotal,
      deliveryFee,
      taxes,
      grandTotal,
      etaMinutes: 35,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items,
      history: [
        {
          status: 'PLACED' as OrderStatus,
          time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          note: 'Order confirmed and placed by customer',
          actor: 'CUSTOMER',
        },
      ],
    };

    store.orders.unshift(newOrder as any);

    // 5. Clear Cart
    store.cartItems = store.cartItems.filter((ci) => ci.userId !== userId);

    return newOrder;
  }

  async getOrders(userId: string, role: string = Role.CUSTOMER, driverId?: string) {
    const store = this.prisma.getStore();
    if (role === Role.ADMIN) {
      return store.orders;
    }
    if (role === Role.DRIVER) {
      const activeDriverId = driverId || 'drv-1';
      return store.orders.filter((o) => o.driverId === activeDriverId);
    }
    // Default to Customer
    return store.orders.filter((o) => o.customerId === userId);
  }

  async getOrderById(id: string, userId?: string, role?: string) {
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === id || o.orderNumber === id);
    if (!order) {
      throw new NotFoundException(`Order with identifier ${id} not found`);
    }

    if (role === Role.CUSTOMER && userId && order.customerId !== userId) {
      throw new ForbiddenException('You are not authorized to view this order');
    }

    // Attach driver details if assigned
    let driverInfo = null;
    if (order.driverId) {
      const drv = store.drivers.find((d) => d.id === order.driverId);
      if (drv) {
        driverInfo = {
          id: drv.id,
          name: drv.name,
          phone: drv.phone,
          vehicle: drv.vehicle,
          photo: drv.photo,
          rating: drv.rating,
          currentLocation: drv.currentLocation,
        };
      }
    }

    // Attach delivery address
    const address = store.addresses.find((a) => a.id === order.addressId);

    return {
      ...order,
      driver: driverInfo,
      deliveryAddress: address,
    };
  }

  async trackOrder(id: string) {
    const order = await this.getOrderById(id);
    const store = this.prisma.getStore();
    const milestones = this.stateMachine.getMilestones(order.status as OrderStatus);

    let driver = order.driver;
    if (!driver && order.driverId) {
      const drv = store.drivers.find((d) => d.id === order.driverId);
      if (drv) {
        driver = {
          id: drv.id,
          name: drv.name,
          phone: drv.phone,
          vehicle: drv.vehicle,
          photo: drv.photo,
          rating: drv.rating,
          currentLocation: drv.currentLocation,
        };
      }
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      etaMinutes: order.etaMinutes,
      itemTotal: order.itemTotal,
      deliveryFee: order.deliveryFee,
      taxes: order.taxes,
      grandTotal: order.grandTotal,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      driver: driver || null,
      deliveryAddress: order.deliveryAddress,
      items: order.items,
      milestones,
      history: order.history,
    };
  }

  // Admin Manual Assignment (D-006: Manual delivery assignment only - zero auto dispatch)
  async assignDriver(id: string, driverId: string, actorRole: string = Role.ADMIN) {
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === id || o.orderNumber === id);
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    const driver = store.drivers.find((d) => d.id === driverId);
    if (!driver) {
      throw new NotFoundException(`Driver with ID ${driverId} not found`);
    }

    // Validate state transition to ASSIGNED
    this.stateMachine.validateTransition(order.status as OrderStatus, 'ASSIGNED', actorRole);

    order.driverId = driver.id;
    order.status = 'ASSIGNED';
    order.updatedAt = new Date().toISOString();
    order.history.push({
      status: 'ASSIGNED',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: `Admin manually assigned rider ${driver.name} (${driver.vehicle})`,
      actor: actorRole,
    });

    return this.getOrderById(order.id);
  }

  // Vendor State Transitions
  async vendorAccept(id: string, actorRole: string = Role.VENDOR) {
    return this.updateStatus(id, 'ACCEPTED', 'Vendor accepted and confirmed order items', actorRole);
  }

  async vendorPrepare(id: string, actorRole: string = Role.VENDOR) {
    return this.updateStatus(id, 'PREPARING', 'Quality inspection & boutique gift packaging started', actorRole);
  }

  async vendorReadyForPickup(id: string, actorRole: string = Role.VENDOR) {
    return this.updateStatus(id, 'READY_FOR_PICKUP', 'Package ready at store pickup counter', actorRole);
  }

  async updateStatus(
    id: string,
    nextStatus: OrderStatus,
    note?: string,
    actorRole?: string,
  ) {
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === id || o.orderNumber === id);
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    this.stateMachine.validateTransition(order.status as OrderStatus, nextStatus, actorRole);

    order.status = nextStatus;
    order.updatedAt = new Date().toISOString();
    order.history.push({
      status: nextStatus,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: note || `Order transitioned to ${nextStatus}`,
      actor: actorRole || 'SYSTEM',
    });

    return this.getOrderById(order.id);
  }
}
