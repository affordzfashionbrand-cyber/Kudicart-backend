import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachineService, OrderStatus } from '../orders/state-machine.service';
import { UpdateDriverProfileDto } from './dto/update-driver-profile.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class DriverService {
  constructor(
    private prisma: PrismaService,
    private stateMachine: StateMachineService,
  ) {}

  private resolveDriver(driverId?: string) {
    const store = this.prisma.getStore();
    const id = driverId || 'drv-1';
    const driver = store.drivers.find((d) => d.id === id || d.userId === id);
    if (!driver) {
      throw new NotFoundException(`Driver with identifier ${id} not found`);
    }
    return driver;
  }

  async getProfile(driverId?: string) {
    const driver = this.resolveDriver(driverId);
    return driver;
  }

  async updateProfile(driverId: string | undefined, dto: UpdateDriverProfileDto) {
    const driver = this.resolveDriver(driverId);
    if (dto.name !== undefined) driver.name = dto.name;
    if (dto.phone !== undefined) driver.phone = dto.phone;
    if (dto.vehicle !== undefined) driver.vehicle = dto.vehicle;
    if (dto.photo !== undefined) driver.photo = dto.photo;
    return driver;
  }

  async getKycStatus(driverId?: string) {
    const driver = this.resolveDriver(driverId);
    return {
      driverId: driver.id,
      name: driver.name,
      kycStatus: driver.kycStatus,
      isApproved: driver.kycStatus === 'APPROVED',
      documents: driver.kycDocuments,
    };
  }

  async updateAvailability(driverId: string | undefined, isOnline: boolean) {
    const driver = this.resolveDriver(driverId);
    driver.isOnline = isOnline;
    return {
      success: true,
      driverId: driver.id,
      isOnline: driver.isOnline,
      message: `Driver status set to ${isOnline ? 'Online (Ready for assignments)' : 'Offline'}`,
    };
  }

  async getAssignedOrders(driverId?: string, statusFilter?: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();

    let orders = store.orders.filter((o) => o.driverId === driver.id);

    if (statusFilter === 'active') {
      orders = orders.filter((o) =>
        ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(o.status),
      );
    } else if (statusFilter === 'completed') {
      orders = orders.filter((o) => o.status === 'DELIVERED');
    }

    return orders.map((o) => {
      const address = store.addresses.find((a) => a.id === o.addressId);
      const vendor = store.vendors.find((v) => v.id === o.vendorId) || store.vendors[0];

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        itemTotal: o.itemTotal,
        grandTotal: o.grandTotal,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        cashToCollect:
          o.paymentMethod === 'COD' && o.paymentStatus !== 'COMPLETED' ? o.grandTotal : 0,
        pickupStore: {
          name: vendor?.storeName || 'Avanya Ethnic Boutique',
          address: vendor?.address || 'Indiranagar, Bengaluru',
          phone: vendor?.phone || '+91 80 4123 9988',
        },
        dropoffAddress: address
          ? `${address.line1}, ${address.locality}, ${address.city} - ${address.pincode}`
          : 'Customer Address',
        itemsCount: o.items.reduce((acc, i) => acc + i.quantity, 0),
        createdAt: o.createdAt,
      };
    });
  }

  async getOrderDetails(driverId: string | undefined, orderId: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (order.driverId && order.driverId !== driver.id) {
      throw new ForbiddenException('This order is assigned to another delivery partner');
    }

    const customer = store.users.find((u) => u.id === order.customerId);
    const address = store.addresses.find((a) => a.id === order.addressId);
    const vendor = store.vendors.find((v) => v.id === order.vendorId) || store.vendors[0];

    const cashToCollect =
      order.paymentMethod === 'COD' && order.paymentStatus !== 'COMPLETED'
        ? order.grandTotal
        : 0;

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      grandTotal: order.grandTotal,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      cashToCollect,
      customer: {
        id: customer?.id,
        name: customer?.name || 'Customer',
        phone: customer?.phone || '+91 98450 12890',
      },
      pickup: {
        storeName: vendor.storeName,
        address: vendor.address,
        phone: vendor.phone,
        contactPerson: vendor.contactPerson,
        googleMapsQuery: encodeURIComponent(vendor.address),
      },
      dropoff: {
        label: address?.label || 'Home',
        address: address
          ? `${address.line1}, ${address.locality}, ${address.city} - ${address.pincode}`
          : 'Delivery Location',
        phone: customer?.phone || '+91 98450 12890',
        googleMapsQuery: address
          ? encodeURIComponent(`${address.line1}, ${address.locality}, ${address.city}`)
          : '',
      },
      items: order.items,
      history: order.history,
    };
  }

  async acceptOrder(driverId: string | undefined, orderId: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (order.status !== 'ASSIGNED') {
      throw new BadRequestException(
        `Cannot accept order in status '${order.status}'. Order must be in ASSIGNED status.`,
      );
    }

    if (order.driverId !== driver.id) {
      throw new ForbiddenException('Order is not assigned to you');
    }

    order.history.push({
      status: 'ASSIGNED',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: `Rider ${driver.name} accepted assignment`,
      actor: 'DRIVER',
    });

    return {
      success: true,
      message: 'Order accepted successfully. Proceed to pickup store.',
      order: await this.getOrderDetails(driver.id, order.id),
    };
  }

  async pickupOrder(driverId: string | undefined, orderId: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (order.driverId !== driver.id) {
      throw new ForbiddenException('Order is not assigned to you');
    }

    // Validate state transition ASSIGNED -> PICKED_UP
    this.stateMachine.validateTransition(order.status as OrderStatus, 'PICKED_UP', Role.DRIVER);

    order.status = 'PICKED_UP';
    order.updatedAt = new Date().toISOString();
    order.history.push({
      status: 'PICKED_UP',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: `Rider ${driver.name} picked up package from boutique`,
      actor: 'DRIVER',
    });

    return {
      success: true,
      message: 'Package picked up from store. Ready for customer delivery.',
      order: await this.getOrderDetails(driver.id, order.id),
    };
  }

  async outForDeliveryOrder(driverId: string | undefined, orderId: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (order.driverId !== driver.id) {
      throw new ForbiddenException('Order is not assigned to you');
    }

    // Validate state transition PICKED_UP -> OUT_FOR_DELIVERY
    this.stateMachine.validateTransition(order.status as OrderStatus, 'OUT_FOR_DELIVERY', Role.DRIVER);

    order.status = 'OUT_FOR_DELIVERY';
    order.etaMinutes = 15;
    order.updatedAt = new Date().toISOString();
    order.history.push({
      status: 'OUT_FOR_DELIVERY',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: `Rider ${driver.name} is on the way for express delivery`,
      actor: 'DRIVER',
    });

    return {
      success: true,
      message: 'Order is out for delivery to customer.',
      order: await this.getOrderDetails(driver.id, order.id),
    };
  }

  async deliverOrder(driverId: string | undefined, orderId: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (order.driverId !== driver.id) {
      throw new ForbiddenException('Order is not assigned to you');
    }

    // Validate state transition OUT_FOR_DELIVERY -> DELIVERED
    this.stateMachine.validateTransition(order.status as OrderStatus, 'DELIVERED', Role.DRIVER);

    order.status = 'DELIVERED';
    order.etaMinutes = 0;
    order.updatedAt = new Date().toISOString();

    // If COD, mark payment as completed upon delivery
    if (order.paymentMethod === 'COD') {
      order.paymentStatus = 'COMPLETED';
    }

    driver.completedDeliveries += 1;

    order.history.push({
      status: 'DELIVERED',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: `Rider ${driver.name} successfully delivered package to customer`,
      actor: 'DRIVER',
    });

    return {
      success: true,
      message: 'Order delivered successfully.',
      order: await this.getOrderDetails(driver.id, order.id),
    };
  }

  async updateLocation(driverId: string | undefined, dto: UpdateLocationDto) {
    const driver = this.resolveDriver(driverId);
    driver.currentLocation = {
      latitude: dto.latitude,
      longitude: dto.longitude,
      heading: dto.heading || 0,
      updatedAt: new Date().toISOString(),
    };

    return {
      success: true,
      driverId: driver.id,
      location: driver.currentLocation,
    };
  }
}
