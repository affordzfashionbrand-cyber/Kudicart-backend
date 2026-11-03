import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachineService } from './state-machine.service';

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: StateMachineService,
  ) {}

  /**
   * Automatically dispatches the earliest eligible available driver in FIFO order.
   * Concurrency-safe and atomic.
   */
  async dispatchOrderFifo(orderId: string) {
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    if (order.status !== 'READY_FOR_PICKUP') {
      this.logger.warn(
        `Order ${orderId} is in status ${order.status}; auto-dispatch requires READY_FOR_PICKUP.`,
      );
      return {
        success: false,
        message: `Order must be READY_FOR_PICKUP to auto-dispatch. Current: ${order.status}`,
      };
    }

    // 1. Database-backed atomic FIFO dispatch
    if (this.prisma.isConnectedToDb) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const currentOrder = await tx.order.findFirst({
            where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
          });

          if (!currentOrder || currentOrder.status !== 'READY_FOR_PICKUP') {
            return null;
          }

          const activeAssignments = await tx.order.findMany({
            where: {
              status: { in: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] },
              driverProfileId: { not: null },
            },
            select: { driverProfileId: true },
          });

          const busyDriverIds = new Set(
            activeAssignments.map((a) => a.driverProfileId).filter(Boolean),
          );

          // Find earliest eligible driver: isOnline = true, kycStatus = 'APPROVED', not busy, availableSince active
          // Ordered strictly by persistent queue entry time (availableSince ASC), with id as deterministic tie-breaker
          const eligibleDriver = await tx.driverProfile.findFirst({
            where: {
              isOnline: true,
              kycStatus: 'APPROVED',
              availableSince: { not: null },
              id: { notIn: Array.from(busyDriverIds) as string[] },
            },
            orderBy: [{ availableSince: 'asc' }, { id: 'asc' }],
          });

          if (!eligibleDriver) {
            this.logger.log(
              `No online delivery partners currently available for FIFO dispatch of order ${currentOrder.orderNumber}`,
            );
            return { dispatched: false, reason: 'NO_DRIVERS_AVAILABLE' };
          }

          // Consume / clear driver's FIFO eligibility timestamp while occupied with active delivery
          await tx.driverProfile.update({
            where: { id: eligibleDriver.id },
            data: { availableSince: null },
          });

          await tx.order.update({
            where: { id: currentOrder.id },
            data: {
              driverId: eligibleDriver.userId,
              driverProfileId: eligibleDriver.id,
              status: 'ASSIGNED',
            },
          });

          await tx.orderStatusHistory.create({
            data: {
              orderId: currentOrder.id,
              status: 'ASSIGNED',
              note: `Automated FIFO dispatch assigned rider ${eligibleDriver.fullName} (${eligibleDriver.vehicleType || 'Motorbike'})`,
            },
          });

          await tx.dispatchAssignment.upsert({
            where: { orderId: currentOrder.id },
            create: {
              orderId: currentOrder.id,
              driverProfileId: eligibleDriver.id,
              status: 'ACCEPTED',
              offeredAt: new Date(),
              respondedAt: new Date(),
            },
            update: {
              driverProfileId: eligibleDriver.id,
              status: 'ACCEPTED',
              respondedAt: new Date(),
            },
          });

          // Atomically persist driver assignment notification to transactional outbox
          await tx.outboxEvent.create({
            data: {
              aggregateType: 'DISPATCH',
              aggregateId: currentOrder.id,
              eventType: 'DRIVER_ASSIGNMENT_NOTIFICATION',
              payload: {
                orderId: currentOrder.id,
                orderNumber: currentOrder.orderNumber,
                driverId: eligibleDriver.id,
                userId: eligibleDriver.userId,
                driverName: eligibleDriver.fullName,
              },
              status: 'PENDING',
            },
          });

          return { dispatched: true, driver: eligibleDriver, orderId: currentOrder.id };
        });

        if (result && result.dispatched && result.driver) {
          order.driverId = result.driver.id;
          order.status = 'ASSIGNED';
          order.updatedAt = new Date().toISOString();
          order.history.push({
            status: 'ASSIGNED',
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            note: `Automated FIFO dispatch assigned rider ${result.driver.fullName} (${result.driver.vehicleType || 'Motorbike'})`,
            actor: 'SYSTEM',
          });

          return {
            success: true,
            message: `Automated FIFO dispatch assigned driver ${result.driver.fullName}`,
            driver: result.driver,
            order,
          };
        }
      } catch (err: any) {
        this.logger.error(`Database FIFO dispatch failed: ${err.message}`, err.stack);
      }
    }

    // 2. In-memory store FIFO dispatch fallback
    const activeBusyDriverIds = new Set(
      store.orders
        .filter(
          (o) =>
            ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(o.status) && o.driverId,
        )
        .map((o) => o.driverId),
    );

    const eligibleDrivers = store.drivers
      .filter(
        (d) =>
          d.isOnline &&
          d.kycStatus === 'APPROVED' &&
          d.availableSince != null &&
          !activeBusyDriverIds.has(d.id),
      )
      .sort((a, b) => {
        const timeA = a.availableSince ? new Date(a.availableSince).getTime() : 0;
        const timeB = b.availableSince ? new Date(b.availableSince).getTime() : 0;
        if (timeA !== timeB) return timeA - timeB;
        return a.id.localeCompare(b.id);
      });

    const assignedDriver = eligibleDrivers[0];

    if (!assignedDriver) {
      return {
        success: false,
        message: 'No delivery partners are currently available for dispatch',
      };
    }

    // Consume / clear FIFO eligibility timestamp while occupied with active delivery
    assignedDriver.availableSince = null;

    order.driverId = assignedDriver.id;
    order.status = 'ASSIGNED';
    order.updatedAt = new Date().toISOString();
    order.history.push({
      status: 'ASSIGNED',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      note: `Automated FIFO dispatch assigned rider ${assignedDriver.name} (${assignedDriver.vehicle || 'Bike'})`,
      actor: 'SYSTEM',
    });

    return {
      success: true,
      message: `Automated FIFO dispatch assigned rider ${assignedDriver.name}`,
      driver: assignedDriver,
      order,
    };
  }

  async getDispatchQueue() {
    const store = this.prisma.getStore();
    const pendingOrders = store.orders.filter((o) => o.status === 'READY_FOR_PICKUP');
    const availableDrivers = store.drivers.filter(
      (d) => d.isOnline && d.kycStatus === 'APPROVED',
    );

    return {
      queueLength: pendingOrders.length,
      availableDriversCount: availableDrivers.length,
      pendingOrders,
      availableDrivers,
    };
  }
}

