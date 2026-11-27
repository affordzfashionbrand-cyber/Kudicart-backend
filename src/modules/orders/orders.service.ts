import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  Optional,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachineService } from './state-machine.service';
import { DeliveryAssignmentService } from './delivery-assignment.service';
import { OrderTransitionService } from './order-transition.service';
import { RazorpayClientService } from '../payments/razorpay-client.service';
import { CartService } from '../cart/cart.service';
import { GoogleRoutesService } from './google-routes.service';
import { TrackingRealtimeGateway } from './tracking-realtime.gateway';
import { QueueService } from '../queue/queue.service';
import { QueueJobType } from '../queue/queue.constants';
import { CheckoutDto } from './dto/checkout.dto';
import { Role } from '../../common/enums/role.enum';
import { EmailService } from '../notifications/email.service';
import {
  CheckoutResponseContract,
  DeliveryAssignmentStatus,
  LIVE_TRACKING_ACTIVE_STATUSES,
  OrderContract,
  OrderStatus,
  TERMINAL_ORDER_STATUSES,
  TryAndBuyDecision,
  getCustomerOrderStatusLabel,
} from '../../common/contracts/order-contracts';
import {
  GIFT_WRAP_FEE,
  INCLUSIVE_GST_RATE,
  MAX_DARK_STORE_RADIUS_KM,
  allocateProRata,
  computeInclusiveGstBreakdown,
  computeSplitOrderTotals,
  computeTryAndBuyFinancials,
  haversineDistanceKm,
} from './order-pricing.util';
import { deriveCustomerOrderOtp, hashOrderOtp } from './order-otp.util';
import { createCheckoutSessionToken } from '../../common/utils/checkout-session.util';

