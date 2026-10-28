import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { AdminKycReviewDto } from '../dto/admin-domain.dto';

@Injectable()
export class AdminDriversService {
  constructor(private prisma: PrismaService) {}

  async listDrivers(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let drivers = store.adminDrivers || [];

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      drivers = drivers.filter(
        (d: any) =>
          d.fullName.toLowerCase().includes(q) ||
          d.driverCode.toLowerCase().includes(q) ||
          d.phone.includes(q) ||
          d.vehicleRegistration.toLowerCase().includes(q) ||
          d.vehicleModel.toLowerCase().includes(q),
      );
    }

    if (query.status && query.status !== 'ALL') {
      drivers = drivers.filter((d: any) => d.kycStatus === query.status);
    }

    if (query.vehicleType && query.vehicleType !== 'ALL') {
      if (query.vehicleType === 'TWO_WHEELER') {
        drivers = drivers.filter(
          (d: any) =>
            d.vehicleType === 'Two-Wheeler' ||
            d.vehicleType.toLowerCase().includes('bike') ||
            d.vehicleType.toLowerCase().includes('scooty'),
        );
      } else if (query.vehicleType === 'EV') {
        drivers = drivers.filter(
          (d: any) =>
            d.vehicleType === 'EV / Electric' ||
            d.vehicleType.toLowerCase().includes('ev') ||
            d.vehicleModel.toLowerCase().includes('ather'),
        );
      }
    }

    const total = drivers.length;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const paginated = drivers.slice(startIndex, startIndex + limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getDriverById(id: string) {
    const store = this.prisma.getStore();
    const cleanId = id.trim().replace(/^#/, '');

    const driver = (store.adminDrivers || []).find(
      (d: any) =>
        d.id === cleanId ||
        d.driverCode.replace(/^#/, '') === cleanId ||
        d.id === `drv-${cleanId}`,
    );

    if (!driver) {
      throw new NotFoundException(`Delivery partner record '${id}' was not found.`);
    }

    return driver;
  }

  async reviewKyc(
    id: string,
    dto: AdminKycReviewDto,
    actorId?: string,
    actorName?: string,
  ) {
    const driver = await this.getDriverById(id);
    const previousStatus = driver.kycStatus;

    if (dto.status === 'REJECTED' && (!dto.rejectionReason || !dto.rejectionReason.trim())) {
      throw new BadRequestException('Rejection reason is required when rejecting partner KYC.');
    }

    driver.kycStatus = dto.status;
    driver.rejectionReason = dto.status === 'REJECTED' ? dto.rejectionReason : null;
    driver.assignedReviewer = actorName || 'Operations Admin';

    // Update document statuses
    if (driver.documents) {
      Object.keys(driver.documents).forEach((key) => {
        const doc = driver.documents[key];
        if (doc) {
          doc.status = dto.status === 'APPROVED' ? 'VERIFIED' : 'REJECTED';
          doc.statusLabel = dto.status === 'APPROVED' ? 'Verified' : 'Rejected';
          if (doc.front) doc.front.status = dto.status === 'APPROVED' ? 'VERIFIED' : 'REJECTED';
          if (doc.back) doc.back.status = dto.status === 'APPROVED' ? 'VERIFIED' : 'REJECTED';
        }
      });
    }

    // Add to partner audit trail
    const now = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dateStr = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}, ${timeStr} IST`;

    if (!driver.auditTrail) driver.auditTrail = [];
    driver.auditTrail.unshift({
      id: `at-${Date.now()}`,
      timestamp: dateStr,
      title: dto.status === 'APPROVED' ? 'KYC Dossier Approved' : 'KYC Dossier Rejected',
      description:
        dto.status === 'APPROVED'
          ? `All identity and vehicle documents verified by ${actorName || 'Operations Admin'}.`
          : `Application rejected: ${dto.rejectionReason}`,
      type: dto.status === 'APPROVED' ? 'success' : 'neutral',
    });

    // Record central audit event
    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: dto.status === 'APPROVED' ? ('DRIVER_KYC_APPROVED' as any) : ('DRIVER_KYC_REJECTED' as any),
      entityId: driver.id,
      entityName: driver.fullName,
      entityType: 'Driver' as any,
      summary: `${dto.status === 'APPROVED' ? 'Approved' : 'Rejected'} delivery fleet KYC dossier for ${driver.fullName} (${driver.driverCode})`,
      targetDescription: `Delivery Partner Dossier #${driver.driverCode}`,
      changePayload: {
        driverId: driver.id,
        previousStatus,
        newStatus: dto.status,
        rejectionReason: driver.rejectionReason,
      },
      entityLink: `/admin/delivery-partners/${driver.id}`,
    });

    return {
      success: true,
      message: `Delivery partner KYC marked as ${dto.status}.`,
      driverId: driver.id,
      kycStatus: driver.kycStatus,
      rejectionReason: driver.rejectionReason,
    };
  }

  async toggleAvailability(id: string, actorId?: string, actorName?: string) {
    const driver = await this.getDriverById(id);
    driver.isOnline = !driver.isOnline;
    driver.statusText = driver.isOnline ? 'Standby' : 'Offline';

    return {
      success: true,
      message: `Delivery partner ${driver.fullName} is now ${driver.statusText.toLowerCase()}.`,
      driver,
    };
  }
}

