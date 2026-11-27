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
import { HomeContentService } from '../home-content/home-content.service';
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
    @Optional() private readonly homeContentService?: HomeContentService,
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

  async getStoreStatus(userId: string) {
    this.ensureDbConnected();
    const vendor = await this.prisma.vendor.findFirst({
      where: { userId },
      include: {
        categoryCommissions: { include: { category: true } },
      },
    });
    if (!vendor) {
      throw new ForbiddenException('Vendor store not linked to user');
    }

    let isCurrentlyOpen = vendor.isOnline;
    if (vendor.isOnline && vendor.autoScheduleEnabled && vendor.operatingHours) {
      const hoursMap = vendor.operatingHours as Record<string, any>;
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const currentDay = days[new Date().getDay()];
      const todaySchedule = hoursMap[currentDay];
      if (todaySchedule && todaySchedule.isOpen === false) {
        isCurrentlyOpen = false;
      }
    }

    return {
      vendorId: vendor.id,
      storeName: vendor.storeName,
      isOnline: vendor.isOnline,
      isCurrentlyOpen,
      autoScheduleEnabled: vendor.autoScheduleEnabled,
      operatingHours: vendor.operatingHours,
      notificationEmail: vendor.notificationEmail,
      categoryCommissions: vendor.categoryCommissions.map((cc) => ({
        id: cc.id,
        categoryId: cc.categoryId,
        categoryName: cc.category?.name || cc.categoryId,
        commissionRate: cc.commissionRate,
      })),
    };
  }

  async toggleStoreStatus(userId: string, isOnline: boolean) {
    this.ensureDbConnected();
    const vendor = await this.prisma.vendor.findFirst({ where: { userId } });
    if (!vendor) {
      throw new ForbiddenException('Vendor store not linked to user');
    }

    const updated = await this.prisma.vendor.update({
      where: { id: vendor.id },
      data: { isOnline: Boolean(isOnline) },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        userRole: Role.VENDOR,
        action: 'VENDOR_STORE_STATUS_TOGGLED',
        entityType: 'Vendor',
        entityId: vendor.id,
        details: JSON.stringify({ previousStatus: vendor.isOnline, newStatus: updated.isOnline }),
      },
    });

    return {
      success: true,
      isOnline: updated.isOnline,
      message: updated.isOnline
        ? 'Store is now online and accepting orders.'
        : 'Store is now offline. Products will appear unavailable.',
    };
  }

  async updateOperatingHours(userId: string, body: { operatingHours: any; autoScheduleEnabled?: boolean }) {
    this.ensureDbConnected();
    const vendor = await this.prisma.vendor.findFirst({ where: { userId } });
    if (!vendor) {
      throw new ForbiddenException('Vendor store not linked to user');
    }

    const updated = await this.prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        operatingHours: body.operatingHours,
        autoScheduleEnabled: body.autoScheduleEnabled !== undefined ? Boolean(body.autoScheduleEnabled) : undefined,
      },
    });

    return {
      success: true,
      operatingHours: updated.operatingHours,
      autoScheduleEnabled: updated.autoScheduleEnabled,
      message: 'Store operating hours saved successfully.',
    };
  }

  async getFinanceOverview(userId: string) {
    this.ensureDbConnected();
    const vendor = await this.prisma.vendor.findFirst({
      where: { userId },
      include: {
        categoryCommissions: { include: { category: true } },
        ledgerEntries: { orderBy: { createdAt: 'desc' } },
        payouts: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!vendor) {
      throw new ForbiddenException('Vendor store not linked to user');
    }

    let grossRevenue = 0;
    let commissionClaimed = 0;
    let netPayoutPayable = 0;

    for (const e of vendor.ledgerEntries) {
      if (e.entryType === 'ORDER_REVENUE') {
        grossRevenue += Number(e.amount) || 0;
      } else if (e.entryType === 'COMMISSION_DEDUCTED') {
        commissionClaimed += Math.abs(Number(e.amount) || 0);
      } else if (e.entryType === 'VENDOR_PAYOUT') {
        netPayoutPayable += Number(e.amount) || 0;
      }
    }

    const settledPayouts = vendor.payouts
      .filter((p) => p.status === 'SETTLED' || p.status === 'COMPLETED')
      .reduce((sum, p) => sum + p.amount, 0);

    const pendingBalance = Math.max(0, netPayoutPayable - settledPayouts);

    return {
      vendorId: vendor.id,
      storeName: vendor.storeName,
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      commissionClaimed: Math.round(commissionClaimed * 100) / 100,
      netEarnings: Math.round(netPayoutPayable * 100) / 100,
      settledPayouts: Math.round(settledPayouts * 100) / 100,
      pendingBalance: Math.round(pendingBalance * 100) / 100,
      bankDetails: vendor.bankDetails,
      categoryCommissions: vendor.categoryCommissions.map((cc) => ({
        categoryId: cc.categoryId,
        categoryName: cc.category?.name || cc.categoryId,
        commissionRate: cc.commissionRate,
      })),
      recentTransactions: vendor.ledgerEntries.slice(0, 20).map((e) => ({
        id: e.id,
        orderId: e.orderId,
        entryType: e.entryType,
        amount: e.amount,
        description: e.description,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async getProducts(userId: string, role: string, query?: any) {
    this.ensureDbConnected();
    const vendor = await this.resolveVendor(userId, role);
    const where: any = {};
    if (vendor) {
      where.vendorId = vendor.id;
    }
    if (query?.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { brand: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query?.categoryId) {
      where.categoryId = query.categoryId;
    }

    const products = await this.prisma.product.findMany({
      where,
      include: {
        category: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      vendorId: vendor?.id || null,
      storeName: vendor?.storeName || 'Affordz Vendor',
      total: products.length,
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        brand: p.brand,
        categoryId: p.categoryId,
        categoryName: p.category?.name || 'Category',
        price: p.price,
        originalPrice: p.originalPrice,
        discount: p.discount,
        stockQuantity: p.stockQuantity,
        listingStatus: p.listingStatus,
        image: p.image,
        sizes: p.sizes,
        fulfillmentType: p.fulfillmentType,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  async createProduct(userId: string, role: string, body: any) {
    this.ensureDbConnected();
    const vendor = await this.resolveVendor(userId, role);
    if (!vendor) {
      throw new ForbiddenException('Vendor store not linked to user');
    }

    const product = await this.prisma.product.create({
      data: {
        vendorId: vendor.id,
        fulfillmentType: 'VENDOR',
        categoryId: body.categoryId,
        title: body.title,
        brand: body.brand || vendor.storeName,
        description: body.description || '',
        price: Number(body.price),
        originalPrice: Number(body.originalPrice || body.price),
        discount: body.discount || '0% OFF',
        stockQuantity: Number(body.stockQuantity || 10),
        listingStatus: body.listingStatus || 'ACTIVE',
        sizes: Array.isArray(body.sizes) && body.sizes.length > 0 ? body.sizes : ['Free Size'],
        image: body.image || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
        altText: body.title,
        galleryImages: Array.isArray(body.galleryImages) ? body.galleryImages : [],
        tags: Array.isArray(body.tags) ? body.tags : [],
        readyToShip: true,
      },
      include: { category: true },
    });

    return {
      success: true,
      message: `Product "${product.title}" created successfully.`,
      product,
    };
  }

  async updateProductStatus(userId: string, role: string, productId: string, status: string) {
    this.ensureDbConnected();
    const vendor = await this.resolveVendor(userId, role);
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (vendor && product.vendorId !== vendor.id) {
      throw new ForbiddenException('Product does not belong to your boutique');
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { listingStatus: status },
    });
    return { success: true, product: updated };
  }

  async updateProductStock(userId: string, role: string, productId: string, stock: number) {
    this.ensureDbConnected();
    const vendor = await this.resolveVendor(userId, role);
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (vendor && product.vendorId !== vendor.id) {
      throw new ForbiddenException('Product does not belong to your boutique');
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { stockQuantity: Number(stock) },
    });
    return { success: true, product: updated };
  }

  // --- Promotional Banners ---

  async getBanners(userId: string, role: string) {
    this.ensureDbConnected();
    const vendor = await this.resolveVendor(userId, role);
    const where: any = vendor ? { vendorId: vendor.id } : { vendorId: { not: null } };

    const banners = await this.prisma.homeBanner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: { select: { id: true, storeName: true } },
      },
    });

    return {
      vendorId: vendor?.id || null,
      storeName: vendor?.storeName || 'All Vendors',
      banners,
    };
  }

  async createBanner(
    userId: string,
    role: string,
    body: {
      title?: string;
      title1?: string;
      subtitle?: string;
      title2?: string;
      discountText?: string;
      imageUrl: string;
      placement?: string;
      targetGender?: string;
      tag?: string;
      actionType?: string;
      actionValue?: string;
    },
  ) {
    this.ensureDbConnected();
    const vendor = await this.resolveVendor(userId, role);
    if (!vendor) {
      throw new ForbiddenException('Vendor store account is required to submit a promotional banner.');
    }

    const title1 = String(body.title || body.title1 || '').trim();
    const imageUrl = String(body.imageUrl || '').trim();
    if (!title1) {
      throw new BadRequestException('Banner title is required.');
    }
    if (!imageUrl) {
      throw new BadRequestException('Banner image URL is required.');
    }

    const validPlacements = new Set(['HERO_CAROUSEL', 'EDITORIAL_STRIP', 'MODERN_REDEFINED']);
    const placement = validPlacements.has(String(body.placement || ''))
      ? (body.placement as any)
      : 'HERO_CAROUSEL';

    const validActions = new Set(['CATEGORY', 'PRODUCT', 'BRAND', 'SEARCH_QUERY', 'NONE']);
    const actionType = validActions.has(String(body.actionType || ''))
      ? (body.actionType as any)
      : 'BRAND';

    const discountText = body.discountText ? String(body.discountText).trim() : null;
    const tag = body.tag ? String(body.tag).trim() : discountText || vendor.storeName.toUpperCase();

    const banner = await this.prisma.homeBanner.create({
      data: {
        vendorId: vendor.id,
        placement,
        tag,
        title1,
        title2: body.subtitle || body.title2 ? String(body.subtitle || body.title2).trim() : null,
        discountText,
        imageUrl,
        targetGender: body.targetGender || 'All',
        actionType,
        actionValue: body.actionValue ? String(body.actionValue).trim() : vendor.storeName,
        status: 'PENDING',
        isActive: false,
        displayOrder: 100,
      },
      include: {
        vendor: { select: { id: true, storeName: true } },
      },
    });

    await this.prisma.recordAuditEvent({
      actorId: userId,
      actorName: vendor.storeName,
      actionType: 'VENDOR_BANNER_SUBMITTED',
      entityId: banner.id,
      entityType: 'HomeBanner',
      summary: `Vendor ${vendor.storeName} submitted banner "${banner.title1}" for admin approval`,
    });

    return {
      success: true,
      message: 'Banner submitted for admin approval.',
      banner,
    };
  }

  async deleteBanner(userId: string, role: string, bannerId: string) {
    this.ensureDbConnected();
    const vendor = await this.resolveVendor(userId, role);
    const existing = await this.prisma.homeBanner.findUnique({ where: { id: bannerId } });
    if (!existing) {
      throw new NotFoundException(`Banner '${bannerId}' not found.`);
    }
    if (vendor && existing.vendorId !== vendor.id) {
      throw new ForbiddenException('Banner does not belong to your store.');
    }

    await this.prisma.homeBanner.delete({ where: { id: bannerId } });
    if (existing.status === 'APPROVED' && this.homeContentService) {
      await this.homeContentService.invalidateLayoutCache().catch(() => {});
    }

    return { success: true, message: 'Banner deleted.' };
  }
}
