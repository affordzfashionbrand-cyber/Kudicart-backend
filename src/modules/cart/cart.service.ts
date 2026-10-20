import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CartService {
  private userCoupons: Record<string, string> = {};

  constructor(private prisma: PrismaService) {}

  async getCart(userId: string) {
    const store = this.prisma.getStore();
    const userCartItems = store.cartItems.filter((ci) => ci.userId === userId);

    const items = userCartItems.map((ci) => {
      const prod = store.products.find((p) => p.id === ci.productId);
      const hub = prod?.darkStoreHubId
        ? store.darkStores.find((h) => h.id === prod.darkStoreHubId)
        : null;

      return {
        id: ci.id,
        productId: ci.productId,
        title: prod?.title || 'Affordz Item',
        brand: prod?.brand || 'Avanya Ethnic',
        size: ci.size,
        trialSize: ci.trialSize || null,
        isTryAndBuy: Boolean(ci.trialSize || prod?.tryAndBuyEligible),
        fulfillmentType: prod?.fulfillmentType || 'VENDOR',
        darkStoreHub: hub,
        price: prod?.price || 1299,
        originalPrice: prod?.originalPrice || 2499,
        discount: prod?.discount || '48% OFF',
        quantity: ci.quantity,
        image: prod?.image || '',
        altText: prod?.altText || '',
        stockAvailable: prod?.stockQuantity ?? 10,
      };
    });

    const itemTotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);

    // Coupon calculation
    let discountAmount = 0;
    let appliedCouponInfo: any = null;
    const appliedCode = this.userCoupons[userId];

    if (appliedCode && itemTotal > 0) {
      const coupon = store.coupons.find(
        (c) => c.code.toUpperCase() === appliedCode.toUpperCase(),
      );

      if (coupon && coupon.isActive && itemTotal >= coupon.minOrderValue) {
        if (coupon.discountType === 'PERCENTAGE') {
          discountAmount = Math.round((itemTotal * coupon.discountValue) / 100);
          if (coupon.maxDiscount) {
            discountAmount = Math.min(discountAmount, coupon.maxDiscount);
          }
        } else {
          discountAmount = Math.min(itemTotal, coupon.discountValue);
        }

        appliedCouponInfo = {
          id: coupon.id,
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          discountAmount,
        };
      } else {
        // Condition no longer met
        delete this.userCoupons[userId];
      }
    }

    // Delivery fee: Free on orders ₹1,499 and above
    const deliveryFee = itemTotal > 0 ? (itemTotal >= 1499 ? 0 : 40) : 0;
    const taxes = Math.round(itemTotal * 0.05); // 5% GST
    const grandTotal = Math.max(0, itemTotal - discountAmount) + deliveryFee + taxes;

    return {
      items,
      itemTotal,
      deliveryFee,
      taxes,
      discountAmount,
      coupon: appliedCouponInfo,
      couponCode: appliedCouponInfo ? appliedCouponInfo.code : null,
      grandTotal,
      count: items.reduce((acc, item) => acc + item.quantity, 0),
    };
  }

  async addItem(userId: string, productId: string, size?: string, quantity: number = 1, trialSize?: string) {
    const store = this.prisma.getStore();
    const product = store.products.find((p) => p.id === productId);

    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    if (product.stockQuantity <= 0) {
      throw new BadRequestException(`Product '${product.title}' is currently out of stock`);
    }

    const itemSize = size || (product.sizes && product.sizes.length > 0 ? product.sizes[0] : 'Free Size');
    const existing = store.cartItems.find(
      (ci) => ci.userId === userId && ci.productId === productId && ci.size === itemSize,
    );

    if (existing) {
      if (existing.quantity + quantity > product.stockQuantity) {
        throw new BadRequestException(
          `Cannot add more items. Only ${product.stockQuantity} units available in stock.`,
        );
      }
      existing.quantity += quantity;
      if (trialSize) {
        existing.trialSize = trialSize;
      }
    } else {
      if (quantity > product.stockQuantity) {
        throw new BadRequestException(
          `Requested quantity (${quantity}) exceeds available stock (${product.stockQuantity}).`,
        );
      }
      store.cartItems.push({
        id: `cart-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        userId,
        productId,
        size: itemSize,
        trialSize,
        quantity,
      });
    }

    return this.getCart(userId);
  }

  async updateQuantity(userId: string, id: string, delta: number) {
    const store = this.prisma.getStore();
    const itemIndex = store.cartItems.findIndex((ci) => ci.id === id && ci.userId === userId);

    if (itemIndex === -1) {
      throw new NotFoundException(`Cart item ${id} not found`);
    }

    const item = store.cartItems[itemIndex];
    const product = store.products.find((p) => p.id === item.productId);
    const newQty = item.quantity + delta;

    if (newQty <= 0) {
      store.cartItems.splice(itemIndex, 1);
    } else {
      if (product && newQty > product.stockQuantity) {
        throw new BadRequestException(
          `Cannot increase quantity. Only ${product.stockQuantity} units available.`,
        );
      }
      item.quantity = newQty;
    }

    return this.getCart(userId);
  }

  async removeItem(userId: string, id: string) {
    const store = this.prisma.getStore();
    const itemIndex = store.cartItems.findIndex((ci) => ci.id === id && ci.userId === userId);

    if (itemIndex === -1) {
      throw new NotFoundException(`Cart item ${id} not found`);
    }

    store.cartItems.splice(itemIndex, 1);
    return this.getCart(userId);
  }

  async applyCoupon(userId: string, code: string) {
    const cleanCode = (code || '').trim().toUpperCase();
    const store = this.prisma.getStore();
    const coupon = store.coupons.find((c) => c.code.toUpperCase() === cleanCode);

    if (!coupon) {
      throw new NotFoundException(`Coupon '${cleanCode}' is invalid`);
    }

    if (!coupon.isActive) {
      throw new BadRequestException(`Coupon '${cleanCode}' is no longer active`);
    }

    if (new Date(coupon.endDate) < new Date()) {
      throw new BadRequestException(`Coupon '${cleanCode}' has expired`);
    }

    const userCartItems = store.cartItems.filter((ci) => ci.userId === userId);
    const itemTotal = userCartItems.reduce((acc, ci) => {
      const prod = store.products.find((p) => p.id === ci.productId);
      return acc + (prod?.price || 0) * ci.quantity;
    }, 0);

    if (itemTotal < coupon.minOrderValue) {
      throw new BadRequestException(
        `Minimum order value of ₹${coupon.minOrderValue} required for coupon '${cleanCode}'`,
      );
    }

    this.userCoupons[userId] = cleanCode;
    return this.getCart(userId);
  }

  async removeCoupon(userId: string) {
    delete this.userCoupons[userId];
    return this.getCart(userId);
  }

  async clearCart(userId: string) {
    const store = this.prisma.getStore();
    store.cartItems = store.cartItems.filter((ci) => ci.userId !== userId);
    delete this.userCoupons[userId];
    return { success: true, message: 'Cart cleared successfully' };
  }

  getAppliedCoupon(userId: string): string | null {
    return this.userCoupons[userId] || null;
  }
}
