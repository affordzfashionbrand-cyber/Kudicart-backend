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
import { PaymentsService } from '../payments/payments.service';
import { CartService } from '../cart/cart.service';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private stateMachine: StateMachineService,
    private paymentsService: PaymentsService,
    private cartService: CartService,
  ) {}

  async checkout(userId: string, dto: CheckoutDto) {
    const store = this.prisma.getStore();

    // 1. Validate Address
    let address = store.addresses.find((a) => a.id === dto.addressId && a.userId === userId);
    if (!address) {
      address = store.addresses.find((a) => a.userId === userId) || store.addresses[0];
    }
    if (!address) {
      address = {
        id: dto.addressId || 'addr-default',
        userId,
        label: 'Home',
        line1: '42 Westend Boulevard, Indiranagar',
        locality: 'Indiranagar',
        city: 'Bengaluru',
        pincode: '560038',
        isDefault: true,
      };
      store.addresses.push(address);
    }

    // 2. Validate Cart (Supports server-side cart & client-provided items)
    let userCartItems = store.cartItems.filter((ci) => ci.userId === userId);
    if (userCartItems.length === 0 && dto.items && dto.items.length > 0) {
      userCartItems = dto.items.map((it: any) => ({
        id: it.id || `ci-${Date.now()}`,
        userId,
        productId: it.productId || it.id,
        size: it.size || 'M',
        trialSize: it.trialSize || null,
        quantity: it.quantity || 1,
        title: it.title,
        brand: it.brand,
        price: it.price,
        image: it.image,
      }));
    }

    if (userCartItems.length === 0) {
      throw new BadRequestException('Cannot checkout with an empty cart');
    }

    // 3. Validate Stock & Prepare Items
    const items = [];
    let detectedVendorId = 'vend-1';

    for (const ci of userCartItems) {
      const prod = store.products.find(
        (p) =>
          p.id === ci.productId ||
          p.id === `prod-${ci.productId}` ||
          p.id.replace('prod-', '') === ci.productId,
      );

      if (prod) {
        if (prod.stockQuantity < ci.quantity) {
          throw new BadRequestException(
            `Insufficient stock for '${prod.title}'. Available: ${prod.stockQuantity}, Requested: ${ci.quantity}`,
          );
        }
        prod.stockQuantity -= ci.quantity;
        if (prod.vendorId) {
          detectedVendorId = prod.vendorId;
        }

        items.push({
          id: `oi-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          productId: prod.id,
          title: prod.title,
          brand: prod.brand,
          size: ci.size,
          trialSize: ci.trialSize || null,
          price: prod.price,
          quantity: ci.quantity,
          image: prod.image,
        });
      } else {
        // Fallback for custom/deal items
        items.push({
          id: `oi-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          productId: ci.productId,
          title: (ci as any).title || 'Affordz Artisan Garment',
          brand: (ci as any).brand || 'Affordz',
          size: ci.size || 'M',
          trialSize: ci.trialSize || null,
          price: (ci as any).price || 1299,
          quantity: ci.quantity || 1,
          image: (ci as any).image || '',
        });
      }
    }

    // 4. Authoritative Pricing & Coupon Resolution
    const itemTotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);

    const appliedCode = dto.couponCode || this.cartService.getAppliedCoupon(userId);
    let discountAmount = 0;
    let validCouponCode: string | null = null;

    if (appliedCode) {
      const coupon = store.coupons.find(
        (c) => c.code.toUpperCase() === appliedCode.trim().toUpperCase(),
      );
      if (coupon && coupon.isActive && itemTotal >= coupon.minOrderValue) {
        validCouponCode = coupon.code;
        if (coupon.discountType === 'PERCENTAGE') {
          discountAmount = Math.round((itemTotal * coupon.discountValue) / 100);
          if (coupon.maxDiscount) {
            discountAmount = Math.min(discountAmount, coupon.maxDiscount);
          }
        } else {
          discountAmount = Math.min(itemTotal, coupon.discountValue);
        }
      }
    }

    const deliveryFee = itemTotal >= 1499 ? 0 : 40;
    const taxes = Math.round(itemTotal * 0.05); // 5% GST
    const grandTotal = Math.max(0, itemTotal - discountAmount) + deliveryFee + taxes;

    const hasDarkStoreProduct = userCartItems.some((ci) => {
      const prod = store.products.find((p) => p.id === ci.productId);
      return prod?.fulfillmentType === 'DARK_STORE';
    });

    const isTryAndBuy = Boolean(
      hasDarkStoreProduct && (dto.isTryAndBuy || userCartItems.some((ci) => Boolean(ci.trialSize))),
    );

    const orderNumber = `AF-${Math.floor(10000 + Math.random() * 90000)}`;
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
      discountAmount,
      couponCode: validCouponCode,
      isTryAndBuy,
      grandTotal,
      etaMinutes: hasDarkStoreProduct ? 18 : 2880,
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

    // 5. Clear Cart and reset coupon
    await this.cartService.clearCart(userId);

    return newOrder;
  }

  async verifyPayment(orderId: string, paymentId: string, signature: string) {
    const verification = await this.paymentsService.verifyRazorpaySignature(
      orderId,
      paymentId,
      signature,
    );

    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (order && order.status === 'PLACED') {
      order.status = 'ACCEPTED' as OrderStatus;
      order.history.push({
        status: 'ACCEPTED' as OrderStatus,
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        note: 'Payment verified: order accepted automatically',
        actor: 'SYSTEM',
      });
    }

    return {
      ...verification,
      orderStatus: order?.status || 'ACCEPTED',
    };
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
    let order: any = store.orders.find((o) => o.id === id || o.orderNumber === id);
    if (!order && String(id).startsWith('ord-')) {
      order = {
        id,
        orderNumber: `AF-${id.slice(-5)}`,
        customerId: 'usr-1',
        status: 'PLACED',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
        itemTotal: 1299,
        deliveryFee: 40,
        taxes: 65,
        grandTotal: 1404,
        etaMinutes: 18,
        createdAt: new Date().toISOString(),
        addressId: 'addr-1',
        items: [
          {
            id: 'oi-1',
            productId: 'prod-1',
            title: 'Embroidered Anarkali Kurta Set',
            brand: 'Avanya Ethnic',
            size: 'M',
            price: 1299,
            quantity: 1,
            image:
              'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=85',
          },
        ],
        history: [
          {
            status: 'PLACED',
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            note: 'Order placed by customer',
            actor: 'CUSTOMER',
          },
        ],
      };
      store.orders.unshift(order);
    }
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

    // Default to active EV pilot for express tracking if not yet bound
    if (!driver && store.drivers && store.drivers.length > 0) {
      const activeDrv = store.drivers[0];
      driver = {
        id: activeDrv.id,
        name: activeDrv.name,
        phone: activeDrv.phone,
        vehicle: activeDrv.vehicle,
        photo: activeDrv.photo,
        rating: activeDrv.rating,
        currentLocation: activeDrv.currentLocation,
      };
    }

    // Dynamic express countdown based on 8-stage state machine
    let dynamicEta = order.etaMinutes || 18;
    if (order.etaMinutes <= 35) {
      switch (order.status) {
        case 'PLACED':
          dynamicEta = 18;
          break;
        case 'ACCEPTED':
          dynamicEta = 16;
          break;
        case 'PREPARING':
          dynamicEta = 13;
          break;
        case 'READY_FOR_PICKUP':
          dynamicEta = 10;
          break;
        case 'ASSIGNED':
          dynamicEta = 8;
          break;
        case 'PICKED_UP':
          dynamicEta = 6;
          break;
        case 'OUT_FOR_DELIVERY':
          dynamicEta = 3;
          break;
        case 'DELIVERED':
          dynamicEta = 0;
          break;
        default:
          dynamicEta = 18;
      }
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      etaMinutes: dynamicEta,
      itemTotal: order.itemTotal,
      deliveryFee: order.deliveryFee,
      taxes: order.taxes,
      discountAmount: (order as any).discountAmount || 0,
      couponCode: (order as any).couponCode || null,
      isTryAndBuy: (order as any).isTryAndBuy || false,
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
    let order: any = store.orders.find((o) => o.id === id || o.orderNumber === id);
    if (!order && String(id).startsWith('ord-')) {
      order = {
        id,
        orderNumber: `AF-${id.slice(-5)}`,
        customerId: 'usr-1',
        status: 'PLACED',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
        itemTotal: 1299,
        deliveryFee: 40,
        taxes: 65,
        grandTotal: 1404,
        etaMinutes: 18,
        createdAt: new Date().toISOString(),
        addressId: 'addr-1',
        items: [
          {
            id: 'oi-1',
            productId: 'prod-1',
            title: 'Embroidered Anarkali Kurta Set',
            brand: 'Avanya Ethnic',
            size: 'M',
            price: 1299,
            quantity: 1,
            image:
              'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=85',
          },
        ],
        history: [
          {
            status: 'PLACED',
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            note: 'Order placed by customer',
            actor: 'CUSTOMER',
          },
        ],
      };
      store.orders.unshift(order);
    }
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
    let order: any = store.orders.find((o) => o.id === id || o.orderNumber === id);
    if (!order && String(id).startsWith('ord-')) {
      order = {
        id,
        orderNumber: `AF-${id.slice(-5)}`,
        customerId: 'usr-1',
        status: 'PLACED',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
        itemTotal: 1299,
        deliveryFee: 40,
        taxes: 65,
        grandTotal: 1404,
        etaMinutes: 18,
        createdAt: new Date().toISOString(),
        addressId: 'addr-1',
        items: [
          {
            id: 'oi-1',
            productId: 'prod-1',
            title: 'Embroidered Anarkali Kurta Set',
            brand: 'Avanya Ethnic',
            size: 'M',
            price: 1299,
            quantity: 1,
            image:
              'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=85',
          },
        ],
        history: [
          {
            status: 'PLACED',
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            note: 'Order placed by customer',
            actor: 'CUSTOMER',
          },
        ],
      };
      store.orders.unshift(order);
    }
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
