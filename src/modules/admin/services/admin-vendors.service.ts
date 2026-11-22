import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { VendorReviewActionDto } from '../dto/admin-actions.dto';
import { OnboardVendorDto } from '../dto/onboard-vendor.dto';
import { EmailService } from '../../notifications/email.service';
import { FirebaseAdminService } from '../../auth/firebase-admin.service';
import { hashPassword } from '../../../common/utils/crypto.util';
import { Role } from '../../../common/enums/role.enum';

@Injectable()
export class AdminVendorsService {
  private readonly logger = new Logger(AdminVendorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    @Optional() private readonly firebaseAdmin?: FirebaseAdminService,
  ) {}

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
      legalEntityName: dossier?.legalEntityName || v.storeName,
      ownerName: v.contactPerson || dossier?.ownerName || v.user?.name || '',
      ownerRole: dossier?.ownerRole || 'Store Owner',
      email: v.user?.email || dossier?.email || '',
      phone: v.phone || v.user?.phone || '',
      registeredAddress: v.address || dossier?.registeredAddress || '',
      operatingHub: v.operatingHub || 'Bandra West Node',
      category: v.category || 'Women Ethnic',
      status: v.status,
      gstin: dossier?.gstin || 'N/A',
      pan: dossier?.pan || 'N/A',
      commissionRate: v.commissionRate ?? null,
      isOnline: v.isOnline ?? true,
      autoScheduleEnabled: v.autoScheduleEnabled ?? false,
      operatingHours: v.operatingHours ?? null,
      bankDetails: v.bankDetails || dossier?.bankDetails || null,
      categoryCommissions: Array.isArray(v.categoryCommissions)
        ? v.categoryCommissions.map((cc: any) => ({
            id: cc.id,
            categoryId: cc.categoryId,
            categoryName: cc.category?.name || cc.categoryId,
            commissionRate: cc.commissionRate,
          }))
        : [],
      rejectionReason: v.rejectionReason || null,
      productCount: v.products?.length ?? v._count?.products ?? dossier?.productCount ?? 0,
      activeOrderCount: dossier?.activeOrderCount ?? 0,
      submissionDate: dossier?.submissionDate || (v.createdAt ? v.createdAt.toISOString().split('T')[0] : 'N/A'),
      documents: Array.isArray(dossier?.documents) ? dossier.documents : [],
      draftProducts: Array.isArray(dossier?.draftProducts) ? dossier.draftProducts : [],
      assignedReviewer: dossier?.assignedReviewer ?? null,
      targetFulfillment: dossier?.targetFulfillment || 'Hub Standard',
      onboardingDate: dossier?.onboardingDate || v.createdAt.toISOString(),
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }

  async onboardVendor(
    dto: OnboardVendorDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDb();

    const normalizedEmail = dto.email.toLowerCase().trim();
    const cleanPhone = dto.phone.trim();

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { phone: cleanPhone }],
      },
    });

    if (existingUser) {
      if (existingUser.email === normalizedEmail) {
        throw new BadRequestException(`A user account with email "${dto.email}" already exists.`);
      }
      throw new BadRequestException(`A user account with phone "${dto.phone}" already exists.`);
    }

    // Password: use provided initial password if valid, else generate secure temporary password
    const tempPassword =
      dto.password && dto.password.trim().length >= 6
        ? dto.password.trim()
        : `Kudi@${crypto.randomBytes(4).toString('hex')}!`;

    let firebaseUid: string | null = null;
    if (this.firebaseAdmin) {
      const existingUid =
        typeof this.firebaseAdmin.getUserByEmail === 'function'
          ? await this.firebaseAdmin.getUserByEmail(normalizedEmail)
          : null;
      if (existingUid) {
        // Link existing Firebase account and configure as VENDOR with the password
        if (typeof this.firebaseAdmin.setUserClaims === 'function') {
          await this.firebaseAdmin.setUserClaims(existingUid, { role: 'VENDOR' });
        }
        if (typeof this.firebaseAdmin.setUserPassword === 'function') {
          await this.firebaseAdmin.setUserPassword(existingUid, tempPassword);
        }
        firebaseUid = existingUid;
        this.logger.log(`Linked existing Firebase user ${existingUid} (${normalizedEmail}) as VENDOR`);
      } else {
        const cleanNoSpaces = cleanPhone.replace(/\s+/g, '');
        const formattedPhone = cleanNoSpaces.startsWith('+')
          ? cleanNoSpaces
          : `+91${cleanPhone.replace(/\D/g, '').slice(-10)}`;
        try {
          const fbUser = await this.firebaseAdmin.createAuthUser({
            email: normalizedEmail,
            password: tempPassword,
            displayName: dto.ownerName,
            phoneNumber:
              formattedPhone.startsWith('+') && formattedPhone.length >= 12
                ? formattedPhone
                : undefined,
          });
          firebaseUid = fbUser.uid;
        } catch (fbErr: any) {
          throw new BadRequestException(
            fbErr?.message || 'Failed to create Firebase authentication account for vendor.',
          );
        }
      }
    } else {
      throw new ServiceUnavailableException('Firebase Admin Service is not initialized.');
    }

    const { vendor } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: dto.ownerName,
          email: normalizedEmail,
          phone: cleanPhone,
          role: 'VENDOR',
          firebaseUid,
          status: 'ACTIVE',
        },
      });

      const vendorRow = await tx.vendor.create({
        data: {
          user: { connect: { id: user.id } },
          storeName: dto.storeName.trim(),
          contactPerson: dto.ownerName.trim(),
          phone: cleanPhone,
          address: dto.address.trim(),
          operatingHub: dto.operatingHub || 'Bandra West Node',
          category: dto.category || 'Women Ethnic',
          status: 'ACTIVE',
          isOnline: true,
          bankDetails: dto.bankDetails ? (dto.bankDetails as any) : undefined,
          notificationEmail: normalizedEmail,
        },
      });

      if (dto.categoryCommissions && dto.categoryCommissions.length > 0) {
        await tx.vendorCategoryCommission.createMany({
          data: dto.categoryCommissions.map((cc) => ({
            vendorId: vendorRow.id,
            categoryId: cc.categoryId,
            commission: Number(cc.commissionRate),
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actorId || 'ADMIN',
          userEmail: actorName || 'Operations Admin',
          userRole: 'ADMIN',
          action: 'VENDOR_ONBOARDED',
          entityType: 'Vendor',
          entityId: vendorRow.id,
          details: JSON.stringify({
            storeName: vendorRow.storeName,
            ownerName: dto.ownerName,
            email: normalizedEmail,
            commissionsConfigured: dto.categoryCommissions?.length || 0,
          }),
        },
      });

      return { vendor: vendorRow };
    });

    const loginUrl = process.env.VENDOR_PORTAL_URL || 'http://localhost:3000/login';
    await this.emailService.sendVendorWelcomeEmail({
      to: normalizedEmail,
      storeName: dto.storeName,
      ownerName: dto.ownerName,
      tempPassword,
      loginUrl,
    });

    const fullVendor = await this.prisma.vendor.findUnique({
      where: { id: vendor.id },
      include: {
        user: true,
        categoryCommissions: { include: { category: true } },
        _count: { select: { products: true } },
      },
    });

    const formatted = this.formatVendor(fullVendor);

    return {
      success: true,
      message: `Vendor boutique "${dto.storeName}" has been successfully onboarded. Credentials dispatched to ${normalizedEmail}.`,
      vendor: formatted,
      credentials: {
        email: normalizedEmail,
        temporaryPassword: tempPassword,
        loginUrl,
      },
    };
  }

  async listVendors(query: AdminQueryDto) {
    this.ensureDb();

    const [dbVendors, dossiers] = await Promise.all([
      this.prisma.vendor.findMany({
        where: {
          id: { not: 'vend-affordz-official' },
        },
        include: {
          user: true,
          categoryCommissions: { include: { category: true } },
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
        categoryCommissions: { include: { category: true } },
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

  async deleteVendor(id: string, actorId?: string, actorName?: string) {
    this.ensureDb();
    const { vendor } = await this.findVendorOrFail(id);

    if (vendor.id === 'vend-affordz-official') {
      throw new BadRequestException('Cannot delete the primary official dark store.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Reassign any remaining products to the official store to protect catalog references
      await tx.product.updateMany({
        where: { vendorId: vendor.id },
        data: { vendorId: 'vend-affordz-official' },
      });

      // Delete associated commissions
      await tx.vendorCategoryCommission.deleteMany({
        where: { vendorId: vendor.id },
      });

      // Delete ledger entries and payouts if any
      await tx.ledgerEntry.deleteMany({
        where: { vendorId: vendor.id },
      });
      await tx.vendorPayout.deleteMany({
        where: { vendorId: vendor.id },
      });

      // Delete the vendor record
      await tx.vendor.delete({
        where: { id: vendor.id },
      });

      // Delete associated user if role is VENDOR
      await tx.user.deleteMany({
        where: { id: vendor.userId, role: Role.VENDOR },
      });

      // Clean from vendorDossiers in workspaceSettings
      const dossiers = await this.getVendorDossiers();
      if (dossiers[vendor.id]) {
        delete dossiers[vendor.id];
        await tx.workspaceSetting.upsert({
          where: { key: 'vendorDossiers' },
          update: { value: dossiers },
          create: { key: 'vendorDossiers', value: dossiers },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actorId || 'ADMIN',
          userEmail: actorName || null,
          userRole: 'ADMIN',
          action: 'VENDOR_DELETED',
          entityType: 'Vendor',
          entityId: vendor.id,
          details: JSON.stringify({
            storeName: vendor.storeName,
            deletedBy: actorName || actorId || 'ADMIN',
          }),
        },
      });
    });

    return {
      success: true,
      message: `Vendor boutique "${vendor.storeName}" has been successfully removed.`,
    };
  }

  async resetVendorPassword(id: string, newPassword: string, actorId?: string, actorName?: string) {
    this.ensureDb();
    if (!newPassword || newPassword.trim().length < 6) {
      throw new BadRequestException('Password must be at least 6 characters long.');
    }
    const { vendor } = await this.findVendorOrFail(id);
    if (!vendor.user || !vendor.user.firebaseUid) {
      throw new BadRequestException('No Firebase account linked to this vendor user.');
    }
    if (this.firebaseAdmin) {
      await this.firebaseAdmin.setUserPassword(vendor.user.firebaseUid, newPassword.trim());
      await this.firebaseAdmin.setUserClaims(vendor.user.firebaseUid, { role: 'VENDOR' });
    }

    await this.prisma.auditLog.create({
      data: {
        userId: actorId || 'ADMIN',
        userEmail: actorName || 'Operations Admin',
        userRole: 'ADMIN',
        action: 'VENDOR_PASSWORD_RESET',
        entityType: 'Vendor',
        entityId: vendor.id,
        details: JSON.stringify({
          storeName: vendor.storeName,
          email: vendor.user.email,
        }),
      },
    });

    return {
      success: true,
      message: `Password for vendor "${vendor.storeName}" has been successfully updated.`,
    };
  }
}

