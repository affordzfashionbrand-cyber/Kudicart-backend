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

    let rejectedDocTypes: string[] = [];
    if (dto.status === 'REJECTED') {
      if (Array.isArray(dto.rejectedDocuments) && dto.rejectedDocuments.length > 0) {
        rejectedDocTypes = dto.rejectedDocuments.map((d) => {
          if (d === 'docDL' || d === 'licenseNumber') return 'drivingLicence';
          if (d === 'docRC' || d === 'vehicleReg' || d === 'vehicleType' || d === 'vehicleMakeModel') return 'vehicleRc';
          if (d === 'docAadhaar' || d === 'aadhaarNumber') return 'aadhaar';
          if (d === 'docPan' || d === 'panNumber') return 'pan';
          if (d === 'docSelfie') return 'selfie';
          return d;
        });
      } else if (dto.rejectionReason) {
        const reasonLower = dto.rejectionReason.toLowerCase();
        if (reasonLower.includes('driving licence') || reasonLower.includes('licence') || reasonLower.includes('license') || reasonLower.includes('dl')) {
          rejectedDocTypes.push('drivingLicence');
        }
        if (reasonLower.includes('vehicle rc') || reasonLower.includes('registration certificate') || reasonLower.includes('rc document')) {
          rejectedDocTypes.push('vehicleRc');
        }
        if (reasonLower.includes('aadhaar')) {
          rejectedDocTypes.push('aadhaar');
        }
        if (reasonLower.includes('pan')) {
          rejectedDocTypes.push('pan');
        }
        if (reasonLower.includes('selfie') || reasonLower.includes('portrait')) {
          rejectedDocTypes.push('selfie');
        }
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.driverProfile.update({
        where: { id: driver.id },
        data: {
          kycStatus: dto.status,
          rejectionReason:
            dto.status === 'REJECTED' ? dto.rejectionReason!.trim() : null,
          ...(dto.status === 'APPROVED' || dto.status === 'REJECTED'
            ? { approvalAcknowledgedAt: null }
            : {}),
        },
      });

      if (dto.status === 'APPROVED') {
        await tx.driverDocument.updateMany({
          where: { driverId: driver.id },
          data: {
            status: 'VERIFIED',
            rejectionReason: null,
            verifiedAt: new Date(),
          },
        });
      } else if (rejectedDocTypes.length > 0) {
        await tx.driverDocument.updateMany({
          where: {
            driverId: driver.id,
            type: { in: rejectedDocTypes },
          },
          data: {
            status: 'REJECTED',
            rejectionReason: dto.rejectionReason!.trim(),
            verifiedAt: null,
          },
        });

        await tx.driverDocument.updateMany({
          where: {
            driverId: driver.id,
            type: { notIn: rejectedDocTypes },
          },
          data: {
            status: 'VERIFIED',
            rejectionReason: null,
            verifiedAt: new Date(),
          },
        });
      } else {
        await tx.driverDocument.updateMany({
          where: { driverId: driver.id },
          data: {
            status: 'REJECTED',
            rejectionReason: dto.rejectionReason!.trim(),
            verifiedAt: null,
          },
        });
      }
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
