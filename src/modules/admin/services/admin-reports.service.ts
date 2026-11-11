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
          vendor: true,
          driver: true,
          driverProfile: true,
          items: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const rows = orders.map((o) => {
        const rate = o.vendor?.commissionRate ?? 12.5;
        const commission = Number((o.grandTotal * (rate / 100)).toFixed(2));
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
          orders: true,
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
        const commissionRetained = Number((grossSales * (commissionRate / 100)).toFixed(2));
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
      const drivers = await this.prisma.driverProfile.findMany({
        orderBy: { fullName: 'asc' },
      });

      const rows = drivers.map((d) => ({
        partnerId: d.id,
        name: d.fullName,
        vehicleType: d.vehicleType || 'Two-Wheeler',
        completedRuns: d.completedDeliveries || 0,
        payoutTotal: (d.completedDeliveries || 0) * 55,
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

