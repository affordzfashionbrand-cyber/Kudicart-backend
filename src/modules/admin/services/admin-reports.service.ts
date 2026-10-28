import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';

@Injectable()
export class AdminReportsService {
  constructor(private prisma: PrismaService) {}

  async generateReport(category: string, query: AdminQueryDto) {
    const store = this.prisma.getStore();
    const cat = (category || 'ORDERS').toUpperCase();

    if (cat === 'ORDERS') {
      const rows = store.orders.map((o: any) => {
        const customer = (store.users || []).find((u: any) => u.id === o.customerId) || {
          name: o.customerName || 'Ananya Sharma',
        };
        const vendor = (store.adminVendors || []).find((v: any) => v.id === o.vendorId) || {
          storeName: o.vendorName || 'Avanya Ethnic Boutique',
        };
        const driver = (store.adminDrivers || []).find((d: any) => d.id === o.driverId) || {
          fullName: 'Deepak Solanki',
        };

        const commission = Number((o.grandTotal * 0.12).toFixed(2));

        return {
          orderId: o.orderNumber,
          dateTime: o.createdAt || '24 Oct 2024, 14:15 IST',
          customerName: customer.name,
          vendorName: vendor.storeName,
          itemsCount: o.items ? o.items.length : 1,
          grossGmv: o.grandTotal,
          commission,
          deliveryPartner: o.driverId ? driver.fullName : 'Unassigned',
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
      const rows = (store.adminVendors || []).map((v: any) => {
        const ledger = (store.vendorLedger || []).find((l: any) => l.vendorName === v.storeName) || {
          totalOrders: v.productCount || 42,
          grossGmv: 148200,
          commissionRate: 12.5,
          commissionRetained: 18525,
          netPayable: 129675,
          status: 'CYCLE_ACCRUING',
        };

        return {
          vendorId: v.vendorNumber || v.id,
          boutiqueName: v.storeName,
          operatingHub: v.operatingHub || 'Bandra West Terminal Hub',
          deliveredOrders: ledger.totalOrders,
          grossSales: ledger.grossGmv,
          commissionRate: ledger.commissionRate,
          commissionRetained: ledger.commissionRetained,
          netPayable: ledger.netPayable,
          settlementStatus: ledger.status,
        };
      });

      return {
        category: 'VENDORS',
        total: rows.length,
        data: rows,
      };
    }

    if (cat === 'DRIVERS') {
      const rows = (store.adminDrivers || []).map((d: any) => ({
        partnerId: d.driverCode || d.id,
        name: d.fullName,
        vehicleType: d.vehicleType,
        activeHours: 8.5,
        completedRuns: d.completedDeliveries || 0,
        avgDeliveryMinutes: 16,
        payoutTotal: (d.completedDeliveries || 10) * 85,
        status: d.isOnline ? 'Active' : 'Standby',
      }));

      return {
        category: 'DRIVERS',
        total: rows.length,
        data: rows,
      };
    }

    if (cat === 'CATALOG') {
      const rows = store.products.map((p: any) => {
        const vendor = (store.adminVendors || []).find((v: any) => v.id === p.vendorId) || {
          storeName: 'Avanya Ethnic Boutique',
        };

        return {
          sku: p.sku || `SKU-${p.id.toUpperCase()}`,
          title: p.title,
          brand: p.brand,
          vendor: vendor.storeName,
          nodeHub: p.hubAssignment || 'Bandra West Terminal Hub',
          stockQty: p.stockQuantity,
          lowStockAlert: p.stockQuantity <= 5,
          mrp: p.originalPrice || p.price * 1.5,
          sellingPrice: p.price,
          status: p.listingStatus || 'ACTIVE',
        };
      });

      return {
        category: 'CATALOG',
        total: rows.length,
        data: rows,
      };
    }

    throw new BadRequestException(`Unknown report category '${category}'. Valid categories: ORDERS, VENDORS, DRIVERS, CATALOG.`);
  }
}

