import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DeliveryAssignmentService } from '../orders/delivery-assignment.service';
import { TrackingRealtimeGateway } from '../orders/tracking-realtime.gateway';
import { LIVE_TRACKING_ACTIVE_STATUSES, OrderStatus } from '../../common/contracts/order-contracts';
import { UpdateDriverProfileDto } from './dto/update-driver-profile.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { DocumentUploadDto } from './dto/document-upload.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

const DEFAULT_HUB_LOGIN_RADIUS_METERS =
  Number(process.env.DRIVER_HUB_LOGIN_RADIUS_METERS) || 50;
const MAX_GPS_ACCURACY_METERS = Number(process.env.DRIVER_MAX_GPS_ACCURACY_METERS) || 150;

function maskAadhaar(aadhaar?: string | null): string | null {
  if (!aadhaar) return null;
  const digits = aadhaar.replace(/\D/g, '');
  if (digits.length < 4) return 'XXXX-XXXX-XXXX';
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
}

function compareSemver(a: string, b: string): number {
  const pa = String(a || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n.replace(/[^0-9]/g, ''), 10) || 0);
  const pb = String(b || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n.replace(/[^0-9]/g, ''), 10) || 0);
  const maxLen = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function isDisallowedPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.startsWith('169.254.') ||
    lower.startsWith('10.') ||
    lower.startsWith('192.168.')
  ) {
    return true;
  }
  const match172 = lower.match(/^172\.(\d+)\./);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

