import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { OrderTransitionService } from '../orders/order-transition.service';
import { Role } from '../../common/enums/role.enum';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { createJwtToken } from '../../common/utils/crypto.util';
import { buildPhoneLookupCandidates } from '../../common/utils/phone.util';

const VENDOR_ORDER_INCLUDE = {
  items: true,
  address: true,
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
    },
  },
  vendor: {
    select: {
      id: true,
      storeName: true,
      address: true,
      phone: true,
    },
  },
  driverProfile: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      vehicleType: true,
      vehicleRegistration: true,
      rating: true,
    },
  },
  history: {
    orderBy: { createdAt: 'asc' as const },
  },
  tryAndBuySession: true,
};

@Injectable()
export class VendorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly orderTransition: OrderTransitionService,
    @Optional() private readonly firebaseAdmin?: FirebaseAdminService,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async resolveVendor(userId: string, role: string) {
    if (role === Role.ADMIN) {
      return null;
    }
    const vendor = await this.prisma.vendor.findFirst({ where: { userId } });
    if (!vendor) {
      throw new ForbiddenException('Vendor store account is not linked to your user profile');
    }
    return vendor;
  }

  private async getAuthorizedOrder(userId: string, role: string, orderId: string) {
    this.ensureDbConnected();
    const vendor = await this.resolveVendor(userId, role);
    const cleanId = orderId.trim().replace(/^#/, '');

    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }] },
      include: VENDOR_ORDER_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException(`Order '${orderId}' not found`);
    }

    if (vendor && order.vendorId !== vendor.id) {
      throw new ForbiddenException('Order does not belong to your vendor store');
    }

    return order;
  }

  async loginFirebase(idToken: string) {
    if (!idToken) {
      throw new BadRequestException('Firebase ID token is required');
    }
    if (!this.firebaseAdmin) {
      throw new UnauthorizedException('Firebase authentication is not configured on this server');
    }
    this.ensureDbConnected();

    const decoded = await this.firebaseAdmin.verifyIdToken(idToken);
    if (!decoded || !decoded.uid) {
      throw new UnauthorizedException('Invalid Firebase ID token');
    }

    const emailNormalized = decoded.email ? decoded.email.trim().toLowerCase() : null;
    const phoneCandidates = buildPhoneLookupCandidates(decoded.phoneNumber);
    const orClauses: any[] = [{ firebaseUid: decoded.uid }];
    if (emailNormalized) orClauses.push({ email: emailNormalized });
    if (phoneCandidates.length > 0) {
      orClauses.push(...phoneCandidates.map((p) => ({ phone: p })));
    }

    let user = await this.prisma.user.findFirst({
      where: { OR: orClauses },
      include: { vendor: true },
    });

    if (!user || (user.role !== Role.VENDOR && user.role !== Role.ADMIN)) {
      throw new ForbiddenException('No active vendor account is linked to this Firebase user');
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Vendor account is inactive or suspended');
    }
    if (!user.vendor && user.role !== Role.ADMIN) {
      throw new ForbiddenException('Vendor store profile not found for this account');
    }
    if (user.vendor && user.vendor.status === 'SUSPENDED') {
      throw new ForbiddenException('Vendor store has been suspended by administration');
    }

    if (user.firebaseUid.startsWith('fb-') && decoded.uid !== user.firebaseUid) {
      const uidTaken = await this.prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
      if (!uidTaken) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { firebaseUid: decoded.uid },
          include: { vendor: true },
        });
      }
    }

    const vendor = user.vendor;
    const token = createJwtToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      vendorId: vendor?.id,
    });

    return {
      success: true,
      token,
      role: user.role,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        vendorId: vendor?.id || null,
      },
      vendor: vendor
        ? {
            id: vendor.id,
            storeName: vendor.storeName,
            status: vendor.status,
            operatingHub: vendor.operatingHub,
            category: vendor.category,
          }
        : null,
    };
  }

  async getProfile(userId: string) {
    this.ensureDbConnected();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { vendor: true },
    });
    if (!user || (user.role !== Role.VENDOR && user.role !== Role.ADMIN)) {
      throw new ForbiddenException('Vendor profile not found');
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is inactive or suspended');
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        role: user.role,
        vendorId: user.vendor?.id || null,
      },
      vendor: user.vendor,
    };
  }

  async updateProfile(
    userId: string,
    dto: { name?: string; phone?: string; storeName?: string; contactPerson?: string; address?: string },
  ) {
    this.ensureDbConnected();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { vendor: true },
    });
    if (!user || (user.role !== Role.VENDOR && user.role !== Role.ADMIN)) {
      throw new ForbiddenException('Vendor profile not found');
    }

    const userData: Record<string, any> = {};
    if (dto.name !== undefined && dto.name.trim()) {
      userData.name = dto.name.trim();
    }
    if (dto.phone !== undefined) {
      userData.phone = dto.phone.trim() || null;
    }

    const updatedUser =
      Object.keys(userData).length > 0
        ? await this.prisma.user.update({ where: { id: user.id }, data: userData })
        : user;

    let updatedVendor = user.vendor;
    if (user.vendor) {
      const vendorData: Record<string, any> = {};
      if (dto.storeName !== undefined && dto.storeName.trim()) {
        vendorData.storeName = dto.storeName.trim();
      }
      if (dto.contactPerson !== undefined && dto.contactPerson.trim()) {
        vendorData.contactPerson = dto.contactPerson.trim();
      }
      if (dto.address !== undefined && dto.address.trim()) {
        vendorData.address = dto.address.trim();
      }
      if (dto.phone !== undefined && dto.phone.trim()) {
        vendorData.phone = dto.phone.trim();
      }
      if (Object.keys(vendorData).length > 0) {
        updatedVendor = await this.prisma.vendor.update({
          where: { id: user.vendor.id },
          data: vendorData,
        });
      }
    }

    return {
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        role: updatedUser.role,
        vendorId: updatedVendor?.id || null,
      },
      vendor: updatedVendor,
    };
  }

  async logout(userId: string) {
    this.ensureDbConnected();
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          userRole: Role.VENDOR,
          action: 'VENDOR_LOGOUT',
          entityType: 'VendorAuth',
          entityId: userId,
          details: 'Vendor explicitly signed out of session',
        },
      })
      .catch(() => undefined);

    return {
      success: true,
      message: 'Signed out cleanly',
    };
  }

  async getOrders(userId: string, role: string, status?: string) {
    this.ensureDbConnected();
    const vendor = await this.resolveVendor(userId, role);

    const where: any = {};
    if (vendor) {
      where.vendorId = vendor.id;
    }
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: VENDOR_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return {
      vendorId: vendor?.id || null,
      storeName: vendor?.storeName || 'Affordz Operations Store',
      orders: orders.map((o) => this.ordersService.formatOrderResponse(o, role, userId)),
    };
  }

  async getOrderById(userId: string, role: string, orderId: string) {
    const order = await this.getAuthorizedOrder(userId, role, orderId);
    return this.ordersService.formatOrderResponse(order, role, userId);
  }

  async acceptOrder(userId: string, role: string, orderId: string) {
    const order = await this.getAuthorizedOrder(userId, role, orderId);
    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'ACCEPTED',
      actorRole: role === Role.ADMIN ? Role.ADMIN : Role.VENDOR,
      actorId: userId,
      note: 'Vendor accepted order',
      auditAction: 'VENDOR_ORDER_ACCEPTED',
    });
    return this.ordersService.formatOrderResponse(updated, role, userId);
  }

  async prepareOrder(userId: string, role: string, orderId: string) {
    const order = await this.getAuthorizedOrder(userId, role, orderId);
    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'PREPARING',
      actorRole: role === Role.ADMIN ? Role.ADMIN : Role.VENDOR,
      actorId: userId,
      note: 'Vendor started packing order',
      auditAction: 'VENDOR_ORDER_PREPARING',
    });
    return this.ordersService.formatOrderResponse(updated, role, userId);
  }

  async readyForPickup(userId: string, role: string, orderId: string) {
    const order = await this.getAuthorizedOrder(userId, role, orderId);
    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'READY_FOR_PICKUP',
      actorRole: role === Role.ADMIN ? Role.ADMIN : Role.VENDOR,
      actorId: userId,
      note: 'Packed and ready at counter for manual Admin rider assignment',
      auditAction: 'VENDOR_ORDER_READY_FOR_PICKUP',
    });
    return this.ordersService.formatOrderResponse(updated, role, userId);
  }

  async rejectOrder(
    userId: string,
    role: string,
    orderId: string,
    reason?: string,
    expectedVersion?: number,
  ) {
    const order = await this.getAuthorizedOrder(userId, role, orderId);
    const rejectNote = reason?.trim() || 'Rejected by vendor before acceptance';
    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'CANCELLED',
      actorRole: role === Role.ADMIN ? Role.ADMIN : Role.VENDOR,
      actorId: userId,
      note: rejectNote,
      expectedVersion,
      auditAction: 'VENDOR_ORDER_REJECTED',
      extraOrderUpdate: {
        rejectedByVendor: true,
        cancellationReason: rejectNote,
      },
    });
    return this.ordersService.formatOrderResponse(updated, role, userId);
  }
}
