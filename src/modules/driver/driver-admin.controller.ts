import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KycReviewDto } from './dto/kyc-review.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('api/v1/admin/drivers')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class DriverAdminController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async listDrivers() {
    const store = this.prisma.getStore();
    return {
      success: true,
      count: store.drivers.length,
      drivers: store.drivers.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        phone: d.phone,
        kycStatus: d.kycStatus,
        isOnline: d.isOnline,
        completedDeliveries: d.completedDeliveries,
        vehicle: d.vehicle,
      })),
    };
  }

  @Get(':id')
  async getDriverDetails(@Param('id') id: string) {
    const store = this.prisma.getStore();
    const driver = store.drivers.find((d) => d.id === id || d.userId === id);
    if (!driver) {
      throw new NotFoundException(`Driver with ID ${id} not found`);
    }
    return {
      success: true,
      driver,
    };
  }

  @Post(':id/kyc/review')
  @HttpCode(HttpStatus.OK)
  async reviewKyc(@Param('id') id: string, @Body() dto: KycReviewDto) {
    const store = this.prisma.getStore();
    const driver = store.drivers.find((d) => d.id === id || d.userId === id);
    if (!driver) {
      throw new NotFoundException(`Driver with ID ${id} not found`);
    }

    driver.kycStatus = dto.status;
    if (dto.status === 'APPROVED') {
      driver.rejectionReason = null;
      driver.status = 'Active';
      // Mark all uploaded documents as verified
      if (driver.documents) {
        Object.keys(driver.documents).forEach((key) => {
          if (key !== 'selfie' && (driver.documents as any)[key]) {
            (driver.documents as any)[key].status = 'VERIFIED';
          }
        });
      }
    } else {
      driver.rejectionReason = dto.rejectionReason || 'Document verification failed. Please check details and resubmit.';
      driver.status = 'Needs Attention';
      if (driver.documents?.drivingLicence) {
        driver.documents.drivingLicence.status = 'REJECTED';
      }
    }

    // Add administrative notification for the driver
    store.notifications.unshift({
      id: `notif-${Date.now()}`,
      driverId: driver.id,
      category: 'SYSTEM',
      title: dto.status === 'APPROVED' ? 'Account Verified & Approved!' : 'KYC Verification Needs Attention',
      body:
        dto.status === 'APPROVED'
          ? 'Your onboarding documents have been verified by KudiCart Admin. You can now go Online.'
          : `KYC review outcome: ${driver.rejectionReason}`,
      timestamp: 'Just now',
      read: false,
      createdAt: new Date().toISOString(),
    });

    return {
      success: true,
      message: `Driver KYC status updated to ${dto.status}`,
      driverId: driver.id,
      kycStatus: driver.kycStatus,
      rejectionReason: driver.rejectionReason,
    };
  }
}
