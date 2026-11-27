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
import { DeliveryAssignmentService } from '../orders/delivery-assignment.service';
import { TrackingRealtimeGateway } from '../orders/tracking-realtime.gateway';
import { DriverTryAndBuyService } from './driver-try-and-buy.service';
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
  dispatchAssignment: true,
};

@Injectable()
export class DriverOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderTransition: OrderTransitionService,
    private readonly tryAndBuyService: DriverTryAndBuyService,
    @Optional() private readonly trackingGateway?: TrackingRealtimeGateway,
    @Optional() private readonly deliveryAssignment?: DeliveryAssignmentService,
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

    const defaultPayout = Number(process.env.DRIVER_BASE_PAYOUT_RUPEES) || 55;
    const payoutEntries =
      completedOrders.length > 0
        ? await this.prisma.ledgerEntry.findMany({
            where: {
              orderId: { in: completedOrders.map((o) => o.id) },
              entryType: { in: ['DRIVER_PAYOUT', 'DRIVER_BONUS', 'SURGE_BONUS'] },
            },
            select: { orderId: true, amount: true },
          })
        : [];
    const payoutByOrder = new Map<string, number>();
    for (const p of payoutEntries) {
      if (p.orderId) {
        payoutByOrder.set(p.orderId, (payoutByOrder.get(p.orderId) || 0) + (Number(p.amount) || 0));
      }
    }
    const todayEarnings = completedOrders.reduce(
      (sum, o) => sum + (payoutByOrder.get(o.id) ?? defaultPayout),
      0,
    );

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
    if (!this.deliveryAssignment) {
      throw new ServiceUnavailableException('Delivery assignment service unavailable.');
    }

    const updated = await this.deliveryAssignment.acceptAssignment(driver.id, orderId);

    return {
      success: true,
      message: `Order #${updated?.orderNumber || orderId} assignment accepted. Proceed to pickup when ready.`,
      order: formatOrderPacket(updated),
    };
  }

  async rejectOrder(driverId: string | undefined, orderId: string, reason?: string) {
    const driver = await this.resolveDriver(driverId);
    if (!this.deliveryAssignment) {
      throw new ServiceUnavailableException('Delivery assignment service unavailable.');
    }

    const outcome = await this.deliveryAssignment.rejectAssignment(driver.id, orderId, reason);

    return {
      success: true,
      reassigned: outcome.reassignResult.assigned,
      deliveryAssignmentStatus: outcome.refreshed?.deliveryAssignmentStatus,
      message: outcome.reassignResult.assigned
        ? 'Assignment declined and automatically reassigned to next available partner.'
        : 'Assignment declined. Order queued for partner reassignment.',
    };
  }

  async pickupOrder(
    driverId: string | undefined,
    orderId: string,
    dto?: OrderPickupDto,
  ) {
    const driver = await this.resolveDriver(driverId);
    const order = await this.resolveAuthorizedOrder(driver, orderId);

    if (order.status !== 'READY_FOR_PICKUP' && order.status !== 'ASSIGNED') {
      throw new BadRequestException(
        `Order #${order.orderNumber} is not ready for pickup yet (current status: ${order.status}).`,
      );
    }

    const validAssignStates = ['ASSIGNED', 'ACCEPTED_BY_DELIVERY_PARTNER'];
    if (
      order.deliveryAssignmentStatus &&
      !validAssignStates.includes(order.deliveryAssignmentStatus)
    ) {
      throw new BadRequestException(
        `Cannot confirm pickup when assignment status is '${order.deliveryAssignmentStatus}'.`,
      );
    }

    const verificationPhotos = [
      ...(dto?.verificationPhotos || []),
      ...(dto?.packageImages || []),
    ].filter(Boolean);

    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'OUT_FOR_DELIVERY',
      actorRole: Role.DRIVER,
      actorId: driver.userId,
      actorName: driver.fullName,
      note: 'Package verified & picked up from store counter; out for delivery',
      auditAction: 'DRIVER_ORDER_PICKED_UP',
      extraOrderUpdate: {
        pickedUpByDriverId: driver.id,
        deliveryAssignmentStatus: 'ACCEPTED_BY_DELIVERY_PARTNER',
        ...(verificationPhotos.length > 0 ? { verificationPhotos } : {}),
      },
    });

    return {
      success: true,
      message: 'Pickup confirmed. Order is now OUT_FOR_DELIVERY.',
      order: formatOrderPacket(updated),
    };
  }

  async outForDelivery(driverId: string | undefined, orderId: string) {
    const driver = await this.resolveDriver(driverId);
    const order = await this.resolveAuthorizedOrder(driver, orderId);

    if (order.status === 'OUT_FOR_DELIVERY') {
      return {
        success: true,
        message: 'Order is already OUT_FOR_DELIVERY. Live customer tracking active.',
        order: formatOrderPacket(order),
      };
    }

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
   * Standard orders record doorstep arrival while staying OUT_FOR_DELIVERY.
   * Try & Buy orders transition from OUT_FOR_DELIVERY -> TRY_AND_BUY when partner reaches customer & starts Try & Buy.
   */
  async markArrived(driverId: string | undefined, orderId: string) {
    const driver = await this.resolveDriver(driverId);
    const order = await this.resolveAuthorizedOrder(driver, orderId);

    if (order.isTryAndBuy) {
      if (order.status === 'TRY_AND_BUY') {
        return {
          success: true,
          message: 'Try & Buy session already active at customer doorstep.',
          arrivedAt: order.arrivedAt?.toISOString?.() || new Date().toISOString(),
          order: formatOrderPacket(order),
        };
      }
      if (order.status !== 'OUT_FOR_DELIVERY') {
        throw new BadRequestException(
          `Rider can only start Try & Buy when order is OUT_FOR_DELIVERY (current: ${order.status})`,
        );
      }

      const now = order.arrivedAt || new Date();
      const updated = await this.orderTransition.executeTransition({
        orderId: order.id,
        nextStatus: 'TRY_AND_BUY',
        actorRole: Role.DRIVER,
        actorId: driver.userId,
        actorName: driver.fullName,
        note: 'Delivery partner reached customer and started Try & Buy',
        auditAction: 'TRY_AND_BUY_STARTED',
        extraOrderUpdate: {
          arrivedAt: now,
          tryAndBuyStartedAt: now,
        },
      });

      await this.prisma.tryAndBuySession.upsert({
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

      const refreshed = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: DRIVER_ORDER_INCLUDE,
      });

      this.trackingGateway?.broadcastStatusUpdate(order.id, 'TRY_AND_BUY', {
        eventType: 'TRY_AND_BUY_STARTED',
        orderNumber: order.orderNumber,
        orderType: 'TRY_AND_BUY',
        vendorId: order.vendorId ?? null,
        customerId: order.customerId,
        driverId: order.driverId ?? null,
        driverProfileId: order.driverProfileId ?? null,
        arrivedAt: now.toISOString(),
        isArrived: true,
        stage: 'HANDOVER_PENDING',
      });

      return {
        success: true,
        message: 'Doorstep arrival recorded. Try & Buy started.',
        arrivedAt: now.toISOString(),
        order: formatOrderPacket(refreshed || updated),
      };
    }

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
            isTryAndBuy: false,
          }),
        },
      });
    });

    this.trackingGateway?.broadcastStatusUpdate(order.id, 'OUT_FOR_DELIVERY', {
      eventType: 'ORDER_ARRIVED',
      orderNumber: order.orderNumber,
      arrivedAt: now.toISOString(),
      isArrived: true,
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

    if (order.isTryAndBuy) {
      throw new BadRequestException(
        'Try & Buy orders must complete customer Try & Buy verification and decision before delivery.',
      );
    }

    if (order.status !== 'OUT_FOR_DELIVERY') {
      throw new BadRequestException(
        `Order #${order.orderNumber} must be OUT_FOR_DELIVERY before confirming delivery (current: ${order.status}).`,
      );
    }

    if (order.paymentMethod === 'COD' && order.paymentStatus !== 'COMPLETED') {
      if (dto?.cashCollected === false) {
        throw new BadRequestException('Cash/UPI collection confirmation is required for COD delivery');
      }
    }

    const verificationPhotos = [
      ...(order.verificationPhotos || []),
      ...(dto?.deliveryImages || []),
    ].filter(Boolean);

    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'DELIVERED',
      actorRole: Role.DRIVER,
      actorId: driver.userId,
      actorName: driver.fullName,
      note: 'Order delivered cleanly to customer',
      auditAction: 'DRIVER_ORDER_DELIVERED',
      extraOrderUpdate: {
        ...(order.paymentMethod === 'COD' ? { paymentStatus: 'COMPLETED' } : {}),
        ...(verificationPhotos.length > 0 ? { verificationPhotos } : {}),
      },
    });

    await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: {
        completedDeliveries: { increment: 1 },
        availableSince: new Date(),
      },
    });

    this.deliveryAssignment?.retryPendingAssignments().catch(() => 0);

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
