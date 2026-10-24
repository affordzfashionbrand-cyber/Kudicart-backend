import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateDriverProfileDto } from './dto/update-driver-profile.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { DocumentUploadDto } from './dto/document-upload.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class DriverProfileService {
  constructor(private prisma: PrismaService) {}

  public resolveDriver(driverId?: string) {
    const store = this.prisma.getStore();
    const id = driverId || 'drv-1';
    const driver = store.drivers.find((d) => d.id === id || d.userId === id);
    if (!driver) {
      throw new NotFoundException(`Driver with identifier ${id} not found`);
    }
    return driver;
  }

  async getProfile(driverId?: string) {
    const driver = this.resolveDriver(driverId);
    const store = this.prisma.getStore();
    const darkStore = store.darkStores[0];

    // Mask sensitive Aadhaar number for security
    let maskedAadhaar = driver.aadhaarNumber || '';
    const cleanAadhaar = maskedAadhaar.replace(/\s/g, '');
    if (cleanAadhaar.length === 12) {
      maskedAadhaar = `•••• •••• ${cleanAadhaar.slice(8, 12)}`;
    }

    return {
      id: driver.id,
      fullName: driver.fullName,
      name: driver.name,
      role: driver.role || 'Delivery Partner',
      status: driver.status || 'Active',
      phone: driver.phone,
      tier: driver.tier || 'Silver Tier',
      avatarInitial: driver.avatarInitial || 'DP',
      photo: driver.photo,
      aadhaarNumber: maskedAadhaar,
      panNumber: driver.panNumber,
      dob: driver.dob,
      licenseNumber: driver.licenseNumber,
      workPreference: driver.workPreference,
      rating: driver.rating,
      completedDeliveries: driver.completedDeliveries,
      isOnline: driver.isOnline,
      kycStatus: driver.kycStatus,
      rejectionReason: driver.rejectionReason,
      vehicle: driver.vehicle,
      assignedStore: {
        name: darkStore.name,
        address: darkStore.address,
      },
      workSummary: driver.workSummary,
    };
  }

  async updateDetails(driverId: string | undefined, dto: UpdateDriverProfileDto) {
    const driver = this.resolveDriver(driverId);

    if (dto.fullName) {
      driver.fullName = dto.fullName.trim();
      const parts = driver.fullName.split(' ');
      const first = parts[0] || '';
      const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : '';
      driver.name = `${first}${lastInitial}`;
      driver.avatarInitial = parts
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || 'DP';
    }

    if (dto.phone) driver.phone = dto.phone;
    if (dto.aadhaarNumber) driver.aadhaarNumber = dto.aadhaarNumber;
    if (dto.panNumber) driver.panNumber = dto.panNumber.toUpperCase();
    if (dto.dob) driver.dob = dto.dob;
    if (dto.licenseNumber) driver.licenseNumber = dto.licenseNumber;
    if (dto.workPreference) driver.workPreference = dto.workPreference as any;
    if (dto.photo) driver.photo = dto.photo;
    if (dto.name) driver.name = dto.name;

    return this.getProfile(driver.id);
  }

  async updateVehicle(driverId: string | undefined, dto: UpdateVehicleDto) {
    const driver = this.resolveDriver(driverId);
    driver.vehicle = {
      registrationNumber: dto.registrationNumber.toUpperCase(),
      vehicleType: dto.vehicleType,
      make: dto.make,
      model: dto.model,
      rcStatus: 'Verified',
      rcNumber: dto.registrationNumber.toUpperCase(),
    };
    return {
      success: true,
      message: 'Vehicle details updated successfully',
      vehicle: driver.vehicle,
    };
  }

  async uploadDocument(driverId: string | undefined, dto: DocumentUploadDto) {
    const driver = this.resolveDriver(driverId);

    // Validate allowed file extensions
    const validExtensions = /\.(jpg|jpeg|png|webp|pdf)$/i;
    if (!validExtensions.test(dto.fileName)) {
      throw new BadRequestException('Unsupported format. Allowed formats: JPG, PNG, WEBP, PDF');
    }

    // Validate size limit (5MB)
    if (dto.fileSize) {
      const match = dto.fileSize.match(/([0-9.]+)\s*MB/i);
      if (match && parseFloat(match[1]) > 5.0) {
        throw new BadRequestException('File size exceeds the 5MB limit');
      }
    }

    const fileRecord = {
      uri: dto.fileUri,
      name: dto.fileName,
      size: dto.fileSize || '2.0 MB',
      type: dto.mimeType || 'image/jpeg',
      uploadedAt: new Date().toISOString(),
    };

    if (dto.docType === 'selfie') {
      driver.documents.selfie = fileRecord;
      driver.photo = dto.fileUri;
    } else {
      const side = dto.side || 'front';
      if (!driver.documents[dto.docType]) {
        driver.documents[dto.docType] = { front: null, back: null, status: 'PENDING' };
      }
      driver.documents[dto.docType][side] = fileRecord;
    }

    return {
      success: true,
      message: `Document ${dto.docType} (${dto.side || 'file'}) uploaded successfully`,
      documents: driver.documents,
    };
  }

  async getKycStatus(driverId?: string) {
    const driver = this.resolveDriver(driverId);
    const documentsArray = driver.kycDocuments || [
      { type: 'Aadhaar Card', status: 'VERIFIED', verifiedAt: '2026-01-11T12:00:00Z' },
      { type: 'Driving License', number: driver.licenseNumber || 'DL-04202209418', status: 'VERIFIED', verifiedAt: '2026-01-11T12:00:00Z' },
      { type: 'Vehicle RC', number: driver.vehicleDetails?.rcNumber || 'KA03EV4821', status: 'VERIFIED', verifiedAt: '2026-01-11T12:00:00Z' },
    ];
    return {
      driverId: driver.id,
      fullName: driver.fullName || driver.name,
      name: driver.name,
      kycStatus: driver.kycStatus,
      isApproved: driver.kycStatus === 'APPROVED',
      rejectionReason: driver.rejectionReason || null,
      documents: documentsArray,
      kycDocuments: documentsArray,
      uploadedDocuments: driver.documents,
      vehicle: driver.vehicle,
    };
  }

  async submitKyc(driverId: string | undefined) {
    const driver = this.resolveDriver(driverId);

    // Ensure documents exist
    const docs = driver.documents;
    const isComplete = Boolean(
      docs?.aadhaar?.front &&
        docs?.aadhaar?.back &&
        docs?.pan?.front &&
        docs?.pan?.back &&
        docs?.drivingLicence?.front &&
        docs?.drivingLicence?.back &&
        docs?.vehicleRc?.front &&
        docs?.vehicleRc?.back &&
        docs?.selfie,
    );

    if (!isComplete) {
      throw new BadRequestException(
        'All required documents (Aadhaar, PAN, DL, RC, Selfie) must be uploaded before submitting KYC.',
      );
    }

    driver.kycStatus = 'PENDING';
    driver.rejectionReason = null;
    driver.status = 'Pending Verification';

    return {
      success: true,
      message: 'KYC submitted successfully. Documents are now under administrative review.',
      kycStatus: driver.kycStatus,
    };
  }

  async updateAvailability(driverId: string | undefined, isOnline: boolean) {
    const driver = this.resolveDriver(driverId);

    // Enforce account approval: unapproved accounts cannot go online
    if (isOnline && driver.kycStatus !== 'APPROVED') {
      throw new ForbiddenException(
        `Driver account cannot go Online while KYC status is '${driver.kycStatus}'. Verification must be APPROVED first.`,
      );
    }

    driver.isOnline = isOnline;
    return {
      success: true,
      driverId: driver.id,
      isOnline: driver.isOnline,
      message: `Driver status set to ${isOnline ? 'Online (Ready for assignments)' : 'Offline'}`,
    };
  }

  async updateLocation(driverId: string | undefined, dto: UpdateLocationDto) {
    const driver = this.resolveDriver(driverId);
    driver.currentLocation = {
      latitude: dto.latitude,
      longitude: dto.longitude,
      heading: dto.heading || 0,
      updatedAt: new Date().toISOString(),
    };

    return {
      success: true,
      driverId: driver.id,
      location: driver.currentLocation,
    };
  }
}
