import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { KycReviewDto } from './dto/kyc-review.dto';

@Controller('api/v1/admin/drivers')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class DriverAdminController {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  @Get()
  async listDrivers() {
    this.ensureDbConnected();
    const drivers = await this.prisma.driverProfile.findMany({
      include: {
        user: { select: { id: true, email: true, status: true } },
        documents: true,
      },
      orderBy: [{ isOnline: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      drivers: drivers.map((d) => ({
        id: d.id,
        userId: d.userId,
        fullName: d.fullName,
        phone: d.phone,
        kycStatus: d.kycStatus,
        isOnline: d.isOnline,
        tier: d.tier,
        rating: d.rating,
        completedDeliveries: d.completedDeliveries,
        vehicleRegistration: d.vehicleRegistration,
        documentsCount: d.documents.length,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  @Get(':id')
  async getDriverDetails(@Param('id') id: string) {
    this.ensureDbConnected();
    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id }, { userId: id }] },
      include: {
        user: { select: { id: true, email: true, status: true } },
        documents: true,
      },
    });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }
    return {
      ...driver,
      aadhaarNumber: driver.aadhaarNumber
        ? `XXXX-XXXX-${driver.aadhaarNumber.slice(-4)}`
        : null,
    };
  }

  @Patch(':id/kyc')
  async reviewKyc(@Param('id') id: string, @Body() dto: KycReviewDto) {
    this.ensureDbConnected();
    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id }, { userId: id }] },
    });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    if (dto.status === 'REJECTED' && !dto.rejectionReason?.trim()) {
      throw new BadRequestException('A rejection reason must be provided when rejecting KYC');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.driverProfile.update({
        where: { id: driver.id },
        data: {
          kycStatus: dto.status,
          rejectionReason:
            dto.status === 'REJECTED' ? dto.rejectionReason!.trim() : null,
        },
      });
      await tx.driverDocument.updateMany({
        where: { driverId: driver.id },
        data: {
          status: dto.status === 'APPROVED' ? 'VERIFIED' : 'REJECTED',
          verifiedAt: dto.status === 'APPROVED' ? new Date() : null,
        },
      });
      return res;
    });

    return {
      success: true,
      message: `Driver KYC status updated to ${dto.status}`,
      driverId: updated.id,
      kycStatus: updated.kycStatus,
      rejectionReason: updated.rejectionReason,
    };
  }
}
