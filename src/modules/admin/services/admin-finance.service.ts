import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateSettlementStatusDto } from '../dto/admin-domain.dto';
import { DEFAULT_COMMISSION_RATE } from '../../orders/order-pricing.util';

@Injectable()
export class AdminFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  async listPayments(query: AdminQueryDto) {
    this.ensureDbConnected();
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;

    const where: any = {};
    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    const txns = await this.prisma.paymentTransaction.findMany({
      where,
      include: {
        order: {
          include: {
            customer: { select: { id: true, name: true, email: true } },
          },
        },
        checkoutGroup: {
          include: {
            customer: { select: { id: true, name: true, email: true } },
            orders: { select: { id: true, orderNumber: true, paymentMethod: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let mapped = txns.map((t) => {
      const customerName =
        t.order?.customer?.name || t.checkoutGroup?.customer?.name || 'Customer';
      const orderRef =
        t.order?.orderNumber ||
        t.checkoutGroup?.groupNumber ||
        t.orderId ||
        t.checkoutGroupId ||
        t.id;
      return {
        id: t.id,
        orderId: t.orderId,
        checkoutGroupId: t.checkoutGroupId,
        orderNumber: orderRef,
        paymentId: t.paymentId,
        refundId: t.refundId,
        transactionType: t.transactionType,
        razorpayOrderId: t.razorpayOrderId,
        customerName,
        amount: Math.round((Number(t.amount) || 0) * 100) / 100,
        currency: t.currency,
        status: t.status,
        method: t.method || t.order?.paymentMethod || t.checkoutGroup?.paymentMethod || 'Razorpay',
        failureReason: t.failureReason,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
    });

    if (query.method && query.method !== 'ALL') {
      mapped = mapped.filter((p) =>
        p.method.toLowerCase().includes(query.method!.toLowerCase()),
      );
    }

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      mapped = mapped.filter(
        (p) =>
          p.paymentId.toLowerCase().includes(q) ||
          (p.razorpayOrderId || '').toLowerCase().includes(q) ||
          p.customerName.toLowerCase().includes(q) ||
          String(p.orderNumber).toLowerCase().includes(q),
      );
    }

    const total = mapped.length;
    const paginated = mapped.slice((page - 1) * limit, page * limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getPaymentMetrics() {
    this.ensureDbConnected();
    const payments = await this.prisma.paymentTransaction.findMany();

    const settled = payments.filter(
      (p) => p.status === 'COMPLETED' && p.transactionType === 'CAPTURE',
    );
    const failed = payments.filter((p) => p.status === 'FAILED');
    const refunds = payments.filter((p) => p.transactionType === 'REFUND');
    const rzp = settled.filter((p) => (p.method || 'Razorpay').toLowerCase() !== 'cod');
    const cod = settled.filter((p) => (p.method || '').toLowerCase() === 'cod');

    const settledAmount = settled.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const failedAmount = failed.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const refundedAmount = refunds.reduce((sum, p) => sum + Math.abs(Number(p.amount) || 0), 0);

    return {
      settledToday: Math.round(settledAmount),
      settledOrdersCount: settled.length,
      captureRate:
        payments.length > 0
          ? Number(((settled.length / payments.length) * 100).toFixed(1))
          : 0,
      razorpayOnline: Math.round(
        rzp.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      ),
      razorpayOrdersCount: rzp.length,
      cashOnDelivery: Math.round(
        cod.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      ),
      codOrdersCount: cod.length,
      failedAmount: Math.round(failedAmount),
      failureRate:
        payments.length > 0
          ? Number(((failed.length / payments.length) * 100).toFixed(1))
          : 0,
      failedCount: failed.length,
      refundedAmount: Math.round(refundedAmount),
      refundCount: refunds.length,
    };
  }

  async getPaymentById(id: string) {
    this.ensureDbConnected();
    const payment = await this.prisma.paymentTransaction.findFirst({
      where: { OR: [{ id }, { paymentId: id }, { razorpayOrderId: id }] },
      include: {
        order: true,
        checkoutGroup: true,
      },
    });
    if (!payment) {
      throw new NotFoundException(`Payment transaction '${id}' not found.`);
    }
    return payment;
  }

  async listLedger(query: AdminQueryDto) {
    this.ensureDbConnected();
    const [entries, payouts] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        include: {
          vendor: true,
          order: { select: { id: true, orderNumber: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vendorPayout.findMany({
        include: { vendor: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const byVendor = new Map<
      string,
      {
        id: string;
        vendorId: string;
        vendorName: string;
        commissionRate: number;
        ordersCount: number;
        orderIds: Set<string>;
        grossGmv: number;
        commissionRetained: number;
        netPayable: number;
        status: string;
        latestEntryAt: string;
      }
    >();

    for (const e of entries) {
      const vId = e.vendorId || 'platform';
      let row = byVendor.get(vId);
      if (!row) {
        row = {
          id: vId,
          vendorId: vId,
          vendorName: e.vendor?.storeName || 'Affordz Official Store',
          commissionRate: e.vendor?.commissionRate ?? DEFAULT_COMMISSION_RATE,
          ordersCount: 0,
          orderIds: new Set<string>(),
          grossGmv: 0,
          commissionRetained: 0,
          netPayable: 0,
          status: 'READY_FOR_TRANSFER',
          latestEntryAt: e.createdAt.toISOString(),
        };
        byVendor.set(vId, row);
      }
      if (e.orderId) row.orderIds.add(e.orderId);
      if (e.entryType === 'ORDER_REVENUE') row.grossGmv += Number(e.amount) || 0;
      if (e.entryType === 'COMMISSION_DEDUCTED') {
        row.commissionRetained += Math.abs(Number(e.amount) || 0);
      }
      if (e.entryType === 'VENDOR_PAYOUT') row.netPayable += Number(e.amount) || 0;
    }

    for (const row of byVendor.values()) {
      row.ordersCount = row.orderIds.size;
      const latestPayout = payouts.find((p) => p.vendorId === row.vendorId);
      if (latestPayout) {
        row.status = latestPayout.status;
      }
    }

    let result = Array.from(byVendor.values()).map(({ orderIds, ...rest }) => ({
      ...rest,
      grossGmv: Math.round(rest.grossGmv * 100) / 100,
      commissionRetained: Math.round(rest.commissionRetained * 100) / 100,
      netPayable: Math.round(rest.netPayable * 100) / 100,
    }));

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      result = result.filter(
        (r) =>
          r.vendorName.toLowerCase().includes(q) ||
          r.vendorId.toLowerCase().includes(q),
      );
    }

    if (query.status && query.status !== 'ALL') {
      result = result.filter((r) => r.status === query.status);
    }

    return {
      data: result,
      rawEntries: entries.slice(0, 100),
      total: result.length,
    };
  }

  async getLedgerMetrics() {
    this.ensureDbConnected();
    const entries = await this.prisma.ledgerEntry.findMany();

    const grossMarketplaceVolume = entries
      .filter((e) => e.entryType === 'ORDER_REVENUE')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const platformCommissionEarned = entries
      .filter((e) => e.entryType === 'COMMISSION_DEDUCTED')
      .reduce((sum, e) => sum + Math.abs(Number(e.amount) || 0), 0);
    const netVendorPayoutsDue = entries
      .filter((e) => e.entryType === 'VENDOR_PAYOUT')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const avgTakeRate =
      grossMarketplaceVolume > 0
        ? Number(((platformCommissionEarned / grossMarketplaceVolume) * 100).toFixed(2))
        : DEFAULT_COMMISSION_RATE;

    const activeVendorsCount = new Set(entries.map((e) => e.vendorId).filter(Boolean)).size;

    return {
      grossMarketplaceVolume: Math.round(grossMarketplaceVolume * 100) / 100,
      platformCommissionEarned: Math.round(platformCommissionEarned * 100) / 100,
      averageTakeRate: avgTakeRate,
      netVendorPayoutsDue: Math.round(netVendorPayoutsDue * 100) / 100,
      activeVendorsCount,
      entriesCount: entries.length,
    };
  }

  async updateSettlementStatus(
    id: string,
    dto: UpdateSettlementStatusDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDbConnected();

    const payout = await this.prisma.vendorPayout.findFirst({
      where: { OR: [{ id }, { vendorId: id }] },
      include: { vendor: true },
    });

    if (payout) {
      const updated = await this.prisma.vendorPayout.update({
        where: { id: payout.id },
        data: {
          status: dto.status,
          notes: dto.notes ?? payout.notes,
        },
        include: { vendor: true },
      });

      await this.prisma.auditLog.create({
        data: {
          userId: actorId || null,
          userRole: 'ADMIN',
          action: 'SETTLEMENT_STATUS_UPDATED',
          entityType: 'VendorPayout',
          entityId: updated.id,
          details: JSON.stringify({
            vendorId: updated.vendorId,
            previousStatus: payout.status,
            newStatus: dto.status,
            notes: dto.notes || null,
            actorName: actorName || null,
          }),
        },
      });

      return {
        success: true,
        message: `Ledger settlement status updated to ${dto.status}.`,
        entry: updated,
      };
    }

    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) {
      throw new NotFoundException(`Vendor settlement '${id}' not found.`);
    }

    const payoutAmountAgg = await this.prisma.ledgerEntry.aggregate({
      where: { vendorId: vendor.id, entryType: 'VENDOR_PAYOUT' },
      _sum: { amount: true },
    });

    const createdPayout = await this.prisma.vendorPayout.create({
      data: {
        vendorId: vendor.id,
        amount: Math.max(0, payoutAmountAgg._sum.amount || 0),
        status: dto.status,
        notes: dto.notes || 'Created settlement record',
      },
      include: { vendor: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actorId || null,
        userRole: 'ADMIN',
        action: 'SETTLEMENT_STATUS_UPDATED',
        entityType: 'VendorPayout',
        entityId: createdPayout.id,
        details: JSON.stringify({
          vendorId: vendor.id,
          newStatus: dto.status,
          amount: createdPayout.amount,
          actorName: actorName || null,
        }),
      },
    });

    return {
      success: true,
      message: `Ledger settlement status updated to ${dto.status}.`,
      entry: createdPayout,
    };
  }
}
