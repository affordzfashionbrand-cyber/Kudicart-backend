import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DeliveryAssignmentStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingRealtimeGateway } from './tracking-realtime.gateway';
import { OutboxService } from '../queue/outbox.service';
import { QueueJobType } from '../queue/queue.constants';
import { Role } from '../../common/enums/role.enum';
import { TERMINAL_ORDER_STATUSES } from '../../common/contracts/order-contracts';

export interface AssignmentActor {
  actorId?: string | null;
  actorRole?: string | null;
  actorName?: string | null;
}

export interface AutoAssignResult {
  assigned: boolean;
  alreadyAssigned?: boolean;
  deliveryAssignmentStatus: DeliveryAssignmentStatus;
  driverProfileId: string | null;
  driverUserId: string | null;
  driverName: string | null;
  failureReason: string | null;
}

@Injectable()
export class DeliveryAssignmentService {
  private readonly logger = new Logger(DeliveryAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly trackingGateway?: TrackingRealtimeGateway,
    @Optional() private readonly outboxService?: OutboxService,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  /**
   * Attempts automatic FIFO + hub-aware + load-balanced assignment inside an active Prisma transaction.
   * Uses row-level FOR UPDATE SKIP LOCKED so concurrent order acceptances safely select distinct idle partners.
   * Never mutates Order.status (keeps OrderProcessingStatus strictly independent from DeliveryAssignmentStatus).
   */
  async assignOrderInTransaction(
    tx: any,
    order: any,
    actor: AssignmentActor,
    options?: { isReassignment?: boolean; excludeDriverProfileIds?: string[]; forceReassign?: boolean },
  ): Promise<AutoAssignResult> {
    const currentAssignStatus = order.deliveryAssignmentStatus as DeliveryAssignmentStatus | undefined;

    if (
      !options?.forceReassign &&
      order.driverProfileId &&
      (currentAssignStatus === DeliveryAssignmentStatus.ASSIGNED ||
        currentAssignStatus === DeliveryAssignmentStatus.ACCEPTED_BY_DELIVERY_PARTNER)
    ) {
      return {
        assigned: true,
        alreadyAssigned: true,
        deliveryAssignmentStatus: currentAssignStatus,
        driverProfileId: order.driverProfileId,
        driverUserId: order.driverId ?? null,
        driverName: order.driverProfile?.fullName || order.driver?.name || null,
        failureReason: null,
      };
    }

    const existingDispatch = await tx.dispatchAssignment.findUnique({
      where: { orderId: order.id },
    });

    const excludedSet = new Set<string>([
      ...(Array.isArray(existingDispatch?.rejectedDriverIds)
        ? existingDispatch.rejectedDriverIds
        : []),
      ...(options?.excludeDriverProfileIds || []),
    ]);
    const excludedIds = Array.from(excludedSet);

    const targetHubId: string | null =
      order.items?.[0]?.product?.darkStoreHubId ??
      order.items?.[0]?.product?.darkStoreHub?.id ??
      null;

    // Lock the best eligible online KYC-approved driver atomically inside PostgreSQL tx
    const candidates: Array<{
      id: string;
      userId: string;
      fullName: string;
      phone: string;
    }> = await tx.$queryRaw`
      SELECT dp.id, dp."userId", dp."fullName", dp.phone
      FROM "DriverProfile" dp
      WHERE dp."kycStatus" = 'APPROVED'
        AND dp."isOnline" = true
        AND NOT (dp.id = ANY(${excludedIds}::text[]))
      ORDER BY
        (
          SELECT COUNT(*)
          FROM "Order" o
          WHERE o."driverProfileId" = dp.id
            AND o.status::text NOT IN ('DELIVERED', 'RETURNED', 'CANCELLED', 'FAILED')
        ) ASC,
        CASE WHEN ${targetHubId}::text IS NOT NULL AND dp."assignedHubId" = ${targetHubId} THEN 0 ELSE 1 END ASC,
        dp."availableSince" ASC NULLS LAST,
        dp."createdAt" ASC
      LIMIT 1
      FOR UPDATE OF dp SKIP LOCKED
    `;

    const now = new Date();
    const chosen = candidates?.[0];

    if (!chosen) {
      const pendingOrFailed = options?.isReassignment
        ? DeliveryAssignmentStatus.REASSIGNMENT_PENDING
        : DeliveryAssignmentStatus.FAILED;
      const reason = options?.isReassignment
        ? 'No eligible alternate delivery partner online for reassignment'
        : 'No eligible online delivery partner available';

      await tx.order.update({
        where: { id: order.id },
        data: {
          driverId: null,
          driverProfileId: null,
          deliveryAssignmentStatus: pendingOrFailed,
          assignmentFailureReason: reason,
        },
      });

      await tx.dispatchAssignment.upsert({
        where: { orderId: order.id },
        update: {
          driverProfileId: null,
          status: pendingOrFailed,
          assignmentStatus: pendingOrFailed,
          assignmentSource: 'AUTO',
          assignedByActorId: actor.actorId || null,
          assignedByRole: actor.actorRole || 'SYSTEM',
          failureReason: reason,
          rejectedDriverIds: excludedIds,
          attempts: { increment: 1 },
        },
        create: {
          orderId: order.id,
          driverProfileId: null,
          status: pendingOrFailed,
          assignmentStatus: pendingOrFailed,
          assignmentSource: 'AUTO',
          assignedByActorId: actor.actorId || null,
          assignedByRole: actor.actorRole || 'SYSTEM',
          failureReason: reason,
          rejectedDriverIds: excludedIds,
          attempts: 1,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.actorId || null,
          userRole: String(actor.actorRole || 'SYSTEM'),
          action: 'DELIVERY_ASSIGNMENT_FAILED',
          entityType: 'Order',
          entityId: order.id,
          details: JSON.stringify({
            orderNumber: order.orderNumber,
            deliveryAssignmentStatus: pendingOrFailed,
            reason,
          }),
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'DISPATCH',
          aggregateId: order.id,
          eventType: QueueJobType.DELIVERY_ASSIGNMENT_FAILED,
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            vendorId: order.vendorId ?? null,
            vendorUserId: order.vendor?.userId ?? null,
            recipientRole: Role.ADMIN,
            deliveryAssignmentStatus: pendingOrFailed,
            reason,
            title: `Driver Assignment Failed #${order.orderNumber}`,
            message: `${reason}. Assign manually or wait for an online rider.`,
          },
        },
      });

      return {
        assigned: false,
        deliveryAssignmentStatus: pendingOrFailed,
        driverProfileId: null,
        driverUserId: null,
        driverName: null,
        failureReason: reason,
      };
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        driverId: chosen.userId,
        driverProfileId: chosen.id,
        deliveryAssignmentStatus: DeliveryAssignmentStatus.ASSIGNED,
        assignmentFailureReason: null,
      },
    });

    await tx.dispatchAssignment.upsert({
      where: { orderId: order.id },
      update: {
        driverProfileId: chosen.id,
        status: 'ASSIGNED',
        assignmentStatus: DeliveryAssignmentStatus.ASSIGNED,
        assignmentSource: 'AUTO',
        assignedByActorId: actor.actorId || null,
        assignedByRole: actor.actorRole || 'SYSTEM',
        offeredAt: now,
        acceptedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        failureReason: null,
        rejectedDriverIds: excludedIds,
        attempts: { increment: 1 },
      },
      create: {
        orderId: order.id,
        driverProfileId: chosen.id,
        status: 'ASSIGNED',
        assignmentStatus: DeliveryAssignmentStatus.ASSIGNED,
        assignmentSource: 'AUTO',
        assignedByActorId: actor.actorId || null,
        assignedByRole: actor.actorRole || 'SYSTEM',
        offeredAt: now,
        rejectedDriverIds: excludedIds,
        attempts: 1,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.actorId || null,
        userRole: String(actor.actorRole || 'SYSTEM'),
        action: 'DELIVERY_ASSIGNMENT_CREATED',
        entityType: 'Order',
        entityId: order.id,
        details: JSON.stringify({
          orderNumber: order.orderNumber,
          driverProfileId: chosen.id,
          driverUserId: chosen.userId,
          driverName: chosen.fullName,
          source: 'AUTO',
        }),
      },
    });

    await tx.outboxEvent.create({
      data: {
        aggregateType: 'DISPATCH',
        aggregateId: order.id,
        eventType: QueueJobType.DRIVER_ASSIGNMENT_NOTIFICATION,
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: chosen.userId,
          driverUserId: chosen.userId,
          driverId: chosen.userId,
          driverProfileId: chosen.id,
          status: order.status,
          deliveryAssignmentStatus: DeliveryAssignmentStatus.ASSIGNED,
          title: `New Delivery Assigned #${order.orderNumber}`,
          message: `Order #${order.orderNumber} (${order.vendor?.storeName || 'KudiCart Hub'}) assigned to you.`,
        },
      },
    });

    return {
      assigned: true,
      alreadyAssigned: false,
      deliveryAssignmentStatus: DeliveryAssignmentStatus.ASSIGNED,
      driverProfileId: chosen.id,
      driverUserId: chosen.userId,
      driverName: chosen.fullName,
      failureReason: null,
    };
  }

  /**
   * Admin manual driver assignment or reassignment.
   * Preserves OrderProcessingStatus independently (does not overwrite ACCEPTED/PACKING/READY_FOR_PICKUP to ASSIGNED).
   */
  async assignManually(
    orderId: string,
    driverIdOrProfileId: string,
    actor: AssignmentActor,
    note?: string,
  ) {
    this.ensureDbConnected();
    const cleanId = orderId.trim().replace(/^#/, '');

    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: driverIdOrProfileId }, { userId: driverIdOrProfileId }] },
      include: { user: true },
    });

    if (!driver) {
      throw new NotFoundException(`Delivery partner '${driverIdOrProfileId}' not found.`);
    }

    if (driver.kycStatus !== 'APPROVED') {
      throw new BadRequestException(
        `Cannot assign rider '${driver.fullName}': KYC status is '${driver.kycStatus}'.`,
      );
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }] },
        include: {
          items: true,
          vendor: true,
          driver: true,
          driverProfile: true,
          address: true,
          tryAndBuySession: true,
          dispatchAssignment: true,
          history: { orderBy: { createdAt: 'asc' } },
          customer: { select: { id: true, name: true, phone: true, email: true } },
          checkoutGroup: true,
        },
      });

      if (!order) {
        throw new NotFoundException(`Order '${orderId}' not found.`);
      }

      if (TERMINAL_ORDER_STATUSES.includes(order.status as any)) {
        throw new BadRequestException(
          `Cannot assign a delivery partner to terminal order #${order.orderNumber} (${order.status}).`,
        );
      }

      if (order.status === 'PLACED') {
        throw new BadRequestException(
          `Accept Order #${order.orderNumber} before assigning a delivery partner.`,
        );
      }

      if (
        order.pickedUpAt ||
        order.status === 'OUT_FOR_DELIVERY' ||
        order.status === 'TRY_AND_BUY' ||
        order.status === 'RETURNING'
      ) {
        throw new BadRequestException(
          `Cannot reassign Order #${order.orderNumber} after pickup (${order.status}).`,
        );
      }

      // Idempotent guard if already actively assigned to the exact same driver
      if (
        order.driverProfileId === driver.id &&
        (order.deliveryAssignmentStatus === DeliveryAssignmentStatus.ASSIGNED ||
          order.deliveryAssignmentStatus === DeliveryAssignmentStatus.ACCEPTED_BY_DELIVERY_PARTNER)
      ) {
        return order;
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          driverId: driver.userId,
          driverProfileId: driver.id,
          deliveryAssignmentStatus: DeliveryAssignmentStatus.ASSIGNED,
          assignmentFailureReason: null,
          version: { increment: 1 },
        },
      });

      await tx.dispatchAssignment.upsert({
        where: { orderId: order.id },
        update: {
          driverProfileId: driver.id,
          status: 'ASSIGNED',
          assignmentStatus: DeliveryAssignmentStatus.ASSIGNED,
          assignmentSource: 'MANUAL',
          assignedByActorId: actor.actorId || null,
          assignedByRole: actor.actorRole || Role.ADMIN,
          offeredAt: now,
          acceptedAt: null,
          rejectedAt: null,
          rejectionReason: null,
          failureReason: null,
          attempts: { increment: 1 },
        },
        create: {
          orderId: order.id,
          driverProfileId: driver.id,
          status: 'ASSIGNED',
          assignmentStatus: DeliveryAssignmentStatus.ASSIGNED,
          assignmentSource: 'MANUAL',
          assignedByActorId: actor.actorId || null,
          assignedByRole: actor.actorRole || Role.ADMIN,
          offeredAt: now,
          attempts: 1,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.actorId || null,
          userRole: String(actor.actorRole || Role.ADMIN),
          action: 'ADMIN_MANUAL_DRIVER_ASSIGNED',
          entityType: 'Order',
          entityId: order.id,
          details: JSON.stringify({
            orderNumber: order.orderNumber,
            driverProfileId: driver.id,
            driverName: driver.fullName,
            note: note?.trim() || null,
          }),
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'DISPATCH',
          aggregateId: order.id,
          eventType: QueueJobType.DRIVER_ASSIGNMENT_NOTIFICATION,
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            userId: driver.userId,
            driverUserId: driver.userId,
            driverId: driver.userId,
            driverProfileId: driver.id,
            status: order.status,
            deliveryAssignmentStatus: DeliveryAssignmentStatus.ASSIGNED,
            title: `Delivery Assigned #${order.orderNumber}`,
            message: `Admin assigned Order #${order.orderNumber} from ${order.vendor?.storeName || 'store'} to you.`,
          },
        },
      });

      return tx.order.findUnique({
        where: { id: order.id },
        include: {
          items: true,
          vendor: true,
          driver: true,
          driverProfile: true,
          address: true,
          tryAndBuySession: true,
          dispatchAssignment: true,
          history: { orderBy: { createdAt: 'asc' } },
          customer: { select: { id: true, name: true, phone: true, email: true } },
          checkoutGroup: true,
        },
      });
    });

    if (updated) {
      this.trackingGateway?.broadcastStatusUpdate(updated.id, updated.status, {
        eventType: 'DELIVERY_ASSIGNMENT_CREATED',
        orderNumber: updated.orderNumber,
        version: updated.version,
        deliveryAssignmentStatus: updated.deliveryAssignmentStatus,
        driverId: updated.driverId,
        driverProfileId: updated.driverProfileId,
      });

      this.outboxService?.dispatchPendingEvents().catch((err) => {
        this.logger.warn(`Manual assignment outbox dispatch deferred: ${err?.message}`);
      });
    }

    return { driver, order: updated };
  }

  /**
   * Delivery Partner accepts the current assignment.
   * Updates DeliveryAssignmentStatus to ACCEPTED_BY_DELIVERY_PARTNER without changing Order.status.
   */
  async acceptAssignment(driverIdOrUserId: string, orderId: string) {
    this.ensureDbConnected();
    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: driverIdOrUserId }, { userId: driverIdOrUserId }] },
    });
    if (!driver) {
      throw new NotFoundException(`Driver '${driverIdOrUserId}' not found`);
    }

    const cleanId = orderId.trim().replace(/^#/, '');
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }] },
        include: {
          items: { include: { product: { include: { darkStoreHub: true } } } },
          history: { orderBy: { createdAt: 'asc' } },
          customer: { select: { id: true, name: true, phone: true } },
          vendor: { include: { user: { select: { id: true, name: true, phone: true } } } },
          address: true,
          tryAndBuySession: true,
          dispatchAssignment: true,
        },
      });
      if (!order) {
        throw new NotFoundException(`Order '${orderId}' not found`);
      }

      const isAssignedToDriver =
        order.driverProfileId === driver.id || order.driverId === driver.userId;
      if (!isAssignedToDriver) {
        throw new ForbiddenException('Order is not assigned to your driver account');
      }

      if (TERMINAL_ORDER_STATUSES.includes(order.status as any)) {
        throw new BadRequestException(`Cannot accept terminal order (${order.status})`);
      }

      if (order.deliveryAssignmentStatus === DeliveryAssignmentStatus.ACCEPTED_BY_DELIVERY_PARTNER) {
        return order;
      }

      if (
        order.deliveryAssignmentStatus !== DeliveryAssignmentStatus.ASSIGNED &&
        order.status !== ('ASSIGNED' as any)
      ) {
        throw new BadRequestException(
          `Order assignment cannot be accepted from state '${order.deliveryAssignmentStatus}'.`,
        );
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          deliveryAssignmentStatus: DeliveryAssignmentStatus.ACCEPTED_BY_DELIVERY_PARTNER,
          assignmentFailureReason: null,
        },
      });

      await tx.dispatchAssignment.upsert({
        where: { orderId: order.id },
        update: {
          driverProfileId: driver.id,
          status: 'ACCEPTED',
          assignmentStatus: DeliveryAssignmentStatus.ACCEPTED_BY_DELIVERY_PARTNER,
          respondedAt: now,
          acceptedAt: now,
        },
        create: {
          orderId: order.id,
          driverProfileId: driver.id,
          status: 'ACCEPTED',
          assignmentStatus: DeliveryAssignmentStatus.ACCEPTED_BY_DELIVERY_PARTNER,
          assignmentSource: 'AUTO',
          offeredAt: now,
          respondedAt: now,
          acceptedAt: now,
          attempts: 1,
        },
      });

      await tx.auditLog.create({
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

      return tx.order.findUnique({
        where: { id: order.id },
        include: {
          items: { include: { product: { include: { darkStoreHub: true } } } },
          history: { orderBy: { createdAt: 'asc' } },
          customer: { select: { id: true, name: true, phone: true } },
          vendor: { include: { user: { select: { id: true, name: true, phone: true } } } },
          address: true,
          tryAndBuySession: true,
          dispatchAssignment: true,
        },
      });
    });

    if (updated) {
      this.trackingGateway?.broadcastStatusUpdate(updated.id, updated.status, {
        eventType: 'ORDER_STATUS_UPDATE',
        orderNumber: updated.orderNumber,
        deliveryAssignmentStatus: updated.deliveryAssignmentStatus,
      });
    }

    return updated;
  }

  /**
   * Delivery Partner rejects/declines the assignment prior to pickup.
   * Excludes rejecting driver and immediately triggers automatic reassignment to the next eligible partner.
   */
  async rejectAssignment(driverIdOrUserId: string, orderId: string, reason?: string) {
    this.ensureDbConnected();
    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: driverIdOrUserId }, { userId: driverIdOrUserId }] },
    });
    if (!driver) {
      throw new NotFoundException(`Driver '${driverIdOrUserId}' not found`);
    }

    const cleanId = orderId.trim().replace(/^#/, '');
    const now = new Date();
    const cleanReason = reason?.trim() || 'Declined by delivery partner';

    const outcome = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }] },
        include: {
          items: { include: { product: { include: { darkStoreHub: true } } } },
          vendor: true,
          dispatchAssignment: true,
        },
      });

      if (!order) {
        throw new NotFoundException(`Order '${orderId}' not found`);
      }

      const isAssignedToDriver =
        order.driverProfileId === driver.id || order.driverId === driver.userId;
      if (!isAssignedToDriver) {
        throw new ForbiddenException('Order is not assigned to your driver account');
      }

      if (
        order.pickedUpAt ||
        order.status === 'OUT_FOR_DELIVERY' ||
        order.status === 'PICKED_UP' ||
        order.status === 'TRY_AND_BUY' ||
        order.status === 'RETURNING' ||
        TERMINAL_ORDER_STATUSES.includes(order.status as any)
      ) {
        throw new BadRequestException(
          `Cannot reject assignment after pickup or completion (status: ${order.status})`,
        );
      }

      const prevRejected = Array.isArray(order.dispatchAssignment?.rejectedDriverIds)
        ? order.dispatchAssignment.rejectedDriverIds
        : [];
      const nextRejected = Array.from(new Set([...prevRejected, driver.id]));

      await tx.order.update({
        where: { id: order.id },
        data: {
          driverId: null,
          driverProfileId: null,
          deliveryAssignmentStatus: DeliveryAssignmentStatus.REJECTED_BY_DELIVERY_PARTNER,
        },
      });

      await tx.dispatchAssignment.upsert({
        where: { orderId: order.id },
        update: {
          driverProfileId: null,
          status: 'REJECTED',
          assignmentStatus: DeliveryAssignmentStatus.REJECTED_BY_DELIVERY_PARTNER,
          respondedAt: now,
          rejectedAt: now,
          rejectionReason: cleanReason,
          rejectedDriverIds: nextRejected,
        },
        create: {
          orderId: order.id,
          driverProfileId: null,
          status: 'REJECTED',
          assignmentStatus: DeliveryAssignmentStatus.REJECTED_BY_DELIVERY_PARTNER,
          assignmentSource: 'AUTO',
          respondedAt: now,
          rejectedAt: now,
          rejectionReason: cleanReason,
          rejectedDriverIds: nextRejected,
          attempts: 1,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: driver.userId,
          userRole: Role.DRIVER,
          action: 'DRIVER_REJECTED_ASSIGNMENT',
          entityType: 'Order',
          entityId: order.id,
          details: JSON.stringify({
            orderNumber: order.orderNumber,
            driverProfileId: driver.id,
            reason: cleanReason,
          }),
        },
      });

      // Immediately attempt automatic reassignment to the next eligible online partner
      const reassignResult = await this.assignOrderInTransaction(
        tx,
        {
          ...order,
          driverId: null,
          driverProfileId: null,
          deliveryAssignmentStatus: DeliveryAssignmentStatus.REASSIGNMENT_PENDING,
        },
        { actorId: driver.userId, actorRole: Role.DRIVER },
        {
          isReassignment: true,
          excludeDriverProfileIds: nextRejected,
          forceReassign: true,
        },
      );

      const refreshed = await tx.order.findUnique({
        where: { id: order.id },
        include: {
          dispatchAssignment: true,
          driverProfile: true,
        },
      });

      return { reassignResult, refreshed };
    });

    if (outcome.refreshed) {
      this.trackingGateway?.broadcastStatusUpdate(
        outcome.refreshed.id,
        outcome.refreshed.status,
        {
          eventType: outcome.reassignResult.assigned
            ? 'DELIVERY_ASSIGNMENT_CREATED'
            : 'DELIVERY_ASSIGNMENT_FAILED',
          orderNumber: outcome.refreshed.orderNumber,
          deliveryAssignmentStatus: outcome.refreshed.deliveryAssignmentStatus,
          driverId: outcome.refreshed.driverId,
          driverProfileId: outcome.refreshed.driverProfileId,
        },
      );

      this.outboxService?.dispatchPendingEvents().catch((err) => {
        this.logger.warn(`Post-rejection outbox dispatch deferred: ${err?.message}`);
      });
    }

    return outcome;
  }

  /**
   * Retries assignment for accepted/packing/ready orders currently waiting for a delivery partner.
   */
  async retryOrderAssignment(orderId: string, actor: AssignmentActor) {
    this.ensureDbConnected();
    const cleanId = orderId.trim().replace(/^#/, '');

    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }] },
        include: {
          items: { include: { product: { include: { darkStoreHub: true } } } },
          vendor: true,
          dispatchAssignment: true,
        },
      });

      if (!order) {
        throw new NotFoundException(`Order '${orderId}' not found`);
      }

      if (order.status === 'PLACED' || TERMINAL_ORDER_STATUSES.includes(order.status as any)) {
        throw new BadRequestException(
          `Cannot assign delivery partner when order status is '${order.status}'.`,
        );
      }

      const assignRes = await this.assignOrderInTransaction(tx, order, actor, {
        isReassignment:
          order.deliveryAssignmentStatus === DeliveryAssignmentStatus.REASSIGNMENT_PENDING ||
          order.deliveryAssignmentStatus === DeliveryAssignmentStatus.REJECTED_BY_DELIVERY_PARTNER,
      });

      const refreshed = await tx.order.findUnique({
        where: { id: order.id },
        include: {
          items: true,
          vendor: true,
          driver: true,
          driverProfile: true,
          address: true,
          tryAndBuySession: true,
          dispatchAssignment: true,
          history: { orderBy: { createdAt: 'asc' } },
          customer: { select: { id: true, name: true, phone: true, email: true } },
          checkoutGroup: true,
        },
      });

      return { assignRes, order: refreshed };
    });

    if (result.order) {
      this.trackingGateway?.broadcastStatusUpdate(
        result.order.id,
        result.order.status,
        {
          eventType: result.assignRes.assigned
            ? 'DELIVERY_ASSIGNMENT_CREATED'
            : 'DELIVERY_ASSIGNMENT_FAILED',
          orderNumber: result.order.orderNumber,
          deliveryAssignmentStatus: result.order.deliveryAssignmentStatus,
          driverId: result.order.driverId,
          driverProfileId: result.order.driverProfileId,
        },
      );
      this.outboxService?.dispatchPendingEvents().catch(() => undefined);
    }

    return result;
  }

  /**
   * Automatically dispatches pending/failed/reassignment-pending orders when a driver goes online or frees up.
   */
  async retryPendingAssignments(limit = 10): Promise<number> {
    if (!this.prisma.isConnectedToDb) return 0;

    const pendingOrders = await this.prisma.order.findMany({
      where: {
        status: {
          in: ['ACCEPTED', 'PACKING', 'PREPARING', 'READY_FOR_PICKUP'] as any[],
        },
        deliveryAssignmentStatus: {
          in: [
            DeliveryAssignmentStatus.NOT_ASSIGNED,
            DeliveryAssignmentStatus.ASSIGNMENT_PENDING,
            DeliveryAssignmentStatus.REASSIGNMENT_PENDING,
            DeliveryAssignmentStatus.FAILED,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    let assignedCount = 0;
    for (const row of pendingOrders) {
      try {
        const res = await this.retryOrderAssignment(row.id, {
          actorId: null,
          actorRole: 'SYSTEM',
          actorName: 'Auto Dispatch Worker',
        });
        if (res.assignRes.assigned && !res.assignRes.alreadyAssigned) {
          assignedCount += 1;
        }
      } catch (err: any) {
        this.logger.warn(`Auto-dispatch retry skipped for ${row.id}: ${err?.message}`);
      }
    }

    return assignedCount;
  }
}
