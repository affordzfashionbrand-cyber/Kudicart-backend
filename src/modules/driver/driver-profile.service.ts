import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingRealtimeGateway } from '../orders/tracking-realtime.gateway';
import { LIVE_TRACKING_ACTIVE_STATUSES, OrderStatus } from '../../common/contracts/order-contracts';
import { UpdateDriverProfileDto } from './dto/update-driver-profile.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { DocumentUploadDto } from './dto/document-upload.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

function maskAadhaar(aadhaar?: string | null): string | null {
  if (!aadhaar) return null;
  const digits = aadhaar.replace(/\D/g, '');
  if (digits.length < 4) return 'XXXX-XXXX-XXXX';
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

@Injectable()
export class DriverProfileService {
  private readonly lastLocationTimestampByDriver = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly trackingGateway?: TrackingRealtimeGateway,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async resolveDriver(driverIdOrUserId?: string) {
    this.ensureDbConnected();
    if (!driverIdOrUserId) {
      throw new BadRequestException('Authenticated driver context is required');
    }
    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: driverIdOrUserId }, { userId: driverIdOrUserId }] },
      include: { user: true, documents: true },
    });
    if (!driver) {
      throw new NotFoundException('Delivery partner profile not found');
    }
    return driver;
  }

  private groupDocuments(docs: any[], selfieUrl?: string | null) {
    const grouped: Record<string, any> = {
      selfie: selfieUrl ? { uri: selfieUrl } : null,
      aadhaar: { front: null, back: null, status: 'PENDING' },
      pan: { front: null, back: null, status: 'PENDING' },
      drivingLicence: { front: null, back: null, status: 'PENDING' },
      vehicleRc: { front: null, back: null, status: 'PENDING' },
    };

    for (const d of docs || []) {
      const side = d.side || 'front';
      if (!grouped[d.type]) {
        grouped[d.type] = { front: null, back: null, status: d.status };
      }
      grouped[d.type][side] = {
        id: d.id,
        uri: d.fileUrl,
        name: d.fileName,
        size: d.fileSize,
        type: d.mimeType,
        uploadedAt: d.createdAt.toISOString(),
      };
      grouped[d.type].status = d.status;
    }

    return grouped;
  }

  async getProfile(driverId?: string) {
    const driver = await this.resolveDriver(driverId);
    const docs = this.groupDocuments(driver.documents, driver.selfieUrl);

    return {
      id: driver.id,
      userId: driver.userId,
      name: driver.fullName,
      fullName: driver.fullName,
      phone: driver.phone,
      email: driver.user?.email || null,
      photo: driver.selfieUrl || driver.user?.avatar || null,
      tier: driver.tier,
      rating: driver.rating,
      completedDeliveries: driver.completedDeliveries,
      isOnline: driver.isOnline,
      availableSince: driver.availableSince ? driver.availableSince.toISOString() : null,
      kycStatus: driver.kycStatus,
      rejectionReason: driver.rejectionReason,
      aadhaarNumber: maskAadhaar(driver.aadhaarNumber),
      panNumber: driver.panNumber,
      dob: driver.dob,
      licenseNumber: driver.licenseNumber,
      workPreference: driver.workPreference,
      vehicle: {
        registrationNumber: driver.vehicleRegistration,
        vehicleType: driver.vehicleType,
        make: driver.vehicleMake,
        model: driver.vehicleModel,
        rcStatus: driver.rcStatus,
        rcNumber: driver.rcNumber,
      },
      documents: docs,
      currentLocation:
        driver.currentLat != null && driver.currentLng != null
          ? {
              latitude: driver.currentLat,
              longitude: driver.currentLng,
              heading: driver.currentHeading ?? 0,
            }
          : null,
      status: driver.user?.status || 'ACTIVE',
    };
  }

  async updateDetails(driverId: string | undefined, dto: UpdateDriverProfileDto) {
    const driver = await this.resolveDriver(driverId);

    const data: Record<string, any> = {};
    if (dto.fullName || dto.name) {
      data.fullName = (dto.fullName || dto.name)!.trim();
    }
    if (dto.phone) data.phone = dto.phone.trim();
    if (dto.aadhaarNumber) {
      const cleaned = dto.aadhaarNumber.replace(/\s+/g, '');
      if (!/^\d{12}$/.test(cleaned)) {
        throw new BadRequestException('Aadhaar number must contain 12 digits');
      }
      data.aadhaarNumber = cleaned;
    }
    if (dto.panNumber) data.panNumber = dto.panNumber.toUpperCase().trim();
    if (dto.dob) {
      const parts = dto.dob.trim().split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        const birthDate = new Date(year, month, day);
        const now = new Date();
        if (
          isNaN(birthDate.getTime()) ||
          birthDate.getDate() !== day ||
          birthDate.getMonth() !== month ||
          birthDate.getFullYear() !== year
        ) {
          throw new BadRequestException('Invalid date of birth');
        }
        if (birthDate > now) {
          throw new BadRequestException('Date of birth cannot be in the future');
        }
        const ageYears = (now.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (ageYears < 18) {
          throw new BadRequestException('Driver must be at least 18 years old');
        }
      }
      data.dob = dto.dob.trim();
    }
    if (dto.licenseNumber) data.licenseNumber = dto.licenseNumber.trim();
    if (dto.workPreference) data.workPreference = dto.workPreference;
    if (dto.photo) data.selfieUrl = dto.photo;

    await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data,
    });

    return this.getProfile(driver.id);
  }

  async updateVehicle(driverId: string | undefined, dto: UpdateVehicleDto) {
    const driver = await this.resolveDriver(driverId);
    const updated = await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: {
        vehicleRegistration: dto.registrationNumber.toUpperCase(),
        vehicleType: dto.vehicleType,
        vehicleMake: dto.make,
        vehicleModel: dto.model,
        rcStatus: 'Verified',
        rcNumber: dto.registrationNumber.toUpperCase(),
      },
    });

    return {
      success: true,
      message: 'Vehicle details updated successfully',
      vehicle: {
        registrationNumber: updated.vehicleRegistration,
        vehicleType: updated.vehicleType,
        make: updated.vehicleMake,
        model: updated.vehicleModel,
        rcStatus: updated.rcStatus,
        rcNumber: updated.rcNumber,
      },
    };
  }

  async uploadDocument(driverId: string | undefined, dto: DocumentUploadDto) {
    const driver = await this.resolveDriver(driverId);

    const validExtensions = /\.(jpg|jpeg|png|webp|pdf)$/i;
    if (!validExtensions.test(dto.fileName)) {
      throw new BadRequestException('Unsupported format. Allowed formats: JPG, PNG, WEBP, PDF');
    }

    if (dto.fileSize) {
      const match = dto.fileSize.match(/([0-9.]+)\s*MB/i);
      if (match && parseFloat(match[1]) > 5.0) {
        throw new BadRequestException('File size exceeds the 5MB limit');
      }
    }

    if (dto.docType === 'selfie') {
      await this.prisma.driverProfile.update({
        where: { id: driver.id },
        data: { selfieUrl: dto.fileUri },
      });
    } else {
      const side = dto.side || 'front';
      const existingDoc = await this.prisma.driverDocument.findFirst({
        where: { driverId: driver.id, type: dto.docType, side },
      });
      if (existingDoc) {
        await this.prisma.driverDocument.update({
          where: { id: existingDoc.id },
          data: {
            fileName: dto.fileName,
            fileUrl: dto.fileUri,
            fileSize: dto.fileSize || '2.0 MB',
            mimeType: dto.mimeType || 'image/jpeg',
            status: 'PENDING',
          },
        });
      } else {
        await this.prisma.driverDocument.create({
          data: {
            driverId: driver.id,
            type: dto.docType,
            side,
            fileName: dto.fileName,
            fileUrl: dto.fileUri,
            fileSize: dto.fileSize || '2.0 MB',
            mimeType: dto.mimeType || 'image/jpeg',
            status: 'PENDING',
          },
        });
      }
    }

    const refreshed = await this.resolveDriver(driver.id);
    return {
      success: true,
      message: `Document ${dto.docType} (${dto.side || 'file'}) uploaded successfully`,
      documents: this.groupDocuments(refreshed.documents, refreshed.selfieUrl),
    };
  }

  async getKycStatus(driverId?: string) {
    const driver = await this.resolveDriver(driverId);
    const docs = this.groupDocuments(driver.documents, driver.selfieUrl);

    return {
      driverId: driver.id,
      fullName: driver.fullName,
      name: driver.fullName,
      kycStatus: driver.kycStatus,
      isApproved: driver.kycStatus === 'APPROVED',
      rejectionReason: driver.rejectionReason,
      documents: docs,
    };
  }

  async submitKyc(driverId: string | undefined) {
    const driver = await this.resolveDriver(driverId);
    const docs = this.groupDocuments(driver.documents, driver.selfieUrl);

    if (!docs.pan?.front) {
      throw new BadRequestException('PAN Card front image is required before submitting KYC');
    }

    const updated = await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: { kycStatus: 'UNDER_REVIEW', rejectionReason: null },
    });

    return {
      success: true,
      message: 'KYC submitted successfully. Documents are now under administrative review.',
      kycStatus: updated.kycStatus,
    };
  }

  async updateAvailability(driverId: string | undefined, isOnline: boolean) {
    const driver = await this.resolveDriver(driverId);

    if (isOnline && driver.kycStatus !== 'APPROVED') {
      throw new BadRequestException(
        'Cannot go online until KYC verification is approved by Operations Admin',
      );
    }

    const now = isOnline ? new Date() : null;
    const updated = await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: {
        isOnline,
        availableSince: now,
      },
    });

    return {
      success: true,
      driverId: updated.id,
      isOnline: updated.isOnline,
      availableSince: updated.availableSince ? updated.availableSince.toISOString() : null,
      message: `Driver status set to ${isOnline ? 'Online (Ready for assignments)' : 'Offline'}`,
    };
  }

  async updateLocation(driverId: string | undefined, dto: UpdateLocationDto) {
    const driver = await this.resolveDriver(driverId);

    const lastTs = this.lastLocationTimestampByDriver.get(driver.id) || 0;
    if (dto.timestamp && dto.timestamp < lastTs) {
      return {
        success: true,
        driverId: driver.id,
        location: {
          latitude: driver.currentLat,
          longitude: driver.currentLng,
          heading: driver.currentHeading ?? 0,
        },
        ignoredStaleUpdate: true,
      };
    }

    if (dto.timestamp) {
      this.lastLocationTimestampByDriver.set(driver.id, dto.timestamp);
    }

    await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: {
        currentLat: dto.latitude,
        currentLng: dto.longitude,
        currentHeading: dto.heading ?? 0,
      },
    });

    // Find active order to broadcast location if live
    let targetOrderId = dto.orderId;
    if (!targetOrderId) {
      const activeOrder = await this.prisma.order.findFirst({
        where: {
          OR: [{ driverProfileId: driver.id }, { driverId: driver.userId }],
          status: { in: [...LIVE_TRACKING_ACTIVE_STATUSES] as any[] },
        },
        orderBy: { updatedAt: 'desc' },
      });
      targetOrderId = activeOrder?.id;
    }

    if (targetOrderId && this.trackingGateway) {
      const orderRow = await this.prisma.order.findUnique({
        where: { id: targetOrderId },
        select: { id: true, status: true },
      });
      if (orderRow && LIVE_TRACKING_ACTIVE_STATUSES.includes(orderRow.status as OrderStatus)) {
        this.trackingGateway.broadcastLocationUpdate(orderRow.id, {
          latitude: dto.latitude,
          longitude: dto.longitude,
          heading: dto.heading || 0,
          accuracy: dto.accuracy,
          speed: dto.speed,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return {
      success: true,
      driverId: driver.id,
      location: {
        latitude: dto.latitude,
        longitude: dto.longitude,
        heading: dto.heading || 0,
      },
    };
  }
}
