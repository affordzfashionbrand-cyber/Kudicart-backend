import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderTransitionService } from '../orders/order-transition.service';
import { TrackingRealtimeGateway } from '../orders/tracking-realtime.gateway';
import { DriverTryAndBuyService } from './driver-try-and-buy.service';
import { QueueJobType } from '../queue/queue.constants';
import { Role } from '../../common/enums/role.enum';
import { TERMINAL_ORDER_STATUSES, OrderStatus } from '../../common/contracts/order-contracts';
import { OrderPickupDto, OrderDeliverDto } from './dto/order-action.dto';
import {
  TryAndBuyHandoverDto,
  TryAndBuySelectionsDto,
  TryAndBuyReturnCollectionDto,
  TryAndBuySettlePaymentDto,
  TryAndBuyReconciliationDto,
} from './dto/try-and-buy.dto';
import { formatOrderPacket } from './driver-order.formatter';

const DRIVER_ORDER_INCLUDE = {
  items: { include: { product: { include: { darkStoreHub: true } } } },
  history: { orderBy: { createdAt: 'asc' as const } },
  customer: { select: { id: true, name: true, phone: true } },
  vendor: { include: { user: { select: { id: true, name: true, phone: true } } } },
  address: true,
  tryAndBuySession: true,
};

@Injectable()
export class DriverOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderTransition: OrderTransitionService,
    private readonly tryAndBuyService: DriverTryAndBuyService,
    @Optional() private readonly trackingGateway?: TrackingRealtimeGateway,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async resolveDriver(driverIdOrUserId?: string) {
    this.ensureDbConnected();
    if (!driverIdOrUserId) {
      throw new BadRequestException('Authenticated driver identifier is required');
    }
    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: driverIdOrUserId }, { userId: driverIdOrUserId }] },
      include: { user: true },
    });
    if (!driver) {
      throw new NotFoundException(`Driver '${driverIdOrUserId}' not found`);
    }
    return driver;
  }

  private async resolveAuthorizedOrder(driver: any, orderId: string) {
    const cleanId = orderId.trim().replace(/^#/, '');
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }] },
      include: DRIVER_ORDER_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException(`Order '${orderId}' not found`);
    }

    const isAssignedToDriver =
      order.driverProfileId === driver.id ||
      order.driverId === driver.userId ||
      order.driverId === driver.id;
    if (!isAssignedToDriver) {
      throw new ForbiddenException('Order is not assigned to your driver account');
    }

    return order;
  }

  async getDashboard(driverId?: string) {
    const driver = await this.resolveDriver(driverId);

    const assignedOrders = await this.prisma.order.findMany({
      where: {
        OR: [{ driverProfileId: driver.id }, { driverId: driver.userId }],
      },
      include: DRIVER_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    const activeOrders = assignedOrders.filter(
      (o) => !TERMINAL_ORDER_STATUSES.includes(o.status as OrderStatus),
    );
    const completedOrders = assignedOrders.filter(
      (o) => o.status === 'DELIVERED' || o.status === 'RETURNED',
    );

    const todayEarnings = completedOrders.length * 55;

    return {
      driver: {
        id: driver.id,
        userId: driver.userId,
        fullName: driver.fullName,
        isOnline: driver.isOnline,
        kycStatus: driver.kycStatus,
        tier: driver.tier,
        rating: driver.rating,
        completedDeliveries: driver.completedDeliveries,
      },
      isOnline: driver.isOnline,
      todayEarnings,
      deliveriesCompletedToday: completedOrders.length,
      activeOrder: activeOrders[0] ? formatOrderPacket(activeOrders[0]) : null,
      activeOrders: activeOrders.map((o) => formatOrderPacket(o)),
      availableJobs: activeOrders.map((o) => formatOrderPacket(o)),
    };
  }

  async getAssignedOrders(driverId?: string, statusFilter?: string) {
    const driver = await this.resolveDriver(driverId);

    const where: any = {
      OR: [{ driverProfileId: driver.id }, { driverId: driver.userId }],
    };

    if (statusFilter && statusFilter !== 'ALL') {
      if (statusFilter === 'ACTIVE') {
        where.status = { notIn: [...TERMINAL_ORDER_STATUSES] };
      } else {
        where.status = statusFilter;
      }
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: DRIVER_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return {
      orders: orders.map((o) => formatOrderPacket(o)),
      total: orders.length,
    };
  }

  async getOrderDetails(driverId: string | undefined, orderId: string) {
    const driver = await this.resolveDriver(driverId);
    const order = await this.resolveAuthorizedOrder(driver, orderId);
    return formatOrderPacket(order);
  }

  async acceptOrder(driverId: string | undefined, orderId: string) {
    const driver = await this.resolveDriver(driverId);
    const order = await this.resolveAuthorizedOrder(driver, orderId);

    if (order.status !== 'ASSIGNED') {
      throw new BadRequestException(
        `Order can only be acknowledged in ASSIGNED state (current: ${order.status})`,
      );
    }

    await this.prisma.auditLog.create({
      data: {
        userId: driver.userId,
        userRole: Role.DRIVER,
        action: 'DRIVER_ACCEPTED_ASSIGNMENT',
        entityType: 'Order',
        entityId: order.id,
        details: JSON.stringify({
          orderNumber: order.orderNumber,
          driverProfileId: driver.id,
          driverName: driver.fullName,
        }),
      },
    });

    return {
      success: true,
      message: `Order #${order.orderNumber} acknowledged. Proceed to store pickup.`,
      order: formatOrderPacket(order),
    };
  }

  async pickupOrder(
    driverId: string | undefined,
    orderId: string,
    dto?: OrderPickupDto,
  ) {
    const driver = await this.resolveDriver(driverId);
    const order = await this.resolveAuthorizedOrder(driver, orderId);

    const verificationPhotos = [
      ...(dto?.verificationPhotos || []),
      ...(dto?.packageImages || []),
    ].filter(Boolean);

    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'PICKED_UP',
      actorRole: Role.DRIVER,
      actorId: driver.userId,
      actorName: driver.fullName,
      note: 'Package verified & picked up from store counter',
      auditAction: 'DRIVER_ORDER_PICKED_UP',
      extraOrderUpdate:
        verificationPhotos.length > 0 ? { verificationPhotos } : undefined,
    });

    return {
      success: true,
      message: 'Package pickup verified. Ready to start delivery.',
      order: formatOrderPacket(updated),
    };
  }

  async outForDelivery(driverId: string | undefined, orderId: string) {
    const driver = await this.resolveDriver(driverId);
    const order = await this.resolveAuthorizedOrder(driver, orderId);

    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'OUT_FOR_DELIVERY',
      actorRole: Role.DRIVER,
      actorId: driver.userId,
      actorName: driver.fullName,
      note: 'Rider departed store and is on the way to customer',
      auditAction: 'DRIVER_OUT_FOR_DELIVERY',
    });

    return {
      success: true,
      message: 'Order is now OUT_FOR_DELIVERY. Live customer tracking active.',
      order: formatOrderPacket(updated),
    };
  }

  /**
   * DCR-005: Doorstep arrival keeps Order.status === OUT_FOR_DELIVERY
   * while setting Order.arrivedAt + TryAndBuySession.stage = HANDOVER_PENDING.
   */
  async markArrived(driverId: string | undefined, orderId: string) {
    const driver = await this.resolveDriver(driverId);
    const order = await this.resolveAuthorizedOrder(driver, orderId);

    if (order.status !== 'OUT_FOR_DELIVERY') {
      throw new BadRequestException(
        `Rider can only mark doorstep arrival when order is OUT_FOR_DELIVERY (current: ${order.status})`,
      );
    }

    const now = order.arrivedAt || new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { arrivedAt: now, etaMinutes: 0 },
      });

      if (order.isTryAndBuy) {
        await tx.tryAndBuySession.upsert({
          where: { orderId: order.id },
          update: {
            driverId: driver.userId,
            driverProfileId: driver.id,
            stage: order.tryAndBuySession?.stage || 'HANDOVER_PENDING',
          },
          create: {
            orderId: order.id,
            driverId: driver.userId,
            driverProfileId: driver.id,
            stage: 'HANDOVER_PENDING',
            trialDurationMinutes: 10,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: driver.userId,
          userRole: Role.DRIVER,
          action: 'DRIVER_ARRIVED_AT_DOORSTEP',
          entityType: 'Order',
          entityId: order.id,
          details: JSON.stringify({
            orderNumber: order.orderNumber,
            arrivedAt: now.toISOString(),
            isTryAndBuy: order.isTryAndBuy,
          }),
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'ORDER',
          aggregateId: order.id,
          eventType: QueueJobType.ORDER_STATUS_NOTIFICATION,
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            userId: order.customerId,
            title: `Rider Arrived #${order.orderNumber}`,
            message: order.isTryAndBuy
              ? 'Your delivery partner is at your doorstep. Share your Handover OTP from the Affordz app.'
              : 'Your delivery partner has arrived at your doorstep!',
          },
        },
      });
    });

    this.trackingGateway?.broadcastStatusUpdate(order.id, 'OUT_FOR_DELIVERY', {
      eventType: 'ORDER_ARRIVED',
      arrivedAt: now.toISOString(),
      isArrived: true,
      tryAndBuyStage: order.isTryAndBuy
        ? order.tryAndBuySession?.stage || 'HANDOVER_PENDING'
        : undefined,
    });

    const refreshed = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: DRIVER_ORDER_INCLUDE,
    });

    return {
      success: true,
      message: 'Doorstep arrival recorded.',
      arrivedAt: now.toISOString(),
      order: formatOrderPacket(refreshed),
    };
  }

  async deliverOrder(
    driverId: string | undefined,
    orderId: string,
    dto?: OrderDeliverDto,
  ) {
    const driver = await this.resolveDriver(driverId);
    const order = await this.resolveAuthorizedOrder(driver, orderId);

    if (order.paymentMethod === 'COD' && order.paymentStatus !== 'COMPLETED') {
      if (dto?.cashCollected === false) {
        throw new BadRequestException('Cash/UPI collection confirmation is required for COD delivery');
      }
    }

    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'DELIVERED',
      actorRole: Role.DRIVER,
      actorId: driver.userId,
      actorName: driver.fullName,
      note: 'Order delivered cleanly to customer',
      auditAction: 'DRIVER_ORDER_DELIVERED',
      extraOrderUpdate:
        order.paymentMethod === 'COD' ? { paymentStatus: 'COMPLETED' } : undefined,
    });

    await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: {
        completedDeliveries: { increment: 1 },
        availableSince: new Date(),
      },
    });

    return {
      success: true,
      message: `Order #${order.orderNumber} delivered cleanly.`,
      order: formatOrderPacket(updated),
    };
  }

  async tryAndBuyHandover(
    driverId: string | undefined,
    orderId: string,
    dto: TryAndBuyHandoverDto,
  ) {
    return this.tryAndBuyService.confirmHandover(driverId, orderId, dto);
  }

  async tryAndBuySelections(
    driverId: string | undefined,
    orderId: string,
    dto: TryAndBuySelectionsDto,
  ) {
    return this.tryAndBuyService.recordSelections(driverId, orderId, dto);
  }

  async tryAndBuyReturnCollection(
    driverId: string | undefined,
    orderId: string,
    dto: TryAndBuyReturnCollectionDto,
  ) {
    return this.tryAndBuyService.confirmReturnCollection(driverId, orderId, dto);
  }

  async tryAndBuySettlePayment(
    driverId: string | undefined,
    orderId: string,
    dto: TryAndBuySettlePaymentDto,
  ) {
    return this.tryAndBuyService.settlePayment(driverId, orderId, dto);
  }

  async tryAndBuyArriveStore(driverId: string | undefined, orderId: string) {
    return this.tryAndBuyService.arriveAtStore(driverId, orderId);
  }

  async tryAndBuyReconcileStore(
    driverId: string | undefined,
    orderId: string,
    dto: TryAndBuyReconciliationDto,
  ) {
    return this.tryAndBuyService.reconcileStoreReturn(driverId, orderId, dto);
  }
}