@Injectable()
export class DriverProfileService {
  private readonly lastLocationTimestampByDriver = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly trackingGateway?: TrackingRealtimeGateway,
    @Optional() private readonly deliveryAssignment?: DeliveryAssignmentService,
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
      if (d.rejectionReason) {
        grouped[d.type].rejectionReason = d.rejectionReason;
      }
    }

    return grouped;
  }

  private async resolveActiveHub(assignedHubId?: string | null) {
    if (assignedHubId) {
      const assigned = await this.prisma.darkStoreHub.findFirst({
        where: { id: assignedHubId, isActive: true },
      });
      if (assigned) return assigned;
    }
    return this.prisma.darkStoreHub.findFirst({
      where: { isActive: true },
      orderBy: { deliveryMinutes: 'asc' },
    });
  }

  async getProfile(driverId?: string) {
    const driver = await this.resolveDriver(driverId);
    const docs = this.groupDocuments(driver.documents, driver.selfieUrl);

    const [activeHub, codOrders, supportSetting] = await Promise.all([
      this.resolveActiveHub((driver as any).assignedHubId),
      this.prisma.order.findMany({
        where: {
          OR: [{ driverProfileId: driver.id }, { driverId: driver.userId }],
          paymentMethod: 'COD',
          status: { in: ['DELIVERED', 'RETURNED'] },
          paymentStatus: 'COMPLETED',
        },
        select: { grandTotal: true },
      }),
      this.prisma.workspaceSetting.findUnique({
        where: { key: 'driverSupportConfig' },
      }),
    ]);

    const cashInHandCod = Math.round(
      codOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0),
    );
    const supportValue =
      supportSetting?.value && typeof supportSetting.value === 'object'
        ? (supportSetting.value as Record<string, any>)
        : {};
    const supportPhone =
      (typeof supportValue.phone === 'string' && supportValue.phone.trim()) ||
      process.env.DRIVER_SUPPORT_PHONE?.trim() ||
      null;
    const supportEmail =
      (typeof supportValue.email === 'string' && supportValue.email.trim()) ||
      process.env.DRIVER_SUPPORT_EMAIL?.trim() ||
      null;

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
      createdAt: driver.createdAt.toISOString(),
      hasSeenApproval: Boolean((driver as any).approvalAcknowledgedAt),
      approvalAcknowledgedAt: (driver as any).approvalAcknowledgedAt
        ? new Date((driver as any).approvalAcknowledgedAt).toISOString()
        : null,
      assignedHub: activeHub
        ? {
            id: activeHub.id,
            name: activeHub.name,
            locality: activeHub.locality,
            address: activeHub.address,
            lat: activeHub.lat,
            lng: activeHub.lng,
            deliveryMinutes: activeHub.deliveryMinutes,
          }
        : null,
      supportConfig: {
        phone: supportPhone,
        email: supportEmail,
      },
      cashInHandCod,
      floatingCashLimit: Number(process.env.DRIVER_COD_CASH_LIMIT) || 2500,
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
            rejectionReason: null,
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

  async acknowledgeApproval(driverId: string | undefined) {
    const driver = await this.resolveDriver(driverId);
    if (driver.kycStatus !== 'APPROVED') {
      throw new BadRequestException('Approval acknowledgment is only valid for approved accounts.');
    }

    const acknowledgedAt = (driver as any).approvalAcknowledgedAt
      ? new Date((driver as any).approvalAcknowledgedAt)
      : new Date();

    if (!(driver as any).approvalAcknowledgedAt) {
      await this.prisma.driverProfile.update({
        where: { id: driver.id },
        data: { approvalAcknowledgedAt: acknowledgedAt },
      });
    }

    return {
      success: true,
      driverId: driver.id,
      hasSeenApproval: true,
      approvalAcknowledgedAt: acknowledgedAt.toISOString(),
    };
  }

  async getAppVersionStatus(currentVersion?: string) {
    this.ensureDbConnected();
    const setting = await this.prisma.workspaceSetting.findUnique({
      where: { key: 'driverAppRelease' },
    });
    const config =
      setting?.value && typeof setting.value === 'object'
        ? (setting.value as Record<string, any>)
        : {};

    const normalizedCurrent = (currentVersion || '').trim() || null;
    const latestVersion =
      (typeof config.latestVersion === 'string' && config.latestVersion.trim()) ||
      process.env.DRIVER_APP_LATEST_VERSION?.trim() ||
      null;
    const minSupportedVersion =
      (typeof config.minSupportedVersion === 'string' && config.minSupportedVersion.trim()) ||
      process.env.DRIVER_APP_MIN_VERSION?.trim() ||
      null;
    const updateUrl =
      (typeof config.updateUrl === 'string' && config.updateUrl.trim()) ||
      process.env.DRIVER_APP_UPDATE_URL?.trim() ||
      null;
    const releaseNotes =
      (typeof config.releaseNotes === 'string' && config.releaseNotes.trim()) ||
      process.env.DRIVER_APP_RELEASE_NOTES?.trim() ||
      null;

    const updateAvailable =
      Boolean(latestVersion && normalizedCurrent) &&
      compareSemver(latestVersion!, normalizedCurrent!) > 0;
    const forceUpdate =
      Boolean(config.forceUpdate) ||
      process.env.DRIVER_APP_FORCE_UPDATE === 'true' ||
      (Boolean(minSupportedVersion && normalizedCurrent) &&
        compareSemver(minSupportedVersion!, normalizedCurrent!) > 0);

    return {
      currentVersion: normalizedCurrent,
      latestVersion: latestVersion || normalizedCurrent,
      minSupportedVersion,
      updateAvailable,
      forceUpdate: updateAvailable ? forceUpdate : false,
      updateUrl,
      releaseNotes,
      checkedAt: new Date().toISOString(),
    };
  }

  async getDocumentFile(driverId: string | undefined, docType: string, side = 'front') {
    const driver = await this.resolveDriver(driverId);
    const normalizedType = docType.trim();
    const normalizedSide = (side || 'front').trim().toLowerCase();

    let rawUrl: string | null = null;
    let fileName = `${normalizedType}_${normalizedSide}`;
    let mimeType = 'application/octet-stream';

    if (normalizedType === 'selfie') {
      rawUrl = driver.selfieUrl || null;
      fileName = 'selfie.jpg';
      mimeType = 'image/jpeg';
    } else {
      const doc = (driver.documents || []).find(
        (d: any) =>
          d.type.toLowerCase() === normalizedType.toLowerCase() &&
          (d.side || 'front').toLowerCase() === normalizedSide,
      );
      if (doc) {
        rawUrl = doc.fileUrl;
        fileName = doc.fileName || fileName;
        mimeType = doc.mimeType || mimeType;
      }
    }

    if (!rawUrl) {
      throw new NotFoundException(`No uploaded file found for ${normalizedType} (${normalizedSide}).`);
    }

    if (rawUrl.startsWith('data:')) {
      const match = rawUrl.match(/^data:([^;,]+);base64,(.+)$/i);
      if (!match) {
        throw new BadRequestException('Stored document data URI is invalid.');
      }
      return {
        buffer: Buffer.from(match[2], 'base64'),
        mimeType: match[1] || mimeType,
        fileName,
      };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new BadRequestException(
        'Document file was saved only as a local device path and must be re-uploaded to view or download.',
      );
    }

    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new BadRequestException(
        'Document file is not hosted on cloud storage and must be re-uploaded.',
      );
    }

    const supabaseHost = (() => {
      try {
        return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname : null;
      } catch {
        return null;
      }
    })();

    if (
      isDisallowedPrivateHost(parsedUrl.hostname) &&
      (!supabaseHost || parsedUrl.hostname !== supabaseHost)
    ) {
      throw new BadRequestException('Blocked unsafe document URL.');
    }

    const response = await fetch(parsedUrl.toString());
    if (!response.ok) {
      throw new NotFoundException(
        `Unable to retrieve stored document file (upstream status ${response.status}).`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const headerType = response.headers.get('content-type');
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: headerType || mimeType,
      fileName,
    };
  }

  async updateAvailability(
    driverId: string | undefined,
    isOnline: boolean,
    options?: {
      latitude?: number;
      longitude?: number;
      accuracy?: number;
      enforceHubProximity?: boolean;
    },
  ) {
    const driver = await this.resolveDriver(driverId);

    if (isOnline && driver.kycStatus !== 'APPROVED') {
      throw new BadRequestException(
        'Cannot go online until KYC verification is approved by Operations Admin',
      );
    }

    let hubDistanceMeters: number | null = null;
    let hubName: string | null = null;
    const hasCoords =
      options?.latitude !== undefined || options?.longitude !== undefined;

    if (isOnline && (options?.enforceHubProximity || hasCoords)) {
      if (
        typeof options?.latitude !== 'number' ||
        typeof options?.longitude !== 'number' ||
        !Number.isFinite(options.latitude) ||
        !Number.isFinite(options.longitude)
      ) {
        throw new BadRequestException(
          'Live GPS coordinates are required to go online. Enable location access and try again.',
        );
      }

      if (
        typeof options.accuracy === 'number' &&
        Number.isFinite(options.accuracy) &&
        options.accuracy > MAX_GPS_ACCURACY_METERS
      ) {
        throw new BadRequestException(
          `GPS accuracy is too weak (${Math.round(options.accuracy)}m). Move to an open area near your hub and retry.`,
        );
      }

      const activeHub = await this.resolveActiveHub((driver as any).assignedHubId);
      if (
        !activeHub ||
        typeof activeHub.lat !== 'number' ||
        typeof activeHub.lng !== 'number'
      ) {
        throw new BadRequestException(
          'Assigned hub coordinates are unavailable. Please contact Operations Support.',
        );
      }

      hubDistanceMeters = haversineDistanceMeters(
        options.latitude,
        options.longitude,
        activeHub.lat,
        activeHub.lng,
      );
      hubName = activeHub.name;

      if (hubDistanceMeters > DEFAULT_HUB_LOGIN_RADIUS_METERS) {
        throw new BadRequestException(
          `You are ${Math.round(hubDistanceMeters)}m away from ${activeHub.name}. Move within ${DEFAULT_HUB_LOGIN_RADIUS_METERS}m of your assigned hub to go online.`,
        );
      }
    }

    const now = isOnline ? new Date() : null;
    const updated = await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: {
        isOnline,
        availableSince: now,
        ...(isOnline &&
        typeof options?.latitude === 'number' &&
        typeof options?.longitude === 'number'
          ? {
              currentLat: options.latitude,
              currentLng: options.longitude,
            }
          : {}),
      },
    });

    if (isOnline && updated.kycStatus === 'APPROVED') {
      this.deliveryAssignment?.retryPendingAssignments().catch(() => 0);
    }

    return {
      success: true,
      driverId: updated.id,
      isOnline: updated.isOnline,
      availableSince: updated.availableSince ? updated.availableSince.toISOString() : null,
      hubDistanceMeters:
        hubDistanceMeters !== null ? Math.round(hubDistanceMeters) : null,
      hubName,
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
