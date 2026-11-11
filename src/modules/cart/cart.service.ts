import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FREE_DELIVERY_THRESHOLD,
  GIFT_WRAP_FEE,
  GST_TAX_RATE,
  STANDARD_DELIVERY_FEE,
} from '../orders/order-pricing.util';
import { UpdateCartPreferencesDto } from './dto/update-cart-preferences.dto';

const ID_ALIASES: Record<string, string> = {
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

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async resolveCanonicalUserId(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: userId }, { firebaseUid: userId }],
      },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException(`User '${userId}' not found.`);
    }

    return user.id;
  }

  private async ensureUserCart(userId: string) {
    const canonicalUserId = await this.resolveCanonicalUserId(userId);
    return this.prisma.cart.upsert({
      where: { userId: canonicalUserId },
      update: {},
      create: { userId: canonicalUserId },
    });
  }

  async getCart(userId: string) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId);

    const dbCart = await this.prisma.cart.findUnique({
      where: { userId: canonicalUserId },
      include: {
        items: {
          include: {
            product: {
              include: {
                vendor: true,
                darkStoreHub: true,
                category: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const rawItems = dbCart?.items || [];
    const items = rawItems.map((ci) => {
      const prod = ci.product;
      const isDark = prod.fulfillmentType === 'DARK_STORE';

      return {
        id: ci.id,
        cartItemId: ci.id,
        productId: ci.productId,
        vendorId: prod.vendorId,
        vendorName: prod.vendor?.storeName || 'Affordz Partner',
        title: prod.title,
        brand: prod.brand,
        category: prod.category?.name || '',
        size: ci.size,
        color: ci.color || null,
        trialSize: isDark ? ci.trialSize || null : null,
        isTryAndBuy: isDark ? Boolean(ci.trialSize || prod.tryAndBuyEligible) : false,
        tryAndBuyEligible: isDark ? Boolean(prod.tryAndBuyEligible) : false,
        fulfillmentType: prod.fulfillmentType,
        darkStoreHubId: prod.darkStoreHubId || null,
        darkStoreHub: prod.darkStoreHub || null,
        price: prod.price,
        originalPrice: prod.originalPrice,
        discount: prod.discount,
        quantity: ci.quantity,
        image: prod.image,
        altText: prod.altText || '',
      };
    });

    const itemTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    let discountAmount = 0;
    let appliedCouponInfo: any = null;
    const appliedCode = dbCart?.couponCode || null;

    if (appliedCode && itemTotal > 0 && dbCart) {
      const coupon = await this.prisma.coupon.findFirst({
        where: { code: { equals: appliedCode, mode: 'insensitive' } },
      });

      const now = new Date();
      if (
        coupon &&
        coupon.isActive &&
        coupon.startDate <= now &&
        coupon.endDate >= now &&
        (coupon.usageLimit === null || coupon.usedCount < coupon.usageLimit) &&
        itemTotal >= coupon.minOrderValue
      ) {
        if (coupon.discountType === 'PERCENTAGE') {
          discountAmount = Math.round((itemTotal * coupon.discountValue) / 100);
          if (coupon.maxDiscount) {
            discountAmount = Math.min(discountAmount, coupon.maxDiscount);
          }
        } else {
          discountAmount = Math.min(coupon.discountValue, itemTotal);
        }

        appliedCouponInfo = {
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          discountAmount,
        };
      } else {
        await this.prisma.cart.update({
          where: { id: dbCart.id },
          data: { couponCode: null },
        });
      }
    }

    const bucketMap = new Map<
      string,
      {
        bucketKey: string;
        vendorId: string;
        vendorName: string;
        fulfillmentType: 'DARK_STORE' | 'VENDOR';
        darkStoreHubId: string | null;
        itemTotal: number;
        itemCount: number;
        tryAndBuyEligible: boolean;
        items: typeof items;
      }
    >();

    for (const item of items) {
      const bucketKey = `${item.vendorId}::${item.fulfillmentType}`;
      let bucket = bucketMap.get(bucketKey);
      if (!bucket) {
        bucket = {
          bucketKey,
          vendorId: item.vendorId,
          vendorName: item.vendorName,
          fulfillmentType: item.fulfillmentType as 'DARK_STORE' | 'VENDOR',
          darkStoreHubId: item.darkStoreHubId,
          itemTotal: 0,
          itemCount: 0,
          tryAndBuyEligible: false,
          items: [],
        };
        bucketMap.set(bucketKey, bucket);
      }
      bucket.itemTotal += item.price * item.quantity;
      bucket.itemCount += item.quantity;
      if (item.fulfillmentType === 'DARK_STORE' && item.tryAndBuyEligible) {
        bucket.tryAndBuyEligible = true;
      }
      bucket.items.push(item);
    }

    const splitBuckets = Array.from(bucketMap.values()).map((bucket) => ({
      ...bucket,
      deliveryFee:
        bucket.itemTotal >= FREE_DELIVERY_THRESHOLD ? 0 : STANDARD_DELIVERY_FEE,
    }));

    const deliveryFee = splitBuckets.reduce((sum, b) => sum + b.deliveryFee, 0);
    const taxes = Math.round(itemTotal * GST_TAX_RATE);
    const giftWrap = Boolean(dbCart?.giftWrap);
    const giftWrapFee = itemTotal > 0 && giftWrap ? GIFT_WRAP_FEE : 0;
    const donationAmount =
      itemTotal > 0 ? Math.max(0, Math.round(dbCart?.donationAmount || 0)) : 0;

    const grandTotal =
      Math.max(0, itemTotal - discountAmount) +
      deliveryFee +
      taxes +
      giftWrapFee +
      donationAmount;

    return {
      items,
      itemTotal,
      deliveryFee,
      taxes,
      discountAmount,
      giftWrap,
      giftWrapFee,
      donationAmount,
      coupon: appliedCouponInfo,
      couponCode: appliedCouponInfo ? appliedCouponInfo.code : null,
      grandTotal,
      splitOrderCount: splitBuckets.length,
      splitBuckets,
      count: items.reduce((acc, item) => acc + item.quantity, 0),
    };
  }

  async addItem(
    userId: string,
    productId: string,
    size?: string,
    quantity: number = 1,
    trialSize?: string,
    color?: string,
  ) {
    this.ensureDbConnected();

    const cleanId = String(productId).trim();
    const mappedId = ID_ALIASES[cleanId] || cleanId;
    const normalizedCandidates = Array.from(new Set([cleanId, mappedId]));

    const product = await this.prisma.product.findFirst({
      where: {
        id: { in: normalizedCandidates },
        listingStatus: 'ACTIVE',
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    const itemSize = size || product.sizes?.[0] || 'M';
    const qty = Math.max(1, Number(quantity) || 1);

    const cart = await this.ensureUserCart(userId);

    const existingDbItem = await this.prisma.cartItem.findFirst({
      where: {
        cartId: cart.id,
        productId: product.id,
        size: itemSize,
        color: color?.trim() || null,
      },
    });

    const targetQty = existingDbItem ? existingDbItem.quantity + qty : qty;
    if (targetQty > product.stockQuantity) {
      throw new BadRequestException(
        `Requested quantity (${targetQty}) exceeds available stock (${product.stockQuantity}) for ${product.title}`,
      );
    }

    const resolvedTrialSize =
      product.fulfillmentType === 'DARK_STORE' && product.tryAndBuyEligible
        ? trialSize || existingDbItem?.trialSize || null
        : null;

    if (existingDbItem) {
      await this.prisma.cartItem.update({
        where: { id: existingDbItem.id },
        data: {
          quantity: targetQty,
          trialSize: resolvedTrialSize,
        },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          size: itemSize,
          trialSize: resolvedTrialSize,
          color: color?.trim() || null,
          quantity: qty,
        },
      });
    }

    return this.getCart(userId);
  }

  async updateQuantity(userId: string, id: string, delta: number) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId);

    const cart = await this.prisma.cart.findUnique({ where: { userId: canonicalUserId } });
    if (!cart) {
      return this.getCart(canonicalUserId);
    }

    const dbItem = await this.prisma.cartItem.findFirst({
      where: {
        cartId: cart.id,
        OR: [{ id }, { productId: id }],
      },
      include: { product: true },
    });

    if (!dbItem) {
      throw new NotFoundException(`Cart item '${id}' not found.`);
    }

    const nextQty = dbItem.quantity + Number(delta || 0);
    if (nextQty <= 0) {
      await this.prisma.cartItem.delete({ where: { id: dbItem.id } });
    } else {
      if (nextQty > dbItem.product.stockQuantity) {
        throw new BadRequestException(
          `Only ${dbItem.product.stockQuantity} units available for ${dbItem.product.title}.`,
        );
      }
      await this.prisma.cartItem.update({
        where: { id: dbItem.id },
        data: { quantity: nextQty },
      });
    }

    return this.getCart(canonicalUserId);
  }

  async removeItem(userId: string, id: string) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId);

    const cart = await this.prisma.cart.findUnique({ where: { userId: canonicalUserId } });
    if (cart) {
      await this.prisma.cartItem.deleteMany({
        where: {
          cartId: cart.id,
          OR: [{ id }, { productId: id }],
        },
      });
    }

    return this.getCart(canonicalUserId);
  }

  async applyCoupon(userId: string, code: string) {
    this.ensureDbConnected();
    const cleanCode = (code || '').trim().toUpperCase();
    const coupon = await this.prisma.coupon.findFirst({
      where: { code: { equals: cleanCode, mode: 'insensitive' } },
    });

    if (!coupon) {
      throw new NotFoundException(`Coupon '${cleanCode}' is invalid`);
    }

    const now = new Date();
    if (!coupon.isActive || coupon.startDate > now || coupon.endDate < now) {
      throw new BadRequestException(`Coupon '${cleanCode}' is expired or inactive`);
    }

    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException(`Coupon '${cleanCode}' usage limit reached`);
    }

    const currentCart = await this.getCart(userId);
    if (currentCart.itemTotal < coupon.minOrderValue) {
      throw new BadRequestException(
        `Minimum order value of ₹${coupon.minOrderValue} required for coupon '${coupon.code}'`,
      );
    }

    const cart = await this.ensureUserCart(userId);
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { couponCode: coupon.code },
    });

    return this.getCart(userId);
  }

  async removeCoupon(userId: string) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId);
    const cart = await this.prisma.cart.findUnique({ where: { userId: canonicalUserId } });
    if (cart) {
      await this.prisma.cart.update({
        where: { id: cart.id },
        data: { couponCode: null },
      });
    }
    return this.getCart(canonicalUserId);
  }

  async updatePreferences(userId: string, dto: UpdateCartPreferencesDto) {
    this.ensureDbConnected();
    const cart = await this.ensureUserCart(userId);

    await this.prisma.cart.update({
      where: { id: cart.id },
      data: {
        ...(dto.giftWrap !== undefined ? { giftWrap: Boolean(dto.giftWrap) } : {}),
        ...(dto.donationAmount !== undefined
          ? { donationAmount: Math.max(0, Math.round(Number(dto.donationAmount) || 0)) }
          : {}),
      },
    });

    return this.getCart(userId);
  }

  async clearCart(userId: string) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId);
    const cart = await this.prisma.cart.findUnique({ where: { userId: canonicalUserId } });
    if (cart) {
      await this.prisma.$transaction([
        this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } }),
        this.prisma.cart.update({
          where: { id: cart.id },
          data: {
            couponCode: null,
            giftWrap: false,
            donationAmount: 0,
          },
        }),
      ]);
    }
    return { success: true, message: 'Cart cleared successfully' };
  }

  async getAppliedCoupon(userId: string): Promise<string | null> {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId);
    const cart = await this.prisma.cart.findUnique({
      where: { userId: canonicalUserId },
      select: { couponCode: true },
    });
    return cart?.couponCode || null;
  }
}
