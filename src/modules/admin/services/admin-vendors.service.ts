import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { VendorReviewActionDto } from '../dto/admin-actions.dto';

@Injectable()
export class AdminVendorsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDb() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }
  }

  private async getVendorDossiers(): Promise<Record<string, any>> {
    const row = await this.prisma.workspaceSetting.findUnique({
      where: { key: 'vendorDossiers' },
    });
    return row?.value && typeof row.value === 'object'
      ? { ...(row.value as Record<string, any>) }
      : {};
  }

  private async saveVendorDossiers(dossiers: Record<string, any>) {
    await this.prisma.workspaceSetting.upsert({
      where: { key: 'vendorDossiers' },
      update: { value: dossiers },
      create: { key: 'vendorDossiers', value: dossiers },
    });
  }

  private formatVendor(v: any, dossier: any = {}) {
    return {
      id: v.id,
      vendorNumber: dossier?.vendorNumber || `#${v.id.toUpperCase()}`,
      storeName: v.storeName,
      ownerName: v.contactPerson || dossier?.ownerName || v.user?.name || '',
      email: dossier?.email || v.user?.email || '',
      phone: v.phone || v.user?.phone || '',
      registeredAddress: v.address || dossier?.registeredAddress || '',
      operatingHub: v.operatingHub || 'Affordz Official Dark Store',
      category: v.category || 'Women Ethnic',
      status: v.status,
      commissionRate: v.commissionRate,
      rejectionReason: v.rejectionReason || null,
      productCount: v.products?.length ?? v._count?.products ?? dossier?.productCount ?? 0,
      documents: Array.isArray(dossier?.documents) ? dossier.documents : [],
      bankDetails: dossier?.bankDetails ?? null,
      assignedReviewer: dossier?.assignedReviewer ?? null,
      onboardingDate: dossier?.onboardingDate || v.createdAt.toISOString(),
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }

  async listVendors(query: AdminQueryDto) {
    this.ensureDb();

    const [dbVendors, dossiers] = await Promise.all([
      this.prisma.vendor.findMany({
        include: {
          user: true,
          _count: { select: { products: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.getVendorDossiers(),
    ]);

    let vendors = dbVendors.map((v) => this.formatVendor(v, dossiers[v.id]));

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      vendors = vendors.filter(
        (v) =>
          v.storeName.toLowerCase().includes(q) ||
          v.ownerName.toLowerCase().includes(q) ||
          v.email.toLowerCase().includes(q) ||
          v.vendorNumber.toLowerCase().includes(q) ||
          v.id.toLowerCase().includes(q),
      );
    }

    if (query.status && query.status !== 'ALL') {
      if (query.status === 'PENDING') {
        vendors = vendors.filter(
          (v) =>
            v.status === 'PENDING_REVIEW' ||
            v.status === 'DOCS_SUBMITTED' ||
            v.status === 'KYC_PENDING',
        );
      } else {
        vendors = vendors.filter((v) => v.status === query.status);
      }
    }

    if (query.category && query.category !== 'ALL') {
      vendors = vendors.filter((v) => v.category === query.category);
    }

    const total = vendors.length;
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
    const startIndex = (page - 1) * limit;
    const paginated = vendors.slice(startIndex, startIndex + limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  private async findVendorOrFail(id: string) {
    this.ensureDb();
    const cleanId = id.trim().replace(/^#/, '');
    const dossiers = await this.getVendorDossiers();

    const dossierMatchId = Object.entries(dossiers).find(
      ([, d]) => d?.vendorNumber?.replace(/^#/, '') === cleanId,
    )?.[0];

    const vendor = await this.prisma.vendor.findFirst({
      where: {
        OR: [
          { id: id.trim() },
          { id: cleanId },
          { id: `ven_${cleanId}` },
          ...(dossierMatchId ? [{ id: dossierMatchId }] : []),
        ],
      },
      include: {
        user: true,
        _count: { select: { products: true } },
      },
    });

    if (!vendor) {
      throw new NotFoundException(`Vendor boutique record "${id}" was not found.`);
    }

    return { vendor, dossiers, dossier: dossiers[vendor.id] || {} };
  }

  async getVendorById(id: string) {
    const { vendor, dossier } = await this.findVendorOrFail(id);
    return this.formatVendor(vendor, dossier);
  }

  async approveVendor(
    id: string,
    dto: VendorReviewActionDto,
    actorId?: string,
    actorName?: string,
  ) {
    const { vendor, dossiers, dossier } = await this.findVendorOrFail(id);
    const previousStatus = vendor.status;
    const assignedReviewer = dto.reviewer || actorName || 'Operations Admin';

    const updatedDocs = Array.isArray(dossier.documents)
      ? dossier.documents.map((d: any) => ({ ...d, verified: true }))
      : [];

    const updatedDossier = {
      ...dossier,
      assignedReviewer,
      documents: updatedDocs,
    };
    dossiers[vendor.id] = updatedDossier;

    const updatedVendor = await this.prisma.$transaction(async (tx) => {
      const row = await tx.vendor.update({
        where: { id: vendor.id },
        data: { status: 'ACTIVE', rejectionReason: null },
        include: { user: true, _count: { select: { products: true } } },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId || 'ADMIN',
          userEmail: actorName || null,
          userRole: 'ADMIN',
          action: 'VENDOR_APPROVED',
          entityType: 'Vendor',
          entityId: vendor.id,
          details: JSON.stringify({
            storeName: vendor.storeName,
            previousStatus,
            newStatus: 'ACTIVE',
            reviewer: assignedReviewer,
          }),
        },
      });

      return row;
    });

    await this.saveVendorDossiers(dossiers);
    const formatted = this.formatVendor(updatedVendor, updatedDossier);

    return {
      success: true,
      message: `Vendor boutique ${formatted.storeName} has been approved and activated.`,
      vendor: formatted,
    };
  }

  async rejectVendor(
    id: string,
    dto: VendorReviewActionDto,
    actorId?: string,
    actorName?: string,
  ) {
    const { vendor, dossiers, dossier } = await this.findVendorOrFail(id);
    const previousStatus = vendor.status;
    const assignedReviewer = dto.reviewer || actorName || 'Operations Admin';
    const rejectionReason = dto.reason || 'Compliance criteria unmet';

    const updatedDossier = { ...dossier, assignedReviewer };
    dossiers[vendor.id] = updatedDossier;

    const updatedVendor = await this.prisma.$transaction(async (tx) => {
      const row = await tx.vendor.update({
        where: { id: vendor.id },
        data: { status: 'REJECTED', rejectionReason },
        include: { user: true, _count: { select: { products: true } } },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId || 'ADMIN',
          userEmail: actorName || null,
          userRole: 'ADMIN',
          action: 'VENDOR_REJECTED',
          entityType: 'Vendor',
          entityId: vendor.id,
          details: JSON.stringify({
            storeName: vendor.storeName,
            previousStatus,
            newStatus: 'REJECTED',
            reason: rejectionReason,
          }),
        },
      });

      return row;
    });

    await this.saveVendorDossiers(dossiers);
    const formatted = this.formatVendor(updatedVendor, updatedDossier);

    return {
      success: true,
      message: `Vendor boutique ${formatted.storeName} application has been rejected.`,
      vendor: formatted,
    };
  }

  async toggleSuspendVendor(id: string, actorId?: string, actorName?: string) {
    const { vendor, dossier } = await this.findVendorOrFail(id);
    const previousStatus = vendor.status;
    const newStatus = previousStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';

    const updatedVendor = await this.prisma.$transaction(async (tx) => {
      const row = await tx.vendor.update({
        where: { id: vendor.id },
        data: { status: newStatus },
        include: { user: true, _count: { select: { products: true } } },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId || 'ADMIN',
          userEmail: actorName || null,
          userRole: 'ADMIN',
          action: newStatus === 'SUSPENDED' ? 'VENDOR_SUSPENDED' : 'VENDOR_APPROVED',
          entityType: 'Vendor',
          entityId: vendor.id,
          details: JSON.stringify({
            storeName: vendor.storeName,
            previousStatus,
            newStatus,
          }),
        },
      });

      return row;
    });

    const formatted = this.formatVendor(updatedVendor, dossier);

    return {
      success: true,
      message: `Vendor boutique ${formatted.storeName} is now ${newStatus.toLowerCase()}.`,
      vendor: formatted,
    };
  }
}