const CHECKOUT_PRODUCT_ID_ALIASES: Record<string, string> = {
  '101': 'prod-2',
  '102': 'prod-1',
  '103': 'prod-3',
  '104': 'prod-5',
  '105': 'prod-6',
  '106': 'prod-4',
  '107': 'prod-10',
  '108': 'prod-7',
  '1': 'prod-1',
  '2': 'prod-5',
  '3': 'prod-9',
  '4': 'prod-6',
  '9': 'prod-4',
};

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const ORDER_WITH_RELATIONS = {
  items: true,
  history: { orderBy: { createdAt: 'asc' as const } },
  address: true,
  vendor: {
    include: {
      user: true,
      categoryCommissions: true,
    },
  },
  driver: {
    select: {
      id: true,
      name: true,
      phone: true,
      avatar: true,
      driverProfile: true,
    },
  },
  driverProfile: true,
  tryAndBuySession: true,
  dispatchAssignment: true,
  checkoutGroup: true,
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: StateMachineService,
    private readonly orderTransition: OrderTransitionService,
    private readonly razorpayClient: RazorpayClientService,
    private readonly cartService: CartService,
    @Optional() private readonly googleRoutesService?: GoogleRoutesService,
    @Optional() private readonly trackingGateway?: TrackingRealtimeGateway,
    @Optional() private readonly queueService?: QueueService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly deliveryAssignment?: DeliveryAssignmentService,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async resolveVendorIdForUser(userId?: string, explicitVendorId?: string): Promise<string | null> {
    if (explicitVendorId) return explicitVendorId;
    if (!userId) return null;
    const vendor = await this.prisma.vendor.findFirst({ where: { userId } });
    return vendor?.id || null;
  }

  private async resolveDriverProfileIdForUser(userId?: string, explicitDriverId?: string): Promise<string | null> {
    if (explicitDriverId) return explicitDriverId;
    if (!userId) return null;
    const profile = await this.prisma.driverProfile.findFirst({ where: { userId } });
    return profile?.id || null;
  }

  private async assertOrderAccess(
    order: any,
    userId?: string,
    role?: string,
    driverId?: string,
    vendorId?: string,
  ) {
    if (!role || role === Role.ADMIN) return;

    if (role === Role.CUSTOMER) {
      if (!userId || order.customerId !== userId) {
        throw new ForbiddenException('You do not have permission to access this order');
      }
      return;
    }

    if (role === Role.DRIVER) {
      const effectiveDriverProfileId = await this.resolveDriverProfileIdForUser(userId, driverId);
      const matchesDriverUser = userId && order.driverId === userId;
      const matchesDriverProfile =
        effectiveDriverProfileId &&
        (order.driverProfileId === effectiveDriverProfileId || order.driverId === effectiveDriverProfileId);
      if (!matchesDriverUser && !matchesDriverProfile) {
        throw new ForbiddenException('Order is not assigned to your driver account');
      }
      return;
    }

    if (role === Role.VENDOR) {
      const effectiveVendorId = await this.resolveVendorIdForUser(userId, vendorId);
      if (!effectiveVendorId || order.vendorId !== effectiveVendorId) {
        throw new ForbiddenException('Order does not belong to your vendor store');
      }
      return;
    }

    throw new ForbiddenException('Unsupported role for order access');
  }

  public formatOrderResponse(order: any, viewerRole?: string, viewerUserId?: string): OrderContract & {
    driverName?: string | null;
    driverPhone?: string | null;
    handoverOtp?: string;
    history?: any[];
    vendor?: any;
  } {
    const isTerminal = TERMINAL_ORDER_STATUSES.includes(order.status as OrderStatus);
    const isVendorViewer = viewerRole === Role.VENDOR;
    const shouldExposeOtp =
      viewerRole === Role.CUSTOMER &&
      viewerUserId &&
      order.customerId === viewerUserId &&
      !isTerminal &&
      Boolean(order.deliveryOtpHash);

    const formattedDeliveryAddress = isVendorViewer && order.deliveryAddress
      ? {
          area: order.deliveryAddress.area || order.deliveryAddress.locality || 'Delivery Area',
          city: order.deliveryAddress.city || 'Mumbai',
          state: order.deliveryAddress.state || 'Maharashtra',
          postalCode: order.deliveryAddress.postalCode || '400050',
        }
      : order.deliveryAddress ?? null;

    const formatted: any = {
      id: order.id,
      orderNumber: order.orderNumber,
      version: order.version ?? 1,
      checkoutGroupId: order.checkoutGroupId ?? null,
      customerId: isVendorViewer ? undefined : order.customerId,
      customerName: isVendorViewer
        ? `Customer #${order.orderNumber ? String(order.orderNumber).slice(-4) : 'KC'}`
        : (order.customer?.name || order.deliveryAddress?.recipientName || undefined),
      vendorId: order.vendorId ?? null,
      vendorName: order.vendor?.storeName || undefined,
      driverId: order.driverId ?? null,
      driverProfileId: order.driverProfileId ?? null,
      driverName: order.driverProfile?.fullName || order.driver?.name || null,
      driverPhone: order.driverProfile?.phone || order.driver?.phone || null,
      driverVehicle: order.driverProfile?.vehicleRegistration
        ? `${order.driverProfile.vehicleType || 'Vehicle'} (${order.driverProfile.vehicleRegistration})`
        : (order.driverProfile?.vehicleType || null),
      fulfillmentType: order.fulfillmentType || 'DARK_STORE',
      orderType: order.orderType || (order.isTryAndBuy ? 'TRY_AND_BUY' : 'STANDARD'),
      status: order.status,
      deliveryAssignmentStatus: (order.deliveryAssignmentStatus || 'NOT_ASSIGNED') as DeliveryAssignmentStatus,
      assignmentFailureReason: order.assignmentFailureReason ?? null,
      customerStatusLabel: getCustomerOrderStatusLabel(order.status, order.isTryAndBuy),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      razorpayOrderId: order.razorpayOrderId ?? null,
      razorpayPaymentId: order.razorpayPaymentId ?? null,
      itemTotal: Math.round(order.itemTotal || 0),
      deliveryFee: Math.round(order.deliveryFee || 0),
      taxes: Math.round(order.taxes || 0),
      giftWrapFee: Math.round(order.giftWrapFee || 0),
      donationAmount: Math.round(order.donationAmount || 0),
      discountAmount: Math.round(order.discountAmount || 0),
      couponCode: order.couponCode ?? null,
      grandTotal: Math.round(order.grandTotal || 0),
      etaMinutes: order.etaMinutes ?? 0,
      isTryAndBuy: Boolean(order.isTryAndBuy),
      deliveryInstructions: order.deliveryInstructions ?? null,
      needGstInvoice: Boolean(order.needGstInvoice),
      customerGstin: order.customerGstin ?? null,
      gstBusinessName: order.gstBusinessName ?? null,
      verificationPhotos: Array.isArray(order.verificationPhotos) ? order.verificationPhotos : [],
      deliveryAddress: formattedDeliveryAddress,
      acceptedAt: order.acceptedAt ? new Date(order.acceptedAt).toISOString() : null,
      packingStartedAt: order.packingStartedAt ? new Date(order.packingStartedAt).toISOString() : null,
      readyForPickupAt: order.readyForPickupAt ? new Date(order.readyForPickupAt).toISOString() : null,
      pickedUpAt: order.pickedUpAt ? new Date(order.pickedUpAt).toISOString() : null,
      pickedUpByDriverId: order.pickedUpByDriverId ?? null,
      tryAndBuyStartedAt: order.tryAndBuyStartedAt ? new Date(order.tryAndBuyStartedAt).toISOString() : null,
      arrivedAt: order.arrivedAt ? new Date(order.arrivedAt).toISOString() : null,
      deliveredAt: order.deliveredAt ? new Date(order.deliveredAt).toISOString() : null,
      returnedAt: order.returnedAt ? new Date(order.returnedAt).toISOString() : null,
      returnReason: order.returnReason ?? null,
      cancelledAt: order.cancelledAt ? new Date(order.cancelledAt).toISOString() : null,
      cancellationReason: order.cancellationReason ?? null,
      rejectedByVendor: Boolean(order.rejectedByVendor),
      expiresAt: order.expiresAt ? new Date(order.expiresAt).toISOString() : null,
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: order.updatedAt ? new Date(order.updatedAt).toISOString() : new Date().toISOString(),
      items: (order.items || []).map((item: any) => ({
        id: item.id,
        productId: item.productId,
        title: item.title,
        brand: item.brand,
        size: item.size,
        trialSize: item.trialSize ?? null,
        price: Math.round(item.price || 0),
        quantity: item.quantity || 1,
        image: item.image,
        tryAndBuyDecision: (item.tryAndBuyDecision as TryAndBuyDecision) ?? null,
        returnCondition: item.returnCondition ?? null,
        collectedAt: item.collectedAt ? new Date(item.collectedAt).toISOString() : null,
      })),
      tryAndBuySession: order.tryAndBuySession
        ? {
            id: order.tryAndBuySession.id,
            orderId: order.tryAndBuySession.orderId,
            stage: order.tryAndBuySession.stage,
            trialDurationMinutes: order.tryAndBuySession.trialDurationMinutes,
            handoverConfirmedAt: order.tryAndBuySession.handoverConfirmedAt?.toISOString?.() ?? null,
            trialStartedAt: order.tryAndBuySession.trialStartedAt?.toISOString?.() ?? null,
            trialEndsAt: order.tryAndBuySession.trialEndsAt?.toISOString?.() ?? null,
            customerSelectionAt: order.tryAndBuySession.customerSelectionAt?.toISOString?.() ?? null,
            finalPayableTotal: order.tryAndBuySession.finalPayableTotal ?? null,
            refundAmount: order.tryAndBuySession.refundAmount ?? null,
            amountDue: order.tryAndBuySession.amountDue ?? null,
            paymentStatus: order.tryAndBuySession.paymentStatus ?? null,
            returnManifestId: order.tryAndBuySession.returnManifestId ?? null,
            keptItemIds: order.tryAndBuySession.keptItemIds || [],
            returnedItemIds: order.tryAndBuySession.returnedItemIds || [],
            handoverImages: order.tryAndBuySession.handoverImages || [],
            returnImages: order.tryAndBuySession.returnImages || [],
            storeReconciliationStatus: order.tryAndBuySession.storeReconciliationStatus ?? null,
            storeReconciledAt: order.tryAndBuySession.storeReconciledAt?.toISOString?.() ?? null,
          }
        : null,
      dispatchAssignment: order.dispatchAssignment
        ? {
            id: order.dispatchAssignment.id,
            orderId: order.dispatchAssignment.orderId,
            driverProfileId: order.dispatchAssignment.driverProfileId ?? null,
            status: order.dispatchAssignment.status,
            assignmentStatus: order.dispatchAssignment.assignmentStatus || order.deliveryAssignmentStatus || 'NOT_ASSIGNED',
            assignmentSource: order.dispatchAssignment.assignmentSource || 'AUTO',
            offeredAt: order.dispatchAssignment.offeredAt?.toISOString?.() ?? null,
            acceptedAt: order.dispatchAssignment.acceptedAt?.toISOString?.() ?? null,
            rejectedAt: order.dispatchAssignment.rejectedAt?.toISOString?.() ?? null,
            rejectionReason: order.dispatchAssignment.rejectionReason ?? null,
            failureReason: order.dispatchAssignment.failureReason ?? null,
            completedAt: order.dispatchAssignment.completedAt?.toISOString?.() ?? null,
            attempts: order.dispatchAssignment.attempts ?? 0,
          }
        : null,
      history: (order.history || []).map((h: any) => ({
        id: h.id,
        status: h.status,
        note: h.note,
        actorId: h.actorId ?? null,
        actorRole: h.actorRole ?? null,
        createdAt: h.createdAt ? new Date(h.createdAt).toISOString() : null,
      })),
    };

    if (shouldExposeOtp) {
      formatted.handoverOtp = deriveCustomerOrderOtp(order.id);
    }

    return formatted;
  }

  async checkout(
    userId: string,
    dto: CheckoutDto,
    idempotencyKey?: string,
  ): Promise<CheckoutResponseContract> {
    this.ensureDbConnected();

    const cleanGstin = dto.customerGstin?.trim().toUpperCase() || null;
    const cleanGstBusinessName = dto.gstBusinessName?.trim() || null;
    const needGstInvoice = Boolean(dto.needGstInvoice || cleanGstin || cleanGstBusinessName);
    if (cleanGstin && !GSTIN_REGEX.test(cleanGstin)) {
      throw new BadRequestException(
        'Invalid GSTIN format. Please enter a valid 15-character GSTIN (e.g. 29AABCU9603R1ZM).',
      );
    }

    const cleanIdempotencyKey = idempotencyKey?.trim();
    const requestHash = cleanIdempotencyKey
      ? crypto
          .createHash('sha256')
          .update(
            JSON.stringify({
              addressId: dto.addressId,
              paymentMethod: dto.paymentMethod,
              couponCode: dto.couponCode?.trim().toUpperCase() || null,
              isTryAndBuy: Boolean(dto.isTryAndBuy),
              isBuyNow: Boolean(dto.isBuyNow),
              giftWrap: dto.giftWrap ?? null,
              donationAmount: dto.donationAmount ?? null,
              deliveryInstructions: dto.deliveryInstructions?.trim() || null,
              needGstInvoice,
              customerGstin: cleanGstin,
              gstBusinessName: cleanGstBusinessName,
              buyNowItem: dto.buyNowItem || null,
              items: dto.items || null,
            }),
          )
          .digest('hex')
      : null;

    if (cleanIdempotencyKey && requestHash) {
      const cached = await this.prisma.idempotencyKey.findUnique({
        where: {
          userId_scope_key: {
            userId,
            scope: 'CHECKOUT',
            key: cleanIdempotencyKey,
          },
        },
      });
      if (cached && cached.expiresAt > new Date()) {
        if (cached.requestHash !== requestHash) {
          throw new ConflictException(
            'Idempotency-Key was already used with a different checkout payload',
          );
        }
        return cached.responseBody as unknown as CheckoutResponseContract;
      }
    }

    const address = await this.prisma.address.findFirst({
      where: { id: dto.addressId, userId },
    });
    if (!address) {
      throw new NotFoundException('Delivery address not found for your account');
    }

    // Resolve authoritative line items strictly from server Catalog DB (never trust client price/totals)
    const rawRequestedItems: Array<{
      productId: string;
      size?: string;
      trialSize?: string | null;
      quantity: number;
    }> = [];

    let loadedCart: any = null;

    if (dto.isBuyNow) {
      const sourceItems =
        Array.isArray(dto.items) && dto.items.length > 0
          ? dto.items
          : dto.buyNowItem
            ? [dto.buyNowItem]
            : [];
      if (sourceItems.length === 0) {
        throw new BadRequestException('Buy Now requires at least one product item');
      }
      for (const item of sourceItems) {
        const rawPid = String(item.productId || '').trim();
        const mappedPid = CHECKOUT_PRODUCT_ID_ALIASES[rawPid] || rawPid;
        rawRequestedItems.push({
          productId: mappedPid,
          size: item.size,
          trialSize: item.trialSize ?? null,
          quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
        });
      }
    } else {
      loadedCart = await this.prisma.cart.findFirst({
        where: { userId },
        include: { items: true },
      });
      if (!loadedCart || loadedCart.items.length === 0) {
        throw new BadRequestException('Your shopping bag is empty');
      }
      for (const item of loadedCart.items) {
        rawRequestedItems.push({
          productId: item.productId,
          size: item.size,
          trialSize: item.trialSize ?? null,
          quantity: Math.max(1, item.quantity),
        });
      }
    }

    const productIds = Array.from(new Set(rawRequestedItems.map((i) => i.productId)));
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: {
        vendor: {
          include: {
            user: true,
            categoryCommissions: true,
          },
        },
        darkStoreHub: true,
        category: true,
      },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const resolvedItems = rawRequestedItems.map((reqItem) => {
      const product = productMap.get(reqItem.productId);
      if (!product) {
        throw new NotFoundException(`Product '${reqItem.productId}' not found`);
      }

      if (product.fulfillmentType === 'VENDOR' && product.vendor) {
        if (product.vendor.isOnline === false) {
          throw new BadRequestException(
            `Product "${product.title}" is currently unavailable because boutique "${product.vendor.storeName}" is offline. Please check back when vendor is online.`,
          );
        }
      }

      if (product.fulfillmentType === 'DARK_STORE') {
        if (address.latitude == null || address.longitude == null) {
          throw new BadRequestException(
            'Delivery address coordinates (latitude and longitude) are required for Dark Store express checkout.',
          );
        }
        if (product.darkStoreHub?.lat != null && product.darkStoreHub?.lng != null) {
          const distKm = haversineDistanceKm(
            product.darkStoreHub.lat,
            product.darkStoreHub.lng,
            address.latitude,
            address.longitude,
          );
          if (distKm > MAX_DARK_STORE_RADIUS_KM) {
            throw new BadRequestException(
              `Dark store hub '${product.darkStoreHub.name}' is ${distKm} km away (maximum ${MAX_DARK_STORE_RADIUS_KM} km for express delivery).`,
            );
          }
        }
      }

      let appliedCommissionRate = 0;
      if (product.vendor) {
        const catMatch = product.vendor.categoryCommissions?.find(
          (cc) => cc.categoryId === product.categoryId,
        );
        appliedCommissionRate = catMatch
          ? catMatch.commissionRate
          : (product.vendor.commissionRate ?? 0);
      }
      const itemPrice = Math.round(product.price);
      const commissionAmount =
        Math.round(itemPrice * reqItem.quantity * (appliedCommissionRate / 100) * 100) / 100;

      const normalizedSize = reqItem.size?.trim() || product.sizes?.[0] || 'Free Size';
      const itemTryAndBuyEligible =
        (product.fulfillmentType || 'DARK_STORE') === 'DARK_STORE' &&
        Boolean(product.tryAndBuyEligible);

      return {
        product,
        productId: product.id,
        title: product.title,
        brand: product.brand,
        size: normalizedSize,
        trialSize: dto.isTryAndBuy && itemTryAndBuyEligible ? reqItem.trialSize ?? null : null,
        price: itemPrice,
        quantity: reqItem.quantity,
        image: product.image,
        vendorId: product.vendorId || 'vend-affordz-official',
        fulfillmentType: (product.fulfillmentType || 'DARK_STORE') as 'DARK_STORE' | 'VENDOR',
        etaMinutes:
          product.fulfillmentType === 'VENDOR'
            ? 2880
            : (product.darkStoreHub?.deliveryMinutes ?? 19),
        itemTryAndBuyEligible,
        appliedCommissionRate,
        commissionAmount,
      };
    });

    // Enforce stock availability per unique product
    const qtyByProduct = new Map<string, number>();
    for (const item of resolvedItems) {
      qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) || 0) + item.quantity);
    }

    for (const [productId, requestedQty] of qtyByProduct.entries()) {
      const product = productMap.get(productId)!;
      if (product.stockQuantity < requestedQty) {
        throw new ConflictException(
          `Insufficient stock for '${product.title}'. Requested ${requestedQty}, available ${product.stockQuantity}.`,
        );
      }
    }

    // Group items into split orders by (vendorId, fulfillmentType) per DCR-007
    const groupMap = new Map<
      string,
      {
        key: string;
        vendorId: string;
        fulfillmentType: 'DARK_STORE' | 'VENDOR';
        etaMinutes: number;
        items: typeof resolvedItems;
        itemTotal: number;
        isTryAndBuy: boolean;
      }
    >();

    for (const item of resolvedItems) {
      const key = `${item.vendorId}::${item.fulfillmentType}`;
      let bucket = groupMap.get(key);
      if (!bucket) {
        bucket = {
          key,
          vendorId: item.vendorId,
          fulfillmentType: item.fulfillmentType,
          etaMinutes: item.etaMinutes,
          items: [],
          itemTotal: 0,
          isTryAndBuy: false,
        };
        groupMap.set(key, bucket);
      }
      bucket.items.push(item);
      bucket.itemTotal += item.price * item.quantity;
    }

    const splitBuckets = Array.from(groupMap.values()).sort((a, b) => a.key.localeCompare(b.key));
    for (const bucket of splitBuckets) {
      bucket.isTryAndBuy =
        Boolean(dto.isTryAndBuy) &&
        bucket.fulfillmentType === 'DARK_STORE' &&
        bucket.items.every((it) => it.itemTryAndBuyEligible);
    }

    if (dto.isTryAndBuy) {
      const ineligibleDarkStore = resolvedItems.find(
        (it) => it.fulfillmentType === 'DARK_STORE' && !it.itemTryAndBuyEligible,
      );
      if (ineligibleDarkStore) {
        throw new BadRequestException(
          `Product '${ineligibleDarkStore.title}' is not eligible for Try & Buy.`,
        );
      }
      const tryAndBuyBuckets = splitBuckets.filter((b) => b.isTryAndBuy);
      if (tryAndBuyBuckets.length === 0) {
        throw new BadRequestException(
          'No eligible Dark Store items were found for Try & Buy in this checkout.',
        );
      }
      const tryAndBuyPieces = tryAndBuyBuckets.reduce(
        (acc, b) => acc + b.items.reduce((s, it) => s + it.quantity, 0),
        0,
      );
      if (tryAndBuyPieces > 5) {
        throw new BadRequestException('Try & Buy orders support a maximum of 5 items per checkout.');
      }
    }

    const combinedItemTotal = splitBuckets.reduce((acc, b) => acc + b.itemTotal, 0);

    // Server-side coupon validation (DCR-006)
    let appliedCoupon: any = null;
    let totalDiscountAmount = 0;
    const rawCouponCode = (dto.couponCode ?? (!dto.isBuyNow ? loadedCart?.couponCode : undefined))
      ?.trim()
      .toUpperCase();

    if (rawCouponCode) {
      appliedCoupon = await this.prisma.coupon.findUnique({ where: { code: rawCouponCode } });
      if (!appliedCoupon || !appliedCoupon.isActive) {
        throw new BadRequestException(`Coupon code '${rawCouponCode}' is invalid or inactive`);
      }
      const now = new Date();
      if (now < appliedCoupon.startDate || now > appliedCoupon.endDate) {
        throw new BadRequestException(`Coupon code '${rawCouponCode}' has expired`);
      }
      if (
        appliedCoupon.usageLimit != null &&
        appliedCoupon.usedCount >= appliedCoupon.usageLimit
      ) {
        throw new BadRequestException(`Coupon code '${rawCouponCode}' usage limit has been reached`);
      }
      if (appliedCoupon.perUserLimit != null) {
        const userUsedCount = await this.prisma.couponUsage.count({
          where: { couponId: appliedCoupon.id, userId },
        });
        if (userUsedCount >= appliedCoupon.perUserLimit) {
          throw new BadRequestException(
            `Coupon '${appliedCoupon.code}' has already been used the maximum (${appliedCoupon.perUserLimit}) time(s) on your account`,
          );
        }
      }
      if (combinedItemTotal < appliedCoupon.minOrderValue) {
        throw new BadRequestException(
          `Coupon '${rawCouponCode}' requires minimum order value of ₹${appliedCoupon.minOrderValue}`,
        );
      }

      if (appliedCoupon.discountType === 'PERCENTAGE') {
        totalDiscountAmount = Math.round((combinedItemTotal * appliedCoupon.discountValue) / 100);
        if (appliedCoupon.maxDiscount != null) {
          totalDiscountAmount = Math.min(totalDiscountAmount, Math.round(appliedCoupon.maxDiscount));
        }
      } else {
        totalDiscountAmount = Math.round(appliedCoupon.discountValue);
        if (appliedCoupon.maxDiscount != null) {
          totalDiscountAmount = Math.min(totalDiscountAmount, Math.round(appliedCoupon.maxDiscount));
        }
      }
      totalDiscountAmount = Math.min(combinedItemTotal, Math.max(0, totalDiscountAmount));
    }

    const proRataDiscounts = allocateProRata(
      totalDiscountAmount,
      splitBuckets.map((b) => b.itemTotal),
    );
    const effectiveGiftWrap = dto.giftWrap ?? Boolean(loadedCart?.giftWrap);
    const effectiveDonation = dto.donationAmount ?? loadedCart?.donationAmount ?? 0;
    const totalGiftWrapFee = effectiveGiftWrap ? GIFT_WRAP_FEE : 0;
    const totalDonationAmount = Math.max(0, Math.round(effectiveDonation || 0));

    const splitOrderPlans = splitBuckets.map((bucket, idx) => {
      const orderId = crypto.randomUUID();
      const otpPlain = deriveCustomerOrderOtp(orderId);
      const otpHash = hashOrderOtp(orderId, otpPlain);
      const giftWrapFee = idx === 0 ? totalGiftWrapFee : 0;
      const donationAmount = idx === 0 ? totalDonationAmount : 0;
      const totals = computeSplitOrderTotals({
        items: bucket.items.map((it) => ({ price: it.price, quantity: it.quantity })),
        discountAmount: proRataDiscounts[idx],
        giftWrapFee,
        donationAmount,
      });

      return {
        orderId,
        orderNumber: `KC-${crypto.randomInt(10000, 99999)}-${(Date.now() + idx)
          .toString()
          .slice(-4)}`,
        otpHash,
        bucket,
        totals,
      };
    });

    const groupItemTotal = splitOrderPlans.reduce((a, p) => a + p.totals.itemTotal, 0);
    const groupDiscountTotal = splitOrderPlans.reduce((a, p) => a + p.totals.discountAmount, 0);
    const groupDeliveryFeeTotal = splitOrderPlans.reduce((a, p) => a + p.totals.deliveryFee, 0);
    const groupTaxesTotal = splitOrderPlans.reduce((a, p) => a + p.totals.taxes, 0);
    const groupGrandTotal = splitOrderPlans.reduce((a, p) => a + p.totals.grandTotal, 0);

    const addressSnapshot = {
      id: address.id,
      label: address.label,
      recipientName: address.recipientName,
      recipientPhone: address.recipientPhone,
      line1: address.line1,
      line2: address.line2,
      locality: address.locality,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      latitude: address.latitude,
      longitude: address.longitude,
    };

    const expiresAt =
      dto.paymentMethod === 'RAZORPAY'
        ? new Date(Date.now() + 15 * 60 * 1000)
        : null;

    const groupNumber = `GRP-${Date.now().toString(36).toUpperCase()}-${crypto.randomInt(100, 999)}`;

    // Step 1: Atomic DB reservation (group, split orders, stock decrement, coupon increment, cart clear, outbox)
    const { createdGroup, createdOrders } = await this.prisma.$transaction(async (tx) => {
      if (appliedCoupon) {
        if (appliedCoupon.perUserLimit != null) {
          const userUsedCountTx = await tx.couponUsage.count({
            where: { couponId: appliedCoupon.id, userId },
          });
          if (userUsedCountTx >= appliedCoupon.perUserLimit) {
            throw new ConflictException(
              `Coupon '${appliedCoupon.code}' has already been used on your account.`,
            );
          }
        }
        const couponRes = await tx.coupon.updateMany({
          where: {
            id: appliedCoupon.id,
            isActive: true,
            ...(appliedCoupon.usageLimit != null
              ? { usedCount: { lt: appliedCoupon.usageLimit } }
              : {}),
          },
          data: { usedCount: { increment: 1 } },
        });
        if (couponRes.count === 0) {
          throw new ConflictException(
            `Coupon '${appliedCoupon.code}' could not be applied (usage limit reached).`,
          );
        }
      }

      for (const [productId, requestedQty] of qtyByProduct.entries()) {
        const product = productMap.get(productId)!;
        const stockUpdate = await tx.product.updateMany({
          where: {
            id: productId,
            stockQuantity: { gte: requestedQty },
          },
          data: {
            stockQuantity: { decrement: requestedQty },
          },
        });
        if (stockUpdate.count === 0) {
          throw new ConflictException(
            `Insufficient stock for '${product.title}' during checkout reservation.`,
          );
        }
      }

      const grp = await tx.checkoutGroup.create({
        data: {
          groupNumber,
          customerId: userId,
          addressId: address.id,
          deliveryAddress: addressSnapshot,
          paymentMethod: dto.paymentMethod,
          paymentStatus: 'PENDING',
          couponCode: appliedCoupon ? appliedCoupon.code : null,
          itemTotal: groupItemTotal,
          discountTotal: groupDiscountTotal,
          giftWrapFee: totalGiftWrapFee,
          donationAmount: totalDonationAmount,
          deliveryFeeTotal: groupDeliveryFeeTotal,
          taxesTotal: groupTaxesTotal,
          grandTotal: groupGrandTotal,
          needGstInvoice,
          customerGstin: cleanGstin,
          gstBusinessName: cleanGstBusinessName,
          expiresAt,
        },
      });

      if (appliedCoupon) {
        await tx.couponUsage.create({
          data: {
            couponId: appliedCoupon.id,
            userId,
            checkoutGroupId: grp.id,
          },
        });
      }

      const created: any[] = [];
      for (const plan of splitOrderPlans) {
        const vendorUserId = plan.bucket.items[0]?.product?.vendor?.userId || null;
        const order = await tx.order.create({
          data: {
            id: plan.orderId,
            orderNumber: plan.orderNumber,
            version: 1,
            checkoutGroupId: grp.id,
            customerId: userId,
            vendorId: plan.bucket.vendorId,
            addressId: address.id,
            deliveryAddress: addressSnapshot,
            fulfillmentType: plan.bucket.fulfillmentType,
            orderType: plan.bucket.isTryAndBuy ? 'TRY_AND_BUY' : 'STANDARD',
            status: 'PLACED',
            deliveryAssignmentStatus: 'NOT_ASSIGNED',
            paymentMethod: dto.paymentMethod,
            paymentStatus: 'PENDING',
            itemTotal: plan.totals.itemTotal,
            deliveryFee: plan.totals.deliveryFee,
            taxes: plan.totals.taxes,
            giftWrapFee: plan.totals.giftWrapFee,
            donationAmount: plan.totals.donationAmount,
            discountAmount: plan.totals.discountAmount,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            grandTotal: plan.totals.grandTotal,
            etaMinutes: plan.bucket.etaMinutes,
            isTryAndBuy: plan.bucket.isTryAndBuy,
            deliveryInstructions: dto.deliveryInstructions?.trim() || null,
            needGstInvoice,
            customerGstin: cleanGstin,
            gstBusinessName: cleanGstBusinessName,
            deliveryOtpHash: plan.otpHash,
            expiresAt,
            items: {
              create: plan.bucket.items.map((it) => ({
                productId: it.productId,
                title: it.title,
                brand: it.brand,
                size: it.size,
                trialSize: it.trialSize,
                price: it.price,
                quantity: it.quantity,
                image: it.image,
                appliedCommissionRate: it.appliedCommissionRate ?? null,
                commissionAmount: it.commissionAmount ?? null,
              })),
            },
            history: {
              create: {
                status: 'PLACED',
                note: `Order placed (${dto.paymentMethod})`,
                actorId: userId,
                actorRole: Role.CUSTOMER,
              },
            },
          },
          include: ORDER_WITH_RELATIONS,
        });

        await tx.auditLog.create({
          data: {
            userId,
            userRole: Role.CUSTOMER,
            action: 'ORDER_CREATED',
            entityType: 'Order',
            entityId: order.id,
            details: JSON.stringify({
              orderNumber: order.orderNumber,
              checkoutGroupId: grp.id,
              paymentMethod: order.paymentMethod,
              grandTotal: order.grandTotal,
              fulfillmentType: order.fulfillmentType,
            }),
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'ORDER',
            aggregateId: order.id,
            eventType: QueueJobType.ORDER_STATUS_NOTIFICATION,
            payload: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              userId,
              customerId: userId,
              status: 'PLACED',
              title: `Order #${order.orderNumber} Placed`,
              message:
                dto.paymentMethod === 'RAZORPAY'
                  ? 'Complete payment within 15 minutes to confirm your order.'
                  : 'Your COD order has been sent to the store.',
            },
          },
        });

        if (vendorUserId) {
          await tx.outboxEvent.create({
            data: {
              aggregateType: 'ORDER',
              aggregateId: order.id,
              eventType: QueueJobType.VENDOR_ORDER_NOTIFICATION,
              payload: {
                orderId: order.id,
                orderNumber: order.orderNumber,
                userId: vendorUserId,
                vendorId: plan.bucket.vendorId,
                status: 'PLACED',
                title: `New Order #${order.orderNumber}`,
                message: `New ${plan.bucket.fulfillmentType} order worth ₹${order.grandTotal}.`,
              },
            },
          });
        }

        created.push(order);
      }

      if (!dto.isBuyNow) {
        const userCart = await tx.cart.findFirst({ where: { userId } });
        if (userCart) {
          await tx.cartItem.deleteMany({ where: { cartId: userCart.id } });
          await tx.cart.update({
            where: { id: userCart.id },
            data: { couponCode: null, giftWrap: false, donationAmount: 0 },
          });
        }
      }

      return { createdGroup: grp, createdOrders: created };
    }, { maxWait: 15000, timeout: 30000 });

    // Step 2: External Razorpay gateway creation outside DB lock with compensating rollback on failure
    let razorpayOrderId: string | null = null;
    if (dto.paymentMethod === 'RAZORPAY' && groupGrandTotal > 0) {
      try {
        const rzp = await this.razorpayClient.createOrder({
          amountInPaisa: Math.round(groupGrandTotal * 100),
          receipt: createdGroup.groupNumber,
          notes: {
            checkoutGroupId: createdGroup.id,
            customerId: userId,
            splitCount: String(createdOrders.length),
          },
        });
        razorpayOrderId = rzp.razorpayOrderId;

        await this.prisma.$transaction(async (tx) => {
          await tx.checkoutGroup.update({
            where: { id: createdGroup.id },
            data: { razorpayOrderId },
          });
          await tx.order.updateMany({
            where: { checkoutGroupId: createdGroup.id },
            data: { razorpayOrderId },
          });
        });

        if (typeof (this.queueService as any)?.enqueueOrderExpiryCheck === 'function') {
          await (this.queueService as any).enqueueOrderExpiryCheck(
            createdGroup.id,
            15 * 60 * 1000,
          );
        }
      } catch (err) {
        this.logger.error(
          `Razorpay creation failed for group ${createdGroup.id}; running compensating rollback`,
        );
        if (appliedCoupon) {
          await this.prisma.couponUsage
            .deleteMany({
              where: { checkoutGroupId: createdGroup.id },
            })
            .catch(() => {});
          await this.prisma.coupon
            .updateMany({
              where: { id: appliedCoupon.id, usedCount: { gt: 0 } },
              data: { usedCount: { decrement: 1 } },
            })
            .catch(() => {});
        }
        await this.prisma.checkoutGroup
          .update({
            where: { id: createdGroup.id },
            data: { paymentStatus: 'FAILED' },
          })
          .catch(() => {});

        for (const ord of createdOrders) {
          await this.orderTransition
            .executeTransition({
              orderId: ord.id,
              nextStatus: 'FAILED',
              actorRole: 'SYSTEM',
              note: 'Razorpay payment initialization failed',
              auditAction: 'CHECKOUT_RAZORPAY_INIT_FAILED',
            })
            .catch((rbErr) =>
              this.logger.error(`Compensating rollback failed for order ${ord.id}: ${rbErr?.message}`),
            );
        }
        throw err;
      }
    }

    const freshOrders = await this.prisma.order.findMany({
      where: { checkoutGroupId: createdGroup.id },
      include: ORDER_WITH_RELATIONS,
      orderBy: { createdAt: 'asc' },
    });

    const formattedOrders = freshOrders.map((o) =>
      this.formatOrderResponse(o, Role.CUSTOMER, userId),
    );

    for (const o of freshOrders) {
      this.trackingGateway?.broadcastStatusUpdate(o.id, 'PLACED', {
        eventType: 'ORDER_STATUS_UPDATE',
        orderNumber: o.orderNumber,
        orderType: o.orderType,
        deliveryAssignmentStatus: o.deliveryAssignmentStatus,
        vendorId: o.vendorId ?? null,
        customerId: o.customerId,
      });
    }

    const checkoutSessionToken =
      dto.paymentMethod === 'RAZORPAY' && groupGrandTotal > 0
        ? createCheckoutSessionToken(createdGroup.id, userId)
        : null;
    const checkoutSessionUrl = checkoutSessionToken
      ? `/api/v1/payments/razorpay/checkout-session/${encodeURIComponent(createdGroup.id)}?st=${encodeURIComponent(checkoutSessionToken)}`
      : null;

    const response: CheckoutResponseContract = {
      checkoutGroupId: createdGroup.id,
      groupNumber: createdGroup.groupNumber,
      paymentMethod: createdGroup.paymentMethod as any,
      paymentStatus: createdGroup.paymentStatus as any,
      razorpayOrderId,
      razorpayKeyId:
        dto.paymentMethod === 'RAZORPAY' ? this.razorpayClient.keyId || null : null,
      checkoutSessionToken,
      checkoutSessionUrl,
      itemTotal: groupItemTotal,
      discountTotal: groupDiscountTotal,
      giftWrapFee: totalGiftWrapFee,
      donationAmount: totalDonationAmount,
      deliveryFeeTotal: groupDeliveryFeeTotal,
      taxesTotal: groupTaxesTotal,
      grandTotal: groupGrandTotal,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      orders: formattedOrders,
      primaryOrderId: formattedOrders[0].id,
      orderNumber: formattedOrders[0].orderNumber,
    };

    if (cleanIdempotencyKey && requestHash) {
      await this.prisma.idempotencyKey
        .upsert({
          where: {
            userId_scope_key: {
              userId,
              scope: 'CHECKOUT',
              key: cleanIdempotencyKey,
            },
          },
          update: {
            requestHash,
            statusCode: 201,
            responseBody: response as any,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          create: {
            userId,
            scope: 'CHECKOUT',
            key: cleanIdempotencyKey,
            requestHash,
            statusCode: 201,
            responseBody: response as any,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        })
        .catch((err) => this.logger.warn(`Failed saving IdempotencyKey: ${err?.message}`));
    }

    // Dispatch asynchronous order alert email to boutique vendors
    for (const freshOrd of freshOrders) {
      if (freshOrd.fulfillmentType === 'VENDOR' && freshOrd.vendor) {
        const recipientEmail = freshOrd.vendor.notificationEmail || (freshOrd.vendor as any).user?.email;
        if (recipientEmail && this.emailService) {
          const defaultPortalOrigin =
            process.env.APP_ENV === 'production' ? 'https://admin.affordz.com' : 'http://localhost:3000';
          const portalUrl = `${(process.env.VENDOR_PORTAL_URL || defaultPortalOrigin).replace(/\/login\/?$/, '').replace(/\/+$/, '')}/vendor/orders`;
          this.emailService
            .sendVendorOrderNotificationEmail({
              to: recipientEmail,
              storeName: freshOrd.vendor.storeName,
              orderNumber: freshOrd.orderNumber,
              orderId: freshOrd.id,
              itemCount: freshOrd.items?.length || 1,
              totalAmount: freshOrd.grandTotal,
              portalUrl,
            })
            .catch((e) => this.logger.warn(`Failed to dispatch vendor alert email: ${e.message}`));
        }
      }
    }

    return response;
  }

  async verifyPayment(
    targetId: string,
    paymentId: string,
    signature: string,
    razorpayOrderId?: string,
    actorId?: string,
    actorRole?: string,
  ) {
    this.ensureDbConnected();

    if (!targetId && !razorpayOrderId) {
      throw new BadRequestException('orderId, checkoutGroupId, or razorpayOrderId is required');
    }

    const searchTokens = [targetId, razorpayOrderId].filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );

    let group: any = await this.prisma.checkoutGroup.findFirst({
      where: {
        OR: [
          ...searchTokens.map((t) => ({ id: t })),
          ...searchTokens.map((t) => ({ razorpayOrderId: t })),
        ],
      },
      include: {
        orders: { include: ORDER_WITH_RELATIONS },
      },
    });

    let targetOrders: any[] = [];
    let ownerCustomerId: string;
    let effectiveRzpOrderId: string | null = null;
    let effectiveAmount = 0;

    if (group) {
      targetOrders = group.orders;
      ownerCustomerId = group.customerId;
      effectiveRzpOrderId = group.razorpayOrderId || razorpayOrderId || null;
      effectiveAmount = group.grandTotal;
    } else {
      const order = await this.prisma.order.findFirst({
        where: {
          OR: [
            ...searchTokens.map((t) => ({ id: t })),
            ...searchTokens.map((t) => ({ orderNumber: t })),
            ...searchTokens.map((t) => ({ razorpayOrderId: t })),
          ],
        },
        include: { checkoutGroup: { include: { orders: { include: ORDER_WITH_RELATIONS } } }, ...ORDER_WITH_RELATIONS },
      });

      if (!order) {
        throw new NotFoundException('Order or Checkout Group not found for payment verification');
      }

      if (order.checkoutGroup) {
        group = order.checkoutGroup;
        targetOrders = group.orders;
        ownerCustomerId = group.customerId;
        effectiveRzpOrderId = group.razorpayOrderId || order.razorpayOrderId || razorpayOrderId || null;
        effectiveAmount = group.grandTotal;
      } else {
        targetOrders = [order];
        ownerCustomerId = order.customerId;
        effectiveRzpOrderId = order.razorpayOrderId || razorpayOrderId || null;
        effectiveAmount = order.grandTotal;
      }
    }

    if (actorRole === Role.CUSTOMER && actorId && ownerCustomerId !== actorId) {
      throw new ForbiddenException('You do not have permission to verify payment for this order');
    }

    if (!effectiveRzpOrderId) {
      throw new BadRequestException('No Razorpay order reference is attached to this checkout');
    }

    const isValid = this.razorpayClient.verifyPaymentSignature({
      razorpayOrderId: effectiveRzpOrderId,
      paymentId,
      signature,
    });

    if (!isValid) {
      throw new BadRequestException('Invalid Razorpay payment signature');
    }

    if (targetOrders.some((o) => o.status === 'FAILED' || o.status === 'CANCELLED')) {
      throw new ConflictException(
        'Cannot complete payment: order has already expired or been cancelled',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (group) {
        await tx.checkoutGroup.update({
          where: { id: group.id },
          data: {
            paymentStatus: 'COMPLETED',
            razorpayPaymentId: paymentId,
          },
        });
      }

      await tx.order.updateMany({
        where: { id: { in: targetOrders.map((o) => o.id) } },
        data: {
          paymentStatus: 'COMPLETED',
          razorpayPaymentId: paymentId,
        },
      });

      const existingCapture = await tx.paymentTransaction.findFirst({
        where: { paymentId, transactionType: 'CAPTURE' },
      });

      if (!existingCapture) {
        await tx.paymentTransaction.create({
          data: {
            checkoutGroupId: group?.id || null,
            orderId: targetOrders.length === 1 ? targetOrders[0].id : null,
            paymentId,
            razorpayOrderId: effectiveRzpOrderId!,
            signature,
            amount: effectiveAmount,
            currency: 'INR',
            status: 'COMPLETED',
            transactionType: 'CAPTURE',
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actorId || ownerCustomerId,
          userRole: actorRole || Role.CUSTOMER,
          action: 'PAYMENT_VERIFIED',
          entityType: group ? 'CheckoutGroup' : 'Order',
          entityId: group ? group.id : targetOrders[0].id,
          details: JSON.stringify({
            paymentId,
            razorpayOrderId: effectiveRzpOrderId,
            amount: effectiveAmount,
            orderIds: targetOrders.map((o) => o.id),
          }),
        },
      });
    });

    const refreshedOrders = await this.prisma.order.findMany({
      where: { id: { in: targetOrders.map((o) => o.id) } },
      include: ORDER_WITH_RELATIONS,
      orderBy: { createdAt: 'asc' },
    });

    return {
      verified: true,
      checkoutGroupId: group?.id || null,
      orderId: refreshedOrders[0]?.id || null,
      paymentStatus: 'COMPLETED',
      razorpayOrderId: effectiveRzpOrderId,
      razorpayPaymentId: paymentId,
      orders: refreshedOrders.map((o) => this.formatOrderResponse(o, actorRole, actorId)),
    };
  }

  async getOrders(
    userId: string,
    role: string = Role.CUSTOMER,
    driverId?: string,
    vendorId?: string,
  ) {
    this.ensureDbConnected();

    let where: any = {};
    if (role === Role.CUSTOMER) {
      where = { customerId: userId };
    } else if (role === Role.VENDOR) {
      const resolvedVendorId = await this.resolveVendorIdForUser(userId, vendorId);
      if (!resolvedVendorId) return [];
      where = { vendorId: resolvedVendorId };
    } else if (role === Role.DRIVER) {
      const resolvedDriverProfileId = await this.resolveDriverProfileIdForUser(userId, driverId);
      where = {
        OR: [
          { driverId: userId },
          ...(resolvedDriverProfileId
            ? [{ driverProfileId: resolvedDriverProfileId }, { driverId: resolvedDriverProfileId }]
            : []),
        ],
      };
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: ORDER_WITH_RELATIONS,
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((o) => this.formatOrderResponse(o, role, userId));
  }

  async getCheckoutGroup(groupId: string, userId: string, role: string) {
    this.ensureDbConnected();

    const group = await this.prisma.checkoutGroup.findFirst({
      where: { OR: [{ id: groupId }, { groupNumber: groupId }] },
      include: {
        orders: {
          include: ORDER_WITH_RELATIONS,
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!group) {
      throw new NotFoundException(`CheckoutGroup '${groupId}' not found`);
    }

    if (role !== Role.ADMIN && group.customerId !== userId) {
      throw new ForbiddenException('You do not have permission to view this checkout group');
    }

    return {
      id: group.id,
      groupNumber: group.groupNumber,
      customerId: group.customerId,
      paymentMethod: group.paymentMethod,
      paymentStatus: group.paymentStatus,
      razorpayOrderId: group.razorpayOrderId,
      razorpayPaymentId: group.razorpayPaymentId,
      couponCode: group.couponCode,
      itemTotal: group.itemTotal,
      discountTotal: group.discountTotal,
      giftWrapFee: group.giftWrapFee,
      donationAmount: group.donationAmount,
      deliveryFeeTotal: group.deliveryFeeTotal,
      taxesTotal: group.taxesTotal,
      grandTotal: group.grandTotal,
      expiresAt: group.expiresAt ? group.expiresAt.toISOString() : null,
      createdAt: group.createdAt.toISOString(),
      orders: group.orders.map((o) => this.formatOrderResponse(o, role, userId)),
    };
  }

  async getOrderById(
    id: string,
    userId?: string,
    role?: string,
    driverId?: string,
    vendorId?: string,
  ) {
    this.ensureDbConnected();
    const cleanId = id.trim().replace(/^#/, '');

    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id }, { id: cleanId }, { orderNumber: cleanId }] },
      include: ORDER_WITH_RELATIONS,
    });

    if (!order) {
      throw new NotFoundException(`Order '${id}' not found`);
    }

    await this.assertOrderAccess(order, userId, role, driverId, vendorId);
    return this.formatOrderResponse(order, role, userId);
  }

  async getOrderInvoice(
    id: string,
    userId?: string,
    role?: string,
    driverId?: string,
    vendorId?: string,
  ) {
    this.ensureDbConnected();
    const cleanId = id.trim().replace(/^#/, '');

    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id }, { id: cleanId }, { orderNumber: cleanId }] },
      include: {
        ...ORDER_WITH_RELATIONS,
        customer: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order '${id}' not found`);
    }

    await this.assertOrderAccess(order, userId, role, driverId, vendorId);

    const addr: any = order.deliveryAddress || order.address || {};
    const invoiceNumber = `INV-${order.orderNumber || order.id}`;
    const invoiceDate = (order.createdAt ? new Date(order.createdAt) : new Date()).toISOString();

    const lineItems = (order.items || []).map((item: any) => {
      const unitMrp = Math.round(item.price || 0);
      const qty = Math.max(1, Number(item.quantity || 1));
      const lineGross = unitMrp * qty;
      const gst = computeInclusiveGstBreakdown(lineGross, INCLUSIVE_GST_RATE);
      return {
        id: item.id,
        productId: item.productId,
        title: item.title,
        brand: item.brand,
        size: item.size,
        hsnCode: '6204',
        quantity: qty,
        unitMrp,
        lineGross,
        taxableValue: gst.taxableValue,
        cgstRate: 2.5,
        cgstAmount: gst.cgst,
        sgstRate: 2.5,
        sgstAmount: gst.sgst,
        totalGst: gst.totalGst,
      };
    });

    const netMerchandiseGross = Math.max(
      0,
      Math.round((order.itemTotal || 0) - (order.discountAmount || 0)),
    );
    const merchGst = computeInclusiveGstBreakdown(netMerchandiseGross, INCLUSIVE_GST_RATE);
    const deliveryGst = computeInclusiveGstBreakdown(order.deliveryFee || 0, INCLUSIVE_GST_RATE);
    const giftWrapGst = computeInclusiveGstBreakdown(order.giftWrapFee || 0, INCLUSIVE_GST_RATE);

    const taxableSubtotal =
      Math.round((merchGst.taxableValue + deliveryGst.taxableValue + giftWrapGst.taxableValue) * 100) / 100;
    const cgstTotal =
      Math.round((merchGst.cgst + deliveryGst.cgst + giftWrapGst.cgst) * 100) / 100;
    const sgstTotal =
      Math.round((merchGst.sgst + deliveryGst.sgst + giftWrapGst.sgst) * 100) / 100;
    const totalGstIncluded = Math.round((cgstTotal + sgstTotal) * 100) / 100;

    const sellerName =
      order.vendor?.storeName ||
      (order.fulfillmentType === 'DARK_STORE' ? 'Affordz Official Store' : 'Affordz Commerce Pvt Ltd');
    const sellerAddress =
      order.vendor?.address || 'Bengaluru Express Atelier Hub, Karnataka - 560038';
    const sellerGstin = '29AABCU9603R1ZM';
    const buyerName =
      order.gstBusinessName ||
      addr.recipientName ||
      order.customer?.name ||
      'Affordz Customer';
    const buyerAddress = [addr.line1, addr.line2, addr.locality, addr.city, addr.state, addr.pincode]
      .filter(Boolean)
      .join(', ');

    const esc = (v: unknown) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(invoiceNumber)} — Affordz Tax Invoice</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111111; margin: 0; padding: 24px; background: #FAF8F5; }
    .sheet { max-width: 780px; margin: 0 auto; background: #FFFFFF; border: 1px solid #E8E5DF; border-radius: 16px; padding: 28px; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #111111; padding-bottom: 16px; margin-bottom: 18px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
    .badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #FF5A1F; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; font-size: 13px; }
    .box { background: #FAF8F5; border: 1px solid #E8E5DF; border-radius: 10px; padding: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 12.5px; }
    th { text-align: left; background: #F4F1EA; padding: 9px 8px; border-bottom: 1px solid #D9D9D5; font-size: 11px; text-transform: uppercase; }
    td { padding: 9px 8px; border-bottom: 1px solid #F0ECE4; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .totals { max-width: 340px; margin-left: auto; font-size: 13px; }
    .totals-row { display: flex; justify-content: space-between; padding: 5px 0; }
    .grand { border-top: 2px solid #111111; margin-top: 6px; padding-top: 8px; font-weight: 800; font-size: 16px; }
    .note { margin-top: 18px; font-size: 11.5px; color: #6B6667; border-top: 1px solid #E8E5DF; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="badge">TAX INVOICE (MRP GST-INCLUSIVE)</div>
        <div class="brand">AFFORDZ</div>
        <div style="font-size:12px;color:#6B6667;">${esc(sellerName)} • GSTIN: ${esc(sellerGstin)}</div>
      </div>
      <div style="text-align:right;font-size:12.5px;">
        <div><strong>Invoice No:</strong> ${esc(invoiceNumber)}</div>
        <div><strong>Order No:</strong> #${esc(order.orderNumber)}</div>
        <div><strong>Date:</strong> ${esc(new Date(invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))}</div>
        <div><strong>Payment:</strong> ${esc(order.paymentMethod)} (${esc(order.paymentStatus)})</div>
      </div>
    </div>
    <div class="grid">
      <div class="box">
        <div style="font-size:10.5px;font-weight:700;color:#6B6667;text-transform:uppercase;margin-bottom:4px;">Sold By</div>
        <div style="font-weight:700;">${esc(sellerName)}</div>
        <div style="color:#4A4A4A;margin-top:2px;">${esc(sellerAddress)}</div>
        <div style="color:#4A4A4A;margin-top:2px;">GSTIN: ${esc(sellerGstin)}</div>
      </div>
      <div class="box">
        <div style="font-size:10.5px;font-weight:700;color:#6B6667;text-transform:uppercase;margin-bottom:4px;">Billed &amp; Shipped To</div>
        <div style="font-weight:700;">${esc(buyerName)}</div>
        ${order.customerGstin ? `<div style="color:#111111;font-weight:600;margin-top:2px;">Customer GSTIN: ${esc(order.customerGstin)}</div>` : ''}
        <div style="color:#4A4A4A;margin-top:2px;">${esc(buyerAddress || 'Registered Address')}</div>
        ${addr.recipientPhone || order.customer?.phone ? `<div style="color:#4A4A4A;margin-top:2px;">Phone: ${esc(addr.recipientPhone || order.customer?.phone)}</div>` : ''}
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Item &amp; HSN</th>
          <th class="num">Qty</th>
          <th class="num">MRP (Incl. GST)</th>
          <th class="num">Taxable</th>
          <th class="num">CGST (2.5%)</th>
          <th class="num">SGST (2.5%)</th>
          <th class="num">Total</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems
          .map(
            (li) => `<tr>
          <td><strong>${esc(li.title)}</strong><br/><span style="color:#6B6667;font-size:11px;">${esc(li.brand)} • Size ${esc(li.size)} • HSN ${esc(li.hsnCode)}</span></td>
          <td class="num">${li.quantity}</td>
          <td class="num">₹${li.unitMrp.toLocaleString('en-IN')}</td>
          <td class="num">₹${li.taxableValue.toFixed(2)}</td>
          <td class="num">₹${li.cgstAmount.toFixed(2)}</td>
          <td class="num">₹${li.sgstAmount.toFixed(2)}</td>
          <td class="num"><strong>₹${li.lineGross.toLocaleString('en-IN')}</strong></td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <div class="totals">
      <div class="totals-row"><span>Items MRP Total (Incl. GST)</span><span>₹${Math.round(order.itemTotal || 0).toLocaleString('en-IN')}</span></div>
      ${(order.discountAmount || 0) > 0 ? `<div class="totals-row" style="color:#15803D;"><span>Coupon Discount ${order.couponCode ? `(${esc(order.couponCode)})` : ''}</span><span>-₹${Math.round(order.discountAmount || 0).toLocaleString('en-IN')}</span></div>` : ''}
      <div class="totals-row"><span>Delivery Fee</span><span>${(order.deliveryFee || 0) === 0 ? 'FREE' : `₹${Math.round(order.deliveryFee || 0).toLocaleString('en-IN')}`}</span></div>
      ${(order.giftWrapFee || 0) > 0 ? `<div class="totals-row"><span>Artisan Gift Wrap</span><span>₹${Math.round(order.giftWrapFee || 0).toLocaleString('en-IN')}</span></div>` : ''}
      ${(order.donationAmount || 0) > 0 ? `<div class="totals-row"><span>Weaver Foundation Donation</span><span>₹${Math.round(order.donationAmount || 0).toLocaleString('en-IN')}</span></div>` : ''}
      <div class="totals-row" style="color:#6B6667;font-size:12px;"><span>Taxable Value</span><span>₹${taxableSubtotal.toFixed(2)}</span></div>
      <div class="totals-row" style="color:#6B6667;font-size:12px;"><span>Included CGST (2.5%) + SGST (2.5%)</span><span>₹${totalGstIncluded.toFixed(2)} (Incl. in MRP)</span></div>
      <div class="totals-row grand"><span>Grand Total Paid</span><span>₹${Math.round(order.grandTotal || 0).toLocaleString('en-IN')}</span></div>
    </div>
    <div class="note">
      This is a computer-generated GST tax invoice. All product prices are inclusive of applicable GST (5% CGST+SGST included in MRP).
    </div>
  </div>
</body>
</html>`;

    return {
      invoiceNumber,
      invoiceDate,
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      mrpGstInclusive: true,
      seller: {
        name: sellerName,
        address: sellerAddress,
        gstin: sellerGstin,
        placeOfSupply: 'Karnataka (29)',
      },
      buyer: {
        name: buyerName,
        phone: addr.recipientPhone || order.customer?.phone || null,
        address: buyerAddress,
        needGstInvoice: Boolean(order.needGstInvoice),
        gstin: order.customerGstin || null,
        businessName: order.gstBusinessName || null,
      },
      items: lineItems,
      totals: {
        itemTotal: Math.round(order.itemTotal || 0),
        discountAmount: Math.round(order.discountAmount || 0),
        couponCode: order.couponCode || null,
        deliveryFee: Math.round(order.deliveryFee || 0),
        giftWrapFee: Math.round(order.giftWrapFee || 0),
        donationAmount: Math.round(order.donationAmount || 0),
        taxableSubtotal,
        cgstTotal,
        sgstTotal,
        totalGstIncluded,
        grandTotal: Math.round(order.grandTotal || 0),
      },
      html,
    };
  }

  async trackOrder(
    id: string,
    userId?: string,
    role?: string,
    driverId?: string,
    vendorId?: string,
  ) {
    this.ensureDbConnected();
    const cleanId = id.trim().replace(/^#/, '');

    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id }, { id: cleanId }, { orderNumber: cleanId }] },
      include: {
        ...ORDER_WITH_RELATIONS,
        address: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order '${id}' not found`);
    }

    await this.assertOrderAccess(order, userId, role, driverId, vendorId);

    const isLive = LIVE_TRACKING_ACTIVE_STATUSES.includes(order.status as OrderStatus);
    const driverLat = isLive ? order.driverProfile?.currentLat ?? null : null;
    const driverLng = isLive ? order.driverProfile?.currentLng ?? null : null;
    const customerLat =
      (order.deliveryAddress as any)?.latitude ?? order.address?.latitude ?? null;
    const customerLng =
      (order.deliveryAddress as any)?.longitude ?? order.address?.longitude ?? null;

    let pickupCoordinates: { latitude: number; longitude: number } | null =
      order.vendor?.latitude != null && order.vendor?.longitude != null
        ? { latitude: order.vendor.latitude, longitude: order.vendor.longitude }
        : null;
    let hubName: string = order.vendor?.storeName || 'Affordz Express Hub';

    if (order.fulfillmentType === 'DARK_STORE') {
      const activeHub = await this.prisma.darkStoreHub
        ?.findFirst?.({
          where: { isActive: true },
          select: { name: true, lat: true, lng: true },
        })
        .catch(() => null);
      if (activeHub) {
        hubName = activeHub.name || hubName;
        if (!pickupCoordinates && activeHub.lat != null && activeHub.lng != null) {
          pickupCoordinates = { latitude: activeHub.lat, longitude: activeHub.lng };
        }
      }
    }

    let routeData: any = null;
    let computedEtaMinutes = order.etaMinutes ?? 0;

    if (
      isLive &&
      driverLat != null &&
      driverLng != null &&
      customerLat != null &&
      customerLng != null &&
      this.googleRoutesService
    ) {
      routeData = await this.googleRoutesService.computeRoute(
        { latitude: driverLat, longitude: driverLng },
        { latitude: customerLat, longitude: customerLng },
        'TWO_WHEELER',
      );
      if (routeData?.durationMinutes != null) {
        computedEtaMinutes = routeData.durationMinutes;
      }
    }

    const formatted = this.formatOrderResponse(order, role, userId);
    const driverVisibleStatuses: OrderStatus[] = [
      'ACCEPTED',
      'PACKING',
      'PREPARING',
      'READY_FOR_PICKUP',
      'ASSIGNED',
      'PICKED_UP',
      'OUT_FOR_DELIVERY',
      'TRY_AND_BUY',
      'DELIVERED',
      'RETURNING',
      'RETURNED',
    ];
    const hasActiveAssignment =
      order.deliveryAssignmentStatus === 'ASSIGNED' ||
      order.deliveryAssignmentStatus === 'ACCEPTED_BY_DELIVERY_PARTNER' ||
      order.deliveryAssignmentStatus === 'COMPLETED';
    const canShowDriver =
      Boolean(order.driverProfile) &&
      (hasActiveAssignment || driverVisibleStatuses.includes(order.status as OrderStatus));

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      version: order.version,
      fulfillmentType: order.fulfillmentType || 'DARK_STORE',
      orderType: order.orderType || (order.isTryAndBuy ? 'TRY_AND_BUY' : 'STANDARD'),
      deliveryAssignmentStatus: order.deliveryAssignmentStatus || 'NOT_ASSIGNED',
      customerStatusLabel: getCustomerOrderStatusLabel(order.status, order.isTryAndBuy),
      hubName,
      status: order.status,
      trackingActive: isLive,
      isArrived: Boolean(order.arrivedAt),
      pickedUpAt: order.pickedUpAt ? order.pickedUpAt.toISOString() : null,
      tryAndBuyStartedAt: order.tryAndBuyStartedAt ? order.tryAndBuyStartedAt.toISOString() : null,
      arrivedAt: order.arrivedAt ? order.arrivedAt.toISOString() : null,
      returnedAt: order.returnedAt ? order.returnedAt.toISOString() : null,
      etaMinutes: computedEtaMinutes,
      driverLocation:
        isLive && driverLat != null && driverLng != null
          ? {
              latitude: driverLat,
              longitude: driverLng,
              heading: order.driverProfile?.currentHeading ?? 0,
            }
          : null,
      driverCoords:
        isLive && driverLat != null && driverLng != null
          ? { latitude: driverLat, longitude: driverLng }
          : null,
      customerCoords:
        customerLat != null && customerLng != null
          ? { latitude: customerLat, longitude: customerLng }
          : null,
      deliveryCoordinates:
        customerLat != null && customerLng != null
          ? { latitude: customerLat, longitude: customerLng }
          : null,
      pickupCoordinates,
      driver: canShowDriver
        ? {
            id: order.driverProfile!.id,
            name: order.driverProfile!.fullName,
            phone: order.driverProfile!.phone,
            vehicleType: order.driverProfile!.vehicleType,
            vehicleRegistration: order.driverProfile!.vehicleRegistration,
            rating: order.driverProfile!.rating ?? 5,
          }
        : null,
      route: routeData,
      milestones: this.stateMachine.getMilestones(order.status as OrderStatus, {
        isTryAndBuy: Boolean(order.isTryAndBuy),
      }),
      handoverOtp: formatted.handoverOtp,
      isTryAndBuy: formatted.isTryAndBuy,
      tryAndBuySession: formatted.tryAndBuySession,
      itemTotal: formatted.itemTotal,
      deliveryFee: formatted.deliveryFee,
      taxes: formatted.taxes,
      giftWrapFee: formatted.giftWrapFee,
      donationAmount: formatted.donationAmount,
      discountAmount: formatted.discountAmount,
      couponCode: formatted.couponCode,
      grandTotal: formatted.grandTotal,
      deliveryAddress: formatted.deliveryAddress,
      deliveryInstructions: formatted.deliveryInstructions ?? null,
      items: formatted.items,
    };
  }

  async getOrderRoute(
    id: string,
    userId?: string,
    role?: string,
    driverId?: string,
    vendorId?: string,
  ) {
    const tracking = await this.trackOrder(id, userId, role, driverId, vendorId);
    if (!tracking.trackingActive || !tracking.driverCoords || !tracking.customerCoords) {
      return {
        orderId: tracking.orderId,
        trackingActive: tracking.trackingActive,
        routeUnavailable: true,
        coordinates: [],
        distanceKm: '0',
        durationMinutes: tracking.etaMinutes,
      };
    }

    return (
      tracking.route || {
        orderId: tracking.orderId,
        trackingActive: true,
        routeUnavailable: true,
        coordinates: [],
        distanceKm: '0',
        durationMinutes: tracking.etaMinutes,
      }
    );
  }

  async updateStatus(
    id: string,
    nextStatus: string,
    actorRole: string,
    note?: string,
    actorId?: string,
    expectedVersion?: number,
    vendorId?: string,
    driverId?: string,
  ) {
    this.ensureDbConnected();

    const cleanId = id.trim().replace(/^#/, '');
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id }, { id: cleanId }, { orderNumber: cleanId }] },
    });

    if (!order) {
      throw new NotFoundException(`Order '${id}' not found`);
    }

    await this.assertOrderAccess(order, actorId, actorRole, driverId, vendorId);

    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: nextStatus as OrderStatus,
      actorRole,
      actorId,
      note,
      expectedVersion,
      triggerAutoAssignment: nextStatus === 'ACCEPTED',
    });

    return this.formatOrderResponse(updated, actorRole, actorId);
  }

  async cancelOrder(
    id: string,
    actor: { id: string; role: string; email?: string; name?: string },
    reason?: string,
    expectedVersion?: number,
  ) {
    this.ensureDbConnected();

    const cleanId = id.trim().replace(/^#/, '');
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id }, { id: cleanId }, { orderNumber: cleanId }] },
    });

    if (!order) {
      throw new NotFoundException(`Order '${id}' not found`);
    }

    await this.assertOrderAccess(order, actor.id, actor.role);

    const isVendorRejection = actor.role === Role.VENDOR;
    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'CANCELLED',
      actorRole: actor.role,
      actorId: actor.id,
      actorEmail: actor.email || null,
      actorName: actor.name || null,
      note:
        reason?.trim() ||
        (isVendorRejection
          ? 'Order rejected by vendor'
          : `Order cancelled by ${actor.role}`),
      expectedVersion,
      auditAction: isVendorRejection ? 'VENDOR_ORDER_REJECTED' : 'ORDER_CANCELLED',
      extraOrderUpdate: {
        cancellationReason: reason?.trim() || null,
        ...(isVendorRejection ? { rejectedByVendor: true } : {}),
      },
    });

    return this.formatOrderResponse(updated, actor.role, actor.id);
  }

  async submitCustomerTryAndBuySelections(
    orderId: string,
    userId: string,
    role: string,
    selections: Record<string, 'KEEP' | 'RETURN'>,
  ) {
    this.ensureDbConnected();

    const cleanId = orderId.trim().replace(/^#/, '');
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }] },
      include: ORDER_WITH_RELATIONS,
    });

    if (!order) {
      throw new NotFoundException(`Order '${orderId}' not found`);
    }

    await this.assertOrderAccess(order, userId, role);

    if (!order.isTryAndBuy) {
      throw new BadRequestException('This order is not enabled for Try & Buy');
    }

    if (
      order.status !== 'TRY_AND_BUY' &&
      !(order.status === 'OUT_FOR_DELIVERY' && Boolean(order.arrivedAt))
    ) {
      throw new BadRequestException(
        `Try & Buy selections can only be submitted while order is in TRY_AND_BUY stage (current: ${order.status})`,
      );
    }

    if (!order.arrivedAt && !order.tryAndBuySession) {
      throw new BadRequestException(
        'Driver has not marked doorstep arrival yet. Please submit Try & Buy choices after doorstep handover begins.',
      );
    }

    if (!selections || typeof selections !== 'object') {
      throw new BadRequestException('A valid selections map is required');
    }

    const orderItemIds = new Set((order.items || []).map((it: any) => it.id));
    for (const [itemId, decision] of Object.entries(selections)) {
      if (!orderItemIds.has(itemId)) {
        throw new BadRequestException(`Item '${itemId}' does not belong to order '${order.orderNumber}'`);
      }
      if (decision !== 'KEEP' && decision !== 'RETURN') {
        throw new BadRequestException(`Invalid selection '${decision}' for item '${itemId}'. Must be KEEP or RETURN.`);
      }
    }

    const completeSelections: Record<string, 'KEEP' | 'RETURN'> = {};
    for (const it of order.items || []) {
      const chosen = selections[it.id];
      if (!chosen) {
        throw new BadRequestException(`Selection missing for item '${it.title}' (${it.id})`);
      }
      completeSelections[it.id] = chosen;
    }

    const financials = computeTryAndBuyFinancials({
      order: {
        itemTotal: order.itemTotal,
        deliveryFee: order.deliveryFee,
        taxes: order.taxes,
        discountAmount: order.discountAmount,
        giftWrapFee: order.giftWrapFee,
        donationAmount: order.donationAmount,
        grandTotal: order.grandTotal,
        paymentMethod: order.paymentMethod,
      },
      items: (order.items || []).map((i: any) => ({
        id: i.id,
        price: i.price,
        quantity: i.quantity,
      })),
      selections: completeSelections,
    });

    const keptIds = financials.keptItems.map((i) => i.id);
    const returnedIds = financials.returnedItems.map((i) => i.id);
    const now = new Date();
    const sessionPaymentStatus =
      financials.refundAmount > 0
        ? 'REFUND_PENDING'
        : order.paymentMethod === 'COD' && financials.amountDue > 0
          ? 'PAYMENT_PENDING'
          : 'COMPLETED';

    await this.prisma.$transaction(async (tx) => {
      for (const it of order.items || []) {
        await tx.orderItem.update({
          where: { id: it.id },
          data: { tryAndBuyDecision: completeSelections[it.id] },
        });
      }

      await tx.tryAndBuySession.upsert({
        where: { orderId: order.id },
        update: {
          stage: 'SELECTION_CONFIRMED',
          customerSelectionAt: now,
          keptItemIds: keptIds,
          returnedItemIds: returnedIds,
          finalPayableTotal: financials.finalPayableTotal,
          refundAmount: financials.refundAmount,
          amountDue: financials.amountDue,
          paymentStatus: sessionPaymentStatus,
        },
        create: {
          orderId: order.id,
          driverId: order.driverId || null,
          driverProfileId: order.driverProfileId || null,
          stage: 'SELECTION_CONFIRMED',
          handoverConfirmedAt: order.arrivedAt || now,
          customerSelectionAt: now,
          keptItemIds: keptIds,
          returnedItemIds: returnedIds,
          finalPayableTotal: financials.finalPayableTotal,
          refundAmount: financials.refundAmount,
          amountDue: financials.amountDue,
          paymentStatus: sessionPaymentStatus,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          userRole: role,
          action: 'TRY_AND_BUY_CUSTOMER_SELECTIONS',
          entityType: 'Order',
          entityId: order.id,
          details: JSON.stringify({
            keptIds,
            returnedIds,
            finalPayableTotal: financials.finalPayableTotal,
            refundAmount: financials.refundAmount,
            amountDue: financials.amountDue,
          }),
        },
      });

      if (order.driverId) {
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'ORDER',
            aggregateId: order.id,
            eventType: QueueJobType.TRY_AND_BUY_SELECTION_NOTIFICATION,
            payload: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              userId: order.driverId,
              driverId: order.driverId,
              title: `Customer Selection Confirmed #${order.orderNumber}`,
              message: `Keep: ${keptIds.length} item(s), Return: ${returnedIds.length} item(s).`,
            },
          },
        });
      }
    });

    const refreshed = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: ORDER_WITH_RELATIONS,
    });
    const formattedOrder = this.formatOrderResponse(refreshed, role, userId);

    this.trackingGateway?.broadcastStatusUpdate(order.id, order.status, {
      eventType: 'TRY_AND_BUY_UPDATED',
      stage: 'SELECTION_CONFIRMED',
      keptItemIds: keptIds,
      returnedItemIds: returnedIds,
      finalPayableTotal: financials.finalPayableTotal,
      refundAmount: financials.refundAmount,
      amountDue: financials.amountDue,
      items: formattedOrder.items,
      tryAndBuySession: formattedOrder.tryAndBuySession,
      order: formattedOrder,
    });

    return {
      order: formattedOrder,
      financials,
    };
  }

  async assignDriver(
    id: string,
    driverIdOrProfileId: string,
    actorRole: string = Role.ADMIN,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDbConnected();

    if (actorRole !== Role.ADMIN) {
      throw new ForbiddenException('Only ADMIN can manually assign a delivery driver (D-006).');
    }

    if (this.deliveryAssignment) {
      const { order } = await this.deliveryAssignment.assignManually(
        id,
        driverIdOrProfileId,
        { actorId, actorRole, actorName },
      );
      return this.formatOrderResponse(order, Role.ADMIN, actorId);
    }

    throw new ServiceUnavailableException('Delivery assignment service is unavailable.');
  }

  async vendorAccept(id: string, actorRole: string = Role.VENDOR, actorId?: string) {
    const cleanId = id.trim().replace(/^#/, '');
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id }, { id: cleanId }, { orderNumber: cleanId }] },
    });
    if (!order) {
      throw new NotFoundException(`Order '${id}' not found`);
    }
    await this.assertOrderAccess(order, actorId, actorRole);
    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'ACCEPTED',
      actorRole,
      actorId,
      note: 'Order accepted; automatic delivery partner assignment triggered',
      auditAction: 'VENDOR_ORDER_ACCEPTED',
      triggerAutoAssignment: true,
    });
    return this.formatOrderResponse(updated, actorRole, actorId);
  }

  async vendorPrepare(id: string, actorRole: string = Role.VENDOR, actorId?: string) {
    return this.updateStatus(
      id,
      'PACKING',
      actorRole,
      'Order is getting packed',
      actorId,
    );
  }

  async vendorReadyForPickup(id: string, actorRole: string = Role.VENDOR, actorId?: string) {
    return this.updateStatus(
      id,
      'READY_FOR_PICKUP',
      actorRole,
      'Order packed and ready for pickup',
      actorId,
    );
  }
}
