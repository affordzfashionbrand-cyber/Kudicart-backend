import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async generateReport(category: string, _query: AdminQueryDto) {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }

    const cat = (category || 'ORDERS').toUpperCase();

    if (cat === 'ORDERS') {
      const orders = await this.prisma.order.findMany({
        include: {
          customer: true,
          vendor: { include: { categoryCommissions: true } },
          driver: true,
          driverProfile: true,
          items: { include: { product: { select: { categoryId: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const rows = orders.map((o) => {
        const computedItemCommission = o.items.reduce((sum, it: any) => {
          if (typeof it.commissionAmount === 'number') {
            return sum + it.commissionAmount;
          }
          const catMatch = o.vendor?.categoryCommissions?.find(
            (cc: any) => cc.categoryId === it.product?.categoryId,
          );
          const itemRate =
            typeof it.appliedCommissionRate === 'number'
              ? it.appliedCommissionRate
              : (catMatch?.commissionRate ?? o.vendor?.commissionRate ?? 12.5);
          return sum + (Number(it.price) || 0) * (it.quantity || 1) * (itemRate / 100);
        }, 0);
        const rate = o.vendor?.commissionRate ?? 12.5;
        const commission = Number(
          (o.items.length > 0
            ? computedItemCommission
            : (o.grandTotal || 0) * (rate / 100)
          ).toFixed(2),
        );
        return {
          orderId: o.orderNumber,
          dateTime: o.createdAt.toISOString(),
          customerName: o.customer?.name || 'Customer',
          vendorName: o.vendor?.storeName || 'Affordz Official Store',
          itemsCount: o.items.length,
          grossGmv: o.grandTotal,
          commission,
          deliveryPartner:
            o.driverProfile?.fullName || o.driver?.name || 'Unassigned',
          status: o.status,
        };
      });

      return {
        category: 'ORDERS',
        total: rows.length,
        data: rows,
      };
    }

    if (cat === 'VENDORS') {
      const vendors = await this.prisma.vendor.findMany({
        include: {
          orders: { include: { items: true } },
          payouts: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { storeName: 'asc' },
      });

      const rows = vendors.map((v) => {
        const deliveredOrders = v.orders.filter((o) => o.status === 'DELIVERED');
        const grossSales = Number(
          deliveredOrders.reduce((sum, o) => sum + (o.grandTotal || 0), 0).toFixed(2),
        );
        const commissionRate = v.commissionRate ?? 12.5;
        const trackedCommission = deliveredOrders.reduce(
          (sum, o) =>
            sum +
            o.items.reduce(
              (s, it: any) =>
                s +
                (typeof it.commissionAmount === 'number'
                  ? it.commissionAmount
                  : (Number(it.price) || 0) *
                    (it.quantity || 1) *
                    ((it.appliedCommissionRate ?? commissionRate) / 100)),
              0,
            ),
          0,
        );
        const commissionRetained = Number(
          (trackedCommission > 0
            ? trackedCommission
            : grossSales * (commissionRate / 100)
          ).toFixed(2),
        );
        const netPayable = Number((grossSales - commissionRetained).toFixed(2));
        return {
          vendorId: v.id,
          boutiqueName: v.storeName,
          operatingHub: v.operatingHub || 'Affordz Official Dark Store',
          deliveredOrders: deliveredOrders.length,
          grossSales,
          commissionRate,
          commissionRetained,
          netPayable,
          settlementStatus: v.payouts[0]?.status || 'CYCLE_ACCRUING',
        };
      });

      return {
        category: 'VENDORS',
        total: rows.length,
        data: rows,
      };
    }

    if (cat === 'DRIVERS') {
      const defaultPayout = Number(process.env.DRIVER_BASE_PAYOUT_RUPEES) || 55;
      const [drivers, driverPayoutEntries] = await Promise.all([
        this.prisma.driverProfile.findMany({
          orderBy: { fullName: 'asc' },
        }),
        this.prisma.ledgerEntry.findMany({
          where: { entryType: { in: ['DRIVER_PAYOUT', 'DRIVER_BONUS', 'SURGE_BONUS'] } },
          select: { driverId: true, amount: true },
        }),
      ]);

      const payoutByDriver = new Map<string, number>();
      for (const entry of driverPayoutEntries) {
        if (!entry.driverId) continue;
        payoutByDriver.set(
          entry.driverId,
          (payoutByDriver.get(entry.driverId) || 0) + (Number(entry.amount) || 0),
        );
      }

      const rows = drivers.map((d) => ({
        partnerId: d.id,
        name: d.fullName,
        vehicleType: d.vehicleType || 'Two-Wheeler',
        completedRuns: d.completedDeliveries || 0,
        payoutTotal:
          payoutByDriver.get(d.id) ??
          payoutByDriver.get(d.userId) ??
          (d.completedDeliveries || 0) * defaultPayout,
        status: d.isOnline ? 'Active' : 'Standby',
      }));

      return {
        category: 'DRIVERS',
        total: rows.length,
        data: rows,
      };
    }

    if (cat === 'CATALOG') {
      const products = await this.prisma.product.findMany({
        include: {
          vendor: true,
          darkStoreHub: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const rows = products.map((p) => ({
        sku: p.sku || `SKU-${p.id.toUpperCase()}`,
        title: p.title,
        brand: p.brand,
        vendor: p.vendor?.storeName || 'Affordz Official Store',
        nodeHub: p.darkStoreHub?.name || 'Unassigned',
        stockQty: p.stockQuantity,
        lowStockAlert: p.stockQuantity <= 5,
        mrp: p.originalPrice || p.price,
        sellingPrice: p.price,
        status: p.listingStatus || 'ACTIVE',
      }));

      return {
        category: 'CATALOG',
        total: rows.length,
        data: rows,
      };
    }

    throw new BadRequestException(
      `Unknown report category '${category}'. Valid categories: ORDERS, VENDORS, DRIVERS, CATALOG.`,
    );
  }
}

