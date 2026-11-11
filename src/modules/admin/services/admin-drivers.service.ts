import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { AdminKycReviewDto } from '../dto/admin-domain.dto';

@Injectable()
export class AdminDriversService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private mapDriver(d: any) {
    return {
      id: d.id,
      userId: d.userId,
      driverCode: d.id.slice(0, 8).toUpperCase(),
      fullName: d.fullName,
      phone: d.phone,
      email: d.user?.email || null,
      kycStatus: d.kycStatus,
      rejectionReason: d.rejectionReason || null,
      isOnline: Boolean(d.isOnline),
      statusText: d.isOnline ? 'Standby' : 'Offline',
      availableSince: d.availableSince ? d.availableSince.toISOString() : null,
      tier: d.tier,
      rating: d.rating,
      completedDeliveries: d.completedDeliveries || 0,
      vehicleType: d.vehicleType || '2W Scooter',
      vehicleMake: d.vehicleMake || null,
      vehicleModel: d.vehicleModel || null,
      vehicleRegistration: d.vehicleRegistration || null,
      currentLat: d.currentLat ?? null,
      currentLng: d.currentLng ?? null,
      documents: d.documents || [],
      createdAt: d.createdAt.toISOString(),
    };
  }

  async listDrivers(query: AdminQueryDto) {
    this.ensureDbConnected();
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;

    const where: any = {};
    if (query.status && query.status !== 'ALL') {
      where.kycStatus = query.status;
    }

    const profiles = await this.prisma.driverProfile.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, status: true } },
        documents: true,
      },
      orderBy: [{ isOnline: 'desc' }, { createdAt: 'desc' }],
    });

    let mapped = profiles.map((d) => this.mapDriver(d));

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      mapped = mapped.filter(
        (d) =>
          d.fullName.toLowerCase().includes(q) ||
          d.phone.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q) ||
          (d.vehicleRegistration || '').toLowerCase().includes(q),
      );
    }

    if (query.vehicleType && query.vehicleType !== 'ALL') {
      mapped = mapped.filter((d) =>
        (d.vehicleType || '').toLowerCase().includes(query.vehicleType!.toLowerCase()),
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

  async getDriverById(id: string) {
    this.ensureDbConnected();
    const cleanId = id.trim();
    const profile = await this.prisma.driverProfile.findFirst({
      where: {
        OR: [{ id: cleanId }, { userId: cleanId }],
      },
      include: {
        user: { select: { id: true, email: true, status: true } },
        documents: true,
      },
    });

    if (!profile) {
      throw new NotFoundException(`Delivery partner '${id}' not found.`);
    }

    const auditTrail = await this.prisma.auditLog.findMany({
      where: { entityType: 'DriverProfile', entityId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    return {
      ...this.mapDriver(profile),
      auditTrail,
    };
  }

  async reviewKyc(
    id: string,
    dto: AdminKycReviewDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDbConnected();
    const profile = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id }, { userId: id }] },
    });

    if (!profile) {
      throw new NotFoundException(`Delivery partner '${id}' not found.`);
    }

    if (dto.status === 'REJECTED' && !dto.rejectionReason?.trim()) {
      throw new BadRequestException('A rejection reason must be provided when rejecting KYC.');
    }

    const previousStatus = profile.kycStatus;
    const docStatus = dto.status === 'APPROVED' ? 'VERIFIED' : 'REJECTED';

    await this.prisma.$transaction(async (tx) => {
      await tx.driverProfile.update({
        where: { id: profile.id },
        data: {
          kycStatus: dto.status,
          rejectionReason: dto.status === 'REJECTED' ? dto.rejectionReason!.trim() : null,
        },
      });

      await tx.driverDocument.updateMany({
        where: { driverId: profile.id },
        data: {
          status: docStatus,
          rejectionReason: dto.status === 'REJECTED' ? dto.rejectionReason!.trim() : null,
          verifiedAt: dto.status === 'APPROVED' ? new Date() : null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId || null,
          userRole: 'ADMIN',
          action: dto.status === 'APPROVED' ? 'DRIVER_KYC_APPROVED' : 'DRIVER_KYC_REJECTED',
          entityType: 'DriverProfile',
          entityId: profile.id,
          details: JSON.stringify({
            driverId: profile.id,
            fullName: profile.fullName,
            previousStatus,
            newStatus: dto.status,
            rejectionReason: dto.rejectionReason || null,
            actorName: actorName || 'Operations Admin',
          }),
        },
      });
    });

    return {
      success: true,
      message: `Delivery partner KYC marked as ${dto.status}.`,
      driverId: profile.id,
      kycStatus: dto.status,
      rejectionReason: dto.status === 'REJECTED' ? dto.rejectionReason!.trim() : null,
    };
  }

  async toggleAvailability(id: string, actorId?: string, actorName?: string) {
    this.ensureDbConnected();
    const profile = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id }, { userId: id }] },
    });

    if (!profile) {
      throw new NotFoundException(`Delivery partner '${id}' not found.`);
    }

    const nextOnline = !profile.isOnline;
    const updated = await this.prisma.driverProfile.update({
      where: { id: profile.id },
      data: {
        isOnline: nextOnline,
        availableSince: nextOnline ? new Date() : null,
      },
      include: {
        user: { select: { id: true, email: true, status: true } },
        documents: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actorId || null,
        userRole: 'ADMIN',
        action: 'DRIVER_AVAILABILITY_TOGGLED',
        entityType: 'DriverProfile',
        entityId: profile.id,
        details: JSON.stringify({
          isOnline: nextOnline,
          actorName: actorName || 'Operations Admin',
        }),
      },
    });

    return {
      success: true,
      message: `Delivery partner ${updated.fullName} is now ${nextOnline ? 'standby' : 'offline'}.`,
      driver: this.mapDriver(updated),
    };
  }
}
