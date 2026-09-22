import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CartService {
  constructor(private prisma: PrismaService) {}

  async getCart(userId: string) {
    const store = this.prisma.getStore();
    const userCartItems = store.cartItems.filter((ci) => ci.userId === userId);
    
    const items = userCartItems.map((ci) => {
      const prod = store.products.find((p) => p.id === ci.productId);
      return {
        id: ci.id,
        productId: ci.productId,
        title: prod?.title || 'KudiCart Item',
        brand: prod?.brand || 'Avanya Ethnic',
        size: ci.size,
        price: prod?.price || 1299,
        originalPrice: prod?.originalPrice || 2499,
        discount: prod?.discount || '48% OFF',
        quantity: ci.quantity,
        image: prod?.image || '',
        altText: prod?.altText || '',
      };
    });

    const itemTotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const deliveryFee = itemTotal > 0 ? 40 : 0;
    const taxes = Math.round(itemTotal * 0.05); // 5% GST
    const grandTotal = itemTotal + deliveryFee + taxes;

    return {
      items,
      itemTotal,
      deliveryFee,
      taxes,
      grandTotal,
      count: items.reduce((acc, item) => acc + item.quantity, 0),
    };
  }

  async addItem(userId: string, productId: string, size?: string) {
    const store = this.prisma.getStore();
    const existing = store.cartItems.find(
      (ci) => ci.userId === userId && ci.productId === productId && ci.size === (size || 'Size M'),
    );
    if (existing) {
      existing.quantity += 1;
    } else {
      store.cartItems.push({
        id: `cart-${Date.now()}`,
        userId,
        productId,
        size: size || 'Size M',
        quantity: 1,
      });
    }
    return this.getCart(userId);
  }

  async updateQuantity(id: string, delta: number) {
    const store = this.prisma.getStore();
    const itemIndex = store.cartItems.findIndex((ci) => ci.id === id);
    if (itemIndex > -1) {
      const newQty = store.cartItems[itemIndex].quantity + delta;
      if (newQty <= 0) {
        store.cartItems.splice(itemIndex, 1);
      } else {
        store.cartItems[itemIndex].quantity = newQty;
      }
    }
    return this.getCart('usr-1');
  }

  async removeItem(id: string) {
    const store = this.prisma.getStore();
    const itemIndex = store.cartItems.findIndex((ci) => ci.id === id);
    if (itemIndex > -1) {
      store.cartItems.splice(itemIndex, 1);
    }
    return this.getCart('usr-1');
  }
}
