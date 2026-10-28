import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { VendorReviewActionDto } from '../dto/admin-actions.dto';

@Injectable()
export class AdminVendorsService {
  constructor(private prisma: PrismaService) {}

  async listVendors(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let vendors = store.adminVendors || [];

    // Filter by search
    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      vendors = vendors.filter(
        (v: any) =>
          v.storeName.toLowerCase().includes(q) ||
          v.ownerName.toLowerCase().includes(q) ||
          v.email.toLowerCase().includes(q) ||
          v.vendorNumber.toLowerCase().includes(q) ||
          v.id.toLowerCase().includes(q),
      );
    }

    // Filter by status
    if (query.status && query.status !== 'ALL') {
      if (query.status === 'PENDING') {
        vendors = vendors.filter(
          (v: any) =>
            v.status === 'PENDING_REVIEW' ||
            v.status === 'DOCS_SUBMITTED' ||
            v.status === 'KYC_PENDING',
        );
      } else {
        vendors = vendors.filter((v: any) => v.status === query.status);
      }
    }

    // Filter by category
    if (query.category && query.category !== 'ALL') {
      vendors = vendors.filter((v: any) => v.category === query.category);
    }

    const total = vendors.length;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
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

  async getVendorById(id: string) {
    const store = this.prisma.getStore();
    const cleanId = id.trim().replace(/^#/, '');

    const vendor = (store.adminVendors || []).find(
      (v: any) =>
        v.id === cleanId ||
        v.vendorNumber.replace(/^#/, '') === cleanId ||
        v.id === `ven_${cleanId}`,
    );

    if (!vendor) {
      throw new NotFoundException(`Vendor boutique record "${id}" was not found.`);
    }

    return vendor;
  }

  async approveVendor(id: string, dto: VendorReviewActionDto, actorId?: string, actorName?: string) {
    const vendor = await this.getVendorById(id);
    const previousStatus = vendor.status;
    vendor.status = 'ACTIVE';
    vendor.assignedReviewer = dto.reviewer || actorName || 'Operations Admin';

    // Verify all submitted documents
    if (vendor.documents && Array.isArray(vendor.documents)) {
      vendor.documents.forEach((d: any) => {
        d.verified = true;
      });
    }

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'VENDOR_APPROVED' as any,
      entityId: vendor.id,
      entityName: vendor.storeName,
      entityType: 'Vendor' as any,
      summary: `Approved merchant boutique onboarding application for ${vendor.storeName}`,
      targetDescription: `Vendor Dossier #${vendor.vendorNumber}`,
      changePayload: {
        previousStatus,
        newStatus: 'ACTIVE',
        reviewer: vendor.assignedReviewer,
      },
      entityLink: `/admin/vendors/${vendor.id}`,
    });

    return {
      success: true,
      message: `Vendor boutique ${vendor.storeName} has been approved and activated.`,
      vendor,
    };
  }

  async rejectVendor(id: string, dto: VendorReviewActionDto, actorId?: string, actorName?: string) {
    const vendor = await this.getVendorById(id);
    const previousStatus = vendor.status;
    vendor.status = 'REJECTED';
    vendor.assignedReviewer = dto.reviewer || actorName || 'Operations Admin';

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'VENDOR_REJECTED' as any,
      entityId: vendor.id,
      entityName: vendor.storeName,
      entityType: 'Vendor' as any,
      summary: `Rejected merchant boutique onboarding application for ${vendor.storeName}: ${dto.reason || 'Compliance criteria unmet'}`,
      targetDescription: `Vendor Dossier #${vendor.vendorNumber}`,
      changePayload: {
        previousStatus,
        newStatus: 'REJECTED',
        reason: dto.reason || 'Compliance criteria unmet',
      },
      entityLink: `/admin/vendors/${vendor.id}`,
    });

    return {
      success: true,
      message: `Vendor boutique ${vendor.storeName} application has been rejected.`,
      vendor,
    };
  }

  async toggleSuspendVendor(id: string, actorId?: string, actorName?: string) {
    const vendor = await this.getVendorById(id);
    const previousStatus = vendor.status;
    const newStatus = previousStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    vendor.status = newStatus;

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: newStatus === 'SUSPENDED' ? ('VENDOR_SUSPENDED' as any) : ('VENDOR_APPROVED' as any),
      entityId: vendor.id,
      entityName: vendor.storeName,
      entityType: 'Vendor' as any,
      summary: `Vendor boutique ${vendor.storeName} status toggled: ${previousStatus} -> ${newStatus}`,
      targetDescription: `Vendor Boutique #${vendor.vendorNumber}`,
      changePayload: {
        previousStatus,
        newStatus,
      },
      entityLink: `/admin/vendors/${vendor.id}`,
    });

    return {
      success: true,
      message: `Vendor boutique ${vendor.storeName} is now ${newStatus.toLowerCase()}.`,
      vendor,
    };
  }
}

