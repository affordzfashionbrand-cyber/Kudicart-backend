import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AdminDashboardService {
  constructor(private prisma: PrismaService) {}

  async getSummary() {
    const store = this.prisma.getStore();

    // 1. Action Required counts
    const unassignedCount = store.orders.filter(
      (o: any) => o.status === 'READY_FOR_PICKUP' || (o.status === 'ASSIGNED' && !o.driverId),
    ).length;

    const pendingBoutiquesCount = (store.adminVendors || []).filter(
      (v: any) =>
        v.status === 'PENDING_REVIEW' ||
        v.status === 'DOCS_SUBMITTED' ||
        v.status === 'KYC_PENDING',
    ).length;

    const driverKycCount = (store.adminDrivers || []).filter(
      (d: any) => d.kycStatus === 'PENDING',
    ).length;

    // 2. Marketplace Metrics
    const totalOrders = store.orders.length;
    const gov = store.orders.reduce((acc: number, o: any) => acc + (o.grandTotal || 0), 0);
    const allVendors = store.adminVendors || [];
    const activeVendors = allVendors.filter((v: any) => v.status === 'ACTIVE').length;
    const totalVendors = allVendors.length;
    const deliveryFleetCount = (store.adminDrivers || []).length;

    // 3. Pipeline Counts
    const pipelineCounts = {
      placed: store.orders.filter((o: any) => o.status === 'PLACED').length,
      accepted: store.orders.filter((o: any) => o.status === 'ACCEPTED').length,
      preparing: store.orders.filter((o: any) => o.status === 'PREPARING').length,
      readyForPickup: store.orders.filter((o: any) => o.status === 'READY_FOR_PICKUP').length,
      assigned: store.orders.filter((o: any) => o.status === 'ASSIGNED').length,
      pickedUp: store.orders.filter((o: any) => o.status === 'PICKED_UP').length,
      inTransit: store.orders.filter((o: any) => o.status === 'OUT_FOR_DELIVERY').length,
      delivered: store.orders.filter((o: any) => o.status === 'DELIVERED').length,
    };

    // 4. Queues
    const pendingBoutiques = allVendors
      .filter(
        (v: any) =>
          v.status === 'PENDING_REVIEW' ||
          v.status === 'DOCS_SUBMITTED' ||
          v.status === 'KYC_PENDING',
      )
      .slice(0, 5);

    const driverKycQueue = (store.adminDrivers || [])
      .filter((d: any) => d.kycStatus === 'PENDING')
      .slice(0, 5);

    // 5. Recent Orders
    const recentOrders = store.orders.slice(0, 8).map((o: any) => {
      const vendor = allVendors.find((v: any) => v.id === o.vendorId) || {
        storeName: 'Avanya Ethnic Boutique',
      };
      const customer = (store.users || []).find((u: any) => u.id === o.customerId) || {
        name: 'Ananya Sharma',
      };

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName || customer.name,
        vendorName: o.vendorName || vendor.storeName,
        fulfillmentType: o.isTryAndBuy ? 'Try & Buy' : 'Express (60m)',
        grandTotal: o.grandTotal,
        status: o.status,
        createdAt: o.createdAt,
      };
    });

    return {
      actionRequired: {
        unassignedCount,
        pendingBoutiquesCount,
        driverKycCount,
      },
      operationalQueues: {
        unassignedOrders: unassignedCount,
        pendingBoutiques: pendingBoutiquesCount,
        driverKyc: driverKycCount,
      },
      metrics: {
        totalOrders,
        gov,
        grossVolume: gov,
        activeVendors,
        totalVendors,
        deliveryFleetCount,
        activeDeliveryFleet: deliveryFleetCount,
      },
      pipelineCounts,
      lifecyclePipeline: pipelineCounts,
      queues: {
        pendingBoutiques,
        driverKycQueue,
      },
      recentOrders,
      financialHealth: {
        grossVolume: gov,
        recordedTransactions: totalOrders,
      },
    };
  }
}
