import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CANONICAL_ORDER_STATUSES } from '../../../common/contracts/order-contracts';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }

    const [
      orders,
      vendorCount,
      pendingVendors,
      driverProfiles,
      pendingDrivers,
      paymentTransactions,
      supportTicketsOpen,
    ] = await Promise.all([
      this.prisma.order.findMany({
        include: {
          customer: { select: { id: true, name: true } },
          vendor: { select: { id: true, storeName: true } },
          driverProfile: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vendor.count(),
      this.prisma.vendor.findMany({
        where: { status: 'PENDING' },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.driverProfile.findMany({
        include: { user: { select: { id: true, email: true, status: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.driverProfile.findMany({
        where: { kycStatus: 'PENDING' },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentTransaction.findMany({
        where: { status: 'COMPLETED', transactionType: 'CAPTURE' },
      }),
      this.prisma.supportTicket.count({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
    ]);

    const statusCountMap: Record<string, number> = {};
    for (const s of CANONICAL_ORDER_STATUSES) {
      statusCountMap[s] = 0;
    }
    for (const ord of orders) {
      statusCountMap[ord.status] = (statusCountMap[ord.status] || 0) + 1;
    }

    const unassignedCount = statusCountMap.READY_FOR_PICKUP || 0;
    const totalOrders = orders.length;
    const nonCancelledOrders = orders.filter(
      (o) => o.status !== 'CANCELLED' && o.status !== 'FAILED',
    );
    const gov = Math.round(
      nonCancelledOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0),
    );

    const pipelineCounts = {
      placed: statusCountMap.PLACED,
      accepted: statusCountMap.ACCEPTED,
      packing: statusCountMap.PACKING,
      preparing: statusCountMap.PREPARING,
      readyForPickup: statusCountMap.READY_FOR_PICKUP,
      assigned: statusCountMap.ASSIGNED,
      pickedUp: statusCountMap.PICKED_UP,
      inTransit: statusCountMap.OUT_FOR_DELIVERY,
      outForDelivery: statusCountMap.OUT_FOR_DELIVERY,
      tryAndBuy: statusCountMap.TRY_AND_BUY,
      delivered: statusCountMap.DELIVERED,
      returning: statusCountMap.RETURNING,
      returned: statusCountMap.RETURNED,
      cancelled: statusCountMap.CANCELLED,
      failed: statusCountMap.FAILED,
    };

    const recentOrders = orders.slice(0, 8).map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      version: o.version,
      customerName: o.customer?.name || (o.deliveryAddress as any)?.recipientName || 'Customer',
      vendorName: o.vendor?.storeName || 'Affordz Official Store',
      driverName: o.driverProfile?.fullName || null,
      fulfillmentType: o.isTryAndBuy ? 'Try & Buy' : o.fulfillmentType,
      grandTotal: Math.round(o.grandTotal || 0),
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt.toISOString(),
    }));

    return {
      actionRequired: {
        unassignedCount,
        pendingBoutiquesCount: pendingVendors.length,
        driverKycCount: pendingDrivers.length,
        openTicketsCount: supportTicketsOpen,
      },
      operationalQueues: {
        readyForPickup: statusCountMap.READY_FOR_PICKUP,
        pendingBoutiques: pendingVendors.length,
        pendingDrivers: pendingDrivers.length,
        onlineDrivers: driverProfiles.filter((d) => d.isOnline).length,
      },
      metrics: {
        totalOrders,
        gov,
        grossVolume: gov,
        activeVendors: vendorCount,
        totalVendors: vendorCount,
        deliveryFleetCount: driverProfiles.length,
        onlineDrivers: driverProfiles.filter((d) => d.isOnline).length,
      },
      pipelineCounts,
      lifecyclePipeline: pipelineCounts,
      queues: {
        pendingBoutiques: pendingVendors.map((v) => ({
          id: v.id,
          storeName: v.storeName,
          ownerName: v.contactPerson || v.user?.name || 'Owner',
          email: v.user?.email || v.notificationEmail || null,
          operatingHub: v.operatingHub || null,
          createdAt: v.createdAt.toISOString(),
        })),
        driverKycQueue: pendingDrivers,
      },
      recentOrders,
      financialHealth: {
        grossVolume: gov,
        recordedTransactions: paymentTransactions.length,
      },
    };
  }
}
