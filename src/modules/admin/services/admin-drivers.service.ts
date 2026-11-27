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
    const rawType = (d.vehicleType || '').trim();
    const rawModel = (d.vehicleModel || '').trim();
    const rawMake = (d.vehicleMake || '').trim();
    const rawReg = (d.vehicleRegistration || d.rcNumber || '').trim();

    const isElectric = Boolean(
      (rawType && rawType.toLowerCase().includes('ev')) ||
      (rawModel && rawModel.toLowerCase().includes('electric')) ||
      (rawType && rawType.toLowerCase().includes('electric'))
    );
    const hasVehicle = Boolean(rawType || rawModel || rawMake || rawReg);
    const vehicleTypeDisplay = rawType || null;
    const vehicleMakeDisplay = rawMake || null;
    const vehicleModelDisplay = rawModel || null;
    const registrationNumber = rawReg || null;

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
      aadhaarNumber: d.aadhaarNumber || null,
      panNumber: d.panNumber || null,
      dob: d.dob || null,
      licenseNumber: d.licenseNumber || null,
      workPreference: d.workPreference || 'PART_TIME',
      rcNumber: d.rcNumber || null,
      rcStatus: d.rcStatus || (registrationNumber ? 'Verified' : 'Under review'),
      vehicleType: vehicleTypeDisplay,
      vehicleMake: vehicleMakeDisplay,
      vehicleModel: vehicleModelDisplay,
      vehicleRegistration: registrationNumber,
      vehicleDetails: hasVehicle
        ? {
            vehicleType: vehicleTypeDisplay,
            make: vehicleMakeDisplay,
            model: vehicleModelDisplay,
            registrationNumber: registrationNumber || null,
            isElectric,
            color: 'Standard',
            rcStatus: d.rcStatus || (registrationNumber ? 'Verified' : 'Under review'),
          }
        : null,
      currentLat: d.currentLat ?? null,
      currentLng: d.currentLng ?? null,
      documents: d.documents || [],
      selfieUrl: d.selfieUrl || null,
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

    // Identify which specific document types are rejected vs verified
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
        // Parse from bulleted or descriptive rejectionReason
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

    await this.prisma.$transaction(async (tx) => {
      await tx.driverProfile.update({
        where: { id: profile.id },
        data: {
          kycStatus: dto.status,
          rejectionReason: dto.status === 'REJECTED' ? dto.rejectionReason!.trim() : null,
          ...(dto.status === 'APPROVED' || dto.status === 'REJECTED'
            ? { approvalAcknowledgedAt: null }
            : {}),
        },
      });

      if (dto.status === 'APPROVED') {
        await tx.driverDocument.updateMany({
          where: { driverId: profile.id },
          data: {
            status: 'VERIFIED',
            rejectionReason: null,
            verifiedAt: new Date(),
          },
        });
      } else if (rejectedDocTypes.length > 0) {
        // Mark ONLY the specific flagged documents as REJECTED
        await tx.driverDocument.updateMany({
          where: {
            driverId: profile.id,
            type: { in: rejectedDocTypes },
          },
          data: {
            status: 'REJECTED',
            rejectionReason: dto.rejectionReason!.trim(),
            verifiedAt: null,
          },
        });

        // Other documents that were not flagged remain VERIFIED
        await tx.driverDocument.updateMany({
          where: {
            driverId: profile.id,
            type: { notIn: rejectedDocTypes },
          },
          data: {
            status: 'VERIFIED',
            rejectionReason: null,
            verifiedAt: new Date(),
          },
        });
      } else {
        // General rejection fallback
        await tx.driverDocument.updateMany({
          where: { driverId: profile.id },
          data: {
            status: 'REJECTED',
            rejectionReason: dto.rejectionReason!.trim(),
            verifiedAt: null,
          },
        });
      }

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

  async getDriverDeliveryStats(id: string) {
    this.ensureDbConnected();
    const cleanId = id.trim();
    const profile = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: cleanId }, { userId: cleanId }] },
    });

    if (!profile) {
      throw new NotFoundException(`Delivery partner '${id}' not found.`);
    }

    const driverCondition = {
      OR: [{ driverProfileId: profile.id }, { driverId: profile.userId }],
    };

    const [total, completed, cancelled, failed, assignedOrInProgress] = await Promise.all([
      this.prisma.order.count({ where: driverCondition }),
      this.prisma.order.count({ where: { ...driverCondition, status: 'DELIVERED' } }),
      this.prisma.order.count({ where: { ...driverCondition, status: 'CANCELLED' } }),
      this.prisma.order.count({ where: { ...driverCondition, status: 'FAILED' } }),
      this.prisma.order.count({
        where: {
          ...driverCondition,
          status: { in: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'RETURNING'] },
        },
      }),
    ]);

    return {
      totalDeliveries: total,
      completedDeliveries: completed,
      cancelledDeliveries: cancelled,
      failedDeliveries: failed,
      assignedDeliveries: assignedOrInProgress,
      successfulDeliveries: completed,
    };
  }

  async getDriverDeliveries(id: string, query: AdminQueryDto) {
    this.ensureDbConnected();
    const cleanId = id.trim();
    const profile = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: cleanId }, { userId: cleanId }] },
    });

    if (!profile) {
      throw new NotFoundException(`Delivery partner '${id}' not found.`);
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    const driverCondition = {
      OR: [{ driverProfileId: profile.id }, { driverId: profile.userId }],
    };

    const andConditions: any[] = [driverCondition];

    if (query.status && query.status !== 'ALL') {
      const statusUpper = query.status.toUpperCase();
      if (statusUpper === 'COMPLETED') {
        andConditions.push({ status: 'DELIVERED' });
      } else if (statusUpper === 'ASSIGNED') {
        andConditions.push({ status: 'ASSIGNED' });
      } else if (statusUpper === 'IN_PROGRESS' || statusUpper === 'IN PROGRESS') {
        andConditions.push({
          status: { in: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'RETURNING'] },
        });
      } else if (statusUpper === 'CANCELLED') {
        andConditions.push({ status: 'CANCELLED' });
      } else if (statusUpper === 'FAILED') {
        andConditions.push({ status: 'FAILED' });
      } else {
        andConditions.push({ status: statusUpper });
      }
    }

    if (query.search?.trim()) {
      const search = query.search.trim();
      andConditions.push({
        OR: [
          { id: { contains: search, mode: 'insensitive' } },
          { orderNumber: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { customer: { phone: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    if (query.from || query.to) {
      const dateFilter: any = {};
      if (query.from) {
        dateFilter.gte = new Date(query.from);
      }
      if (query.to) {
        const toDate = new Date(query.to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.lte = toDate;
      }
      andConditions.push({ createdAt: dateFilter });
    }

    const where = { AND: andConditions };

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          vendor: { select: { id: true, storeName: true, address: true, phone: true } },
          address: true,
          history: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const deliveries = orders.map((order) => {
      const pickupLocation =
        order.vendor?.address || order.vendor?.storeName || 'KudiCart Central Hub';

      let dropLocation = 'Customer Destination';
      if (order.deliveryAddress) {
        if (typeof order.deliveryAddress === 'string') {
          dropLocation = order.deliveryAddress;
        } else if (typeof order.deliveryAddress === 'object') {
          const addr = order.deliveryAddress as any;
          dropLocation =
            addr.formattedAddress ||
            addr.addressLine1 ||
            addr.street ||
            `${addr.city || 'Local Delivery'}`;
        }
      } else if (order.address?.line1) {
        dropLocation = `${order.address.line1}${
          order.address.city ? `, ${order.address.city}` : ''
        }`;
      }

      return {
        id: order.id,
        deliveryId: `DEL-${order.orderNumber.replace(/[^a-zA-Z0-9]/g, '')}`,
        orderId: order.orderNumber,
        orderUuid: order.id,
        customer: {
          id: order.customer?.id || null,
          name: order.customer?.name || 'Customer',
          phone: order.customer?.phone || null,
        },
        pickupLocation,
        dropLocation,
        assignedAt: order.createdAt.toISOString(),
        completedAt: order.deliveredAt
          ? order.deliveredAt.toISOString()
          : order.status === 'DELIVERED'
          ? order.updatedAt.toISOString()
          : null,
        status: order.status,
        deliveryFee: order.deliveryFee ?? 40.0,
        earnings: order.deliveryFee ?? 40.0,
        grandTotal: order.grandTotal,
        itemTotal: order.itemTotal,
        cancellationReason: order.cancellationReason || null,
        createdAt: order.createdAt.toISOString(),
      };
    });

    return {
      data: deliveries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDriverDeliveryDetail(id: string, deliveryId: string) {
    this.ensureDbConnected();
    const cleanDriverId = id.trim();
    const profile = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: cleanDriverId }, { userId: cleanDriverId }] },
    });

    if (!profile) {
      throw new NotFoundException(`Delivery partner '${id}' not found.`);
    }

    const cleanDeliveryId = deliveryId.trim();
    const possibleOrderNumber = cleanDeliveryId.replace(/^DEL-/, '');

    const order = await this.prisma.order.findFirst({
      where: {
        AND: [
          {
            OR: [
              { id: cleanDeliveryId },
              { orderNumber: cleanDeliveryId },
              { orderNumber: possibleOrderNumber },
              { orderNumber: { contains: possibleOrderNumber, mode: 'insensitive' } },
            ],
          },
          {
            OR: [{ driverProfileId: profile.id }, { driverId: profile.userId }],
          },
        ],
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        vendor: { select: { id: true, storeName: true, address: true, phone: true } },
        address: true,
        items: {
          include: {
            product: { select: { id: true, title: true, image: true, brand: true } },
          },
        },
        history: {
          orderBy: { createdAt: 'asc' },
        },
        dispatchAssignment: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Delivery record '${deliveryId}' not found for this partner.`);
    }

    const pickupLocation =
      order.vendor?.address || order.vendor?.storeName || 'KudiCart Central Hub';
    let dropLocation = 'Customer Destination';
    if (order.deliveryAddress) {
      if (typeof order.deliveryAddress === 'string') {
        dropLocation = order.deliveryAddress;
      } else if (typeof order.deliveryAddress === 'object') {
        const addr = order.deliveryAddress as any;
        dropLocation =
          addr.formattedAddress ||
          addr.addressLine1 ||
          addr.street ||
          `${addr.city || 'Local Delivery'}`;
      }
    } else if (order.address?.line1) {
      dropLocation = `${order.address.line1}${
        order.address.city ? `, ${order.address.city}` : ''
      }`;
    }

    const timeline = order.history.map((h) => ({
      id: h.id,
      status: h.status,
      note: h.note || null,
      actorRole: h.actorRole || null,
      timestamp: h.createdAt.toISOString(),
    }));

    if (timeline.length === 0) {
      timeline.push({
        id: 'initial-created',
        status: order.status,
        note: 'Order registered in system',
        actorRole: 'SYSTEM',
        timestamp: order.createdAt.toISOString(),
      });
    }

    return {
      id: order.id,
      deliveryId: `DEL-${order.orderNumber.replace(/[^a-zA-Z0-9]/g, '')}`,
      orderId: order.orderNumber,
      orderUuid: order.id,
      customer: {
        id: order.customer?.id,
        name: order.customer?.name || 'Customer',
        phone: order.customer?.phone || null,
        email: order.customer?.email || null,
      },
      partner: {
        id: profile.id,
        fullName: profile.fullName,
        driverCode: profile.id.slice(0, 8).toUpperCase(),
        phone: profile.phone,
      },
      pickupLocation,
      dropLocation,
      assignedAt: order.createdAt.toISOString(),
      pickedUpAt:
        order.history.find((h) => h.status === 'PICKED_UP')?.createdAt.toISOString() || null,
      completedAt: order.deliveredAt
        ? order.deliveredAt.toISOString()
        : order.status === 'DELIVERED'
        ? order.updatedAt.toISOString()
        : null,
      status: order.status,
      deliveryFee: order.deliveryFee ?? 40.0,
      earnings: order.deliveryFee ?? 40.0,
      itemTotal: order.itemTotal,
      grandTotal: order.grandTotal,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      cancellationReason: order.cancellationReason || null,
      cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
      deliveryInstructions: order.deliveryInstructions || null,
      verificationPhotos: order.verificationPhotos || [],
      items: order.items.map((item) => ({
        id: item.id,
        title: item.title,
        brand: item.brand,
        size: item.size,
        price: item.price,
        quantity: item.quantity,
        image: item.image,
      })),
      timeline,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
