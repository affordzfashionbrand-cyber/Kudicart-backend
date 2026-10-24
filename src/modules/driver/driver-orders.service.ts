import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachineService, OrderStatus } from '../orders/state-machine.service';
import { Role } from '../../common/enums/role.enum';
import { DriverTryAndBuyService } from './driver-try-and-buy.service';
import { formatOrderPacket } from './driver-order.formatter';
import { OrderPickupDto, OrderDeliverDto } from './dto/order-action.dto';
import {
  TryAndBuyHandoverDto,
  TryAndBuySelectionsDto,
  TryAndBuyReturnCollectionDto,
  TryAndBuySettlePaymentDto,
  TryAndBuyReconciliationDto,
} from './dto/try-and-buy.dto';

@Injectable()
export class DriverOrdersService {
  constructor(
    private prisma: PrismaService,
    private stateMachine: StateMachineService,
    private tryAndBuyService: DriverTryAndBuyService,
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

  async getDashboard(driverId?: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();

    // Active order check
    const activeOrderRaw = store.orders.find(
      (o) =>
        o.driverId === driver.id &&
        ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(o.status),
    );

    let activeOrder: any = null;
    if (activeOrderRaw) {
      activeOrder = await this.getOrderDetails(driver.id, activeOrderRaw.id);
    }

    const unreadCount = store.notifications.filter(
      (n) => (n.driverId === driver.id || n.driverId === 'drv-1') && !n.read,
    ).length;

    return {
      profile: {
        id: driver.id,
        fullName: driver.fullName,
        name: driver.name,
        role: driver.role || 'Delivery Partner',
        phone: driver.phone,
        tier: driver.tier || 'Silver Tier',
        avatarInitial: driver.avatarInitial || 'DP',
        workPreference: driver.workPreference,
        isOnline: driver.isOnline,
        kycStatus: driver.kycStatus,
      },
      isOnline: driver.isOnline,
      workSummary: driver.workSummary,
      activeSurges: store.surges.filter((s) => s.isActive),
      activeOrder,
      unreadNotificationsCount: unreadCount,
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

    return orders.map((o) => this.formatOrderPacket(o, driver));
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

    return this.formatOrderPacket(order, driver);
  }

  private formatOrderPacket(order: any, driver: any) {
    const store = this.prisma.getStore();
    return formatOrderPacket(order, store, Boolean(order.isTryAndBuy));
  }

  async acceptOrder(driverId: string | undefined, orderId: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.status !== 'ASSIGNED') {
      throw new BadRequestException(`Cannot accept order in status '${order.status}'`);
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

  async pickupOrder(driverId: string | undefined, orderId: string, dto?: OrderPickupDto) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.driverId !== driver.id) throw new ForbiddenException('Order is not assigned to you');

    this.stateMachine.validateTransition(order.status as OrderStatus, 'PICKED_UP', Role.DRIVER);

    order.status = 'PICKED_UP';
    order.updatedAt = new Date().toISOString();
    if (dto?.packageImages) {
      (order as any).pickupImages = dto.packageImages;
    }

    order.history.push({
      status: 'PICKED_UP',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: `Rider ${driver.name} collected package from store counter`,
      actor: 'DRIVER',
    });

    return {
      success: true,
      message: 'Package picked up from store. Ready for customer delivery.',
      order: await this.getOrderDetails(driver.id, order.id),
    };
  }

  async outForDelivery(driverId: string | undefined, orderId: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.driverId !== driver.id) throw new ForbiddenException('Order is not assigned to you');

    this.stateMachine.validateTransition(order.status as OrderStatus, 'OUT_FOR_DELIVERY', Role.DRIVER);

    order.status = 'OUT_FOR_DELIVERY';
    order.etaMinutes = 15;
    order.updatedAt = new Date().toISOString();

    order.history.push({
      status: 'OUT_FOR_DELIVERY',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: `Rider ${driver.name} is on the way to customer address`,
      actor: 'DRIVER',
    });

    return {
      success: true,
      message: 'Order is out for express delivery to customer.',
      order: await this.getOrderDetails(driver.id, order.id),
    };
  }

  async markArrived(driverId: string | undefined, orderId: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.driverId !== driver.id) throw new ForbiddenException('Order is not assigned to you');

    (order as any).arrivedAtCustomer = true;
    (order as any).arrivedAt = new Date().toISOString();
    if (order.isTryAndBuy) {
      (order as any).tryAndBuyStage = (order as any).tryAndBuyStage || 'HANDOVER_PENDING';
    }

    order.history.push({
      status: order.status,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: `Rider ${driver.name} arrived at customer delivery location`,
      actor: 'DRIVER',
    });

    return {
      success: true,
      message: 'Arrived at delivery location.',
      order: await this.getOrderDetails(driver.id, order.id),
    };
  }

  async deliverOrder(driverId: string | undefined, orderId: string, dto?: OrderDeliverDto) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.driverId !== driver.id) throw new ForbiddenException('Order is not assigned to you');

    this.stateMachine.validateTransition(order.status as OrderStatus, 'DELIVERED', Role.DRIVER);

    order.status = 'DELIVERED';
    order.etaMinutes = 0;
    order.updatedAt = new Date().toISOString();

    if (order.paymentMethod === 'COD') {
      order.paymentStatus = 'COMPLETED';
    }
    if (dto?.deliveryImages) {
      (order as any).deliveryImages = dto.deliveryImages;
    }

    driver.completedDeliveries += 1;

    order.history.push({
      status: 'DELIVERED',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: `Rider ${driver.name} successfully handed package to customer. Delivery completed.`,
      actor: 'DRIVER',
    });

    return {
      success: true,
      message: 'Order delivered successfully.',
      order: await this.getOrderDetails(driver.id, order.id),
    };
  }

  // Delegate Try & Buy methods
  async tryAndBuyHandover(driverId: string | undefined, orderId: string, dto: TryAndBuyHandoverDto) {
    return this.tryAndBuyService.confirmHandover(driverId, orderId, dto);
  }

  async tryAndBuySelections(driverId: string | undefined, orderId: string, dto: TryAndBuySelectionsDto) {
    return this.tryAndBuyService.recordSelections(driverId, orderId, dto);
  }

  async tryAndBuyReturnCollection(driverId: string | undefined, orderId: string, dto: TryAndBuyReturnCollectionDto) {
    return this.tryAndBuyService.confirmReturnCollection(driverId, orderId, dto);
  }

  async tryAndBuySettlePayment(driverId: string | undefined, orderId: string, dto: TryAndBuySettlePaymentDto) {
    return this.tryAndBuyService.settlePayment(driverId, orderId, dto);
  }

  async tryAndBuyArriveStore(driverId: string | undefined, orderId: string) {
    return this.tryAndBuyService.arriveAtStore(driverId, orderId);
  }

  async tryAndBuyReconcileStore(driverId: string | undefined, orderId: string, dto: TryAndBuyReconciliationDto) {
    return this.tryAndBuyService.reconcileStoreReturn(driverId, orderId, dto);
  }
}
