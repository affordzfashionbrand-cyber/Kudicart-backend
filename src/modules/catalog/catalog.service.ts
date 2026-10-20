import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetProductsDto } from './dto/get-products.dto';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  async getCategories() {
    const store = this.prisma.getStore();
    return store.categories.map((c) => {
      const count = store.products.filter(
        (p) =>
          p.category.toLowerCase() === c.name.toLowerCase() ||
          p.categoryId.toLowerCase() === c.id.toLowerCase(),
      ).length;
      return {
        ...c,
        productCount: count,
        countText: `${count} styles`,
      };
    });
  }

  async getDarkStores() {
    return this.prisma.getStore().darkStores;
  }

  async getActiveCoupons() {
    return this.prisma.getStore().coupons.filter((c) => c.isActive);
  }

  async getProducts(query?: GetProductsDto) {
    let products = [...this.prisma.getStore().products];

    if (query?.fulfillmentType) {
      const ft = query.fulfillmentType.toUpperCase();
      products = products.filter((p: any) => p.fulfillmentType === ft);
    }

    if (query?.tryAndBuyOnly === 'true' || query?.tryAndBuyOnly === '1') {
      products = products.filter((p: any) => p.tryAndBuyEligible === true);
    }

    if (query?.category && query.category.toLowerCase() !== 'all') {
      const cat = query.category.toLowerCase();
      products = products.filter(
        (p) =>
          p.category.toLowerCase() === cat ||
          p.categoryId.toLowerCase() === cat,
      );
    }

    if (query?.search) {
      const q = query.search.toLowerCase().trim();
      products = products.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          (p.fabric && p.fabric.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q)),
      );
    }

    if (query?.minPrice !== undefined && query?.minPrice !== '') {
      const min = Number(query.minPrice);
      if (!isNaN(min)) {
        products = products.filter((p) => p.price >= min);
      }
    }

    if (query?.maxPrice !== undefined && query?.maxPrice !== '') {
      const max = Number(query.maxPrice);
      if (!isNaN(max)) {
        products = products.filter((p) => p.price <= max);
      }
    }

    const sortOption = query?.sortBy || query?.sort;
    if (sortOption) {
      switch (sortOption) {
        case 'price_asc':
          products.sort((a, b) => a.price - b.price);
          break;
        case 'price_desc':
          products.sort((a, b) => b.price - a.price);
          break;
        case 'rating':
          products.sort((a, b) => b.rating - a.rating);
          break;
        case 'popular':
          products.sort((a, b) => b.reviewsCount - a.reviewsCount);
          break;
        case 'newest':
          products.sort((a, b) => (b.id > a.id ? 1 : -1));
          break;
      }
    }

    // Attach real-time stock badge and hub details
    const mapped = products.map((p: any) => {
      const hub = p.darkStoreHubId
        ? this.prisma.getStore().darkStores.find((h) => h.id === p.darkStoreHubId)
        : null;

      return {
        ...p,
        stockBadge:
          p.stockQuantity <= 0
            ? 'Out of Stock'
            : p.stockQuantity <= 3
            ? `Only ${p.stockQuantity} Left`
            : p.fulfillmentType === 'DARK_STORE'
            ? `${hub?.deliveryMinutes || 18}m Delivery`
            : 'In Stock',
        inStock: p.stockQuantity > 0,
        darkStoreHub: hub,
      };
    });

    if (query?.page && query?.limit) {
      const page = Math.max(1, Number(query.page));
      const limit = Math.max(1, Number(query.limit));
      const start = (page - 1) * limit;
      return mapped.slice(start, start + limit);
    }

    return mapped;
  }

  async getProductById(id: string) {
    const product: any = this.prisma.getStore().products.find((p) => p.id === id);
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    const vendor = this.prisma.getStore().vendors.find((v) => v.id === product.vendorId);
    const hub = product.darkStoreHubId
      ? this.prisma.getStore().darkStores.find((h) => h.id === product.darkStoreHubId)
      : null;

    return {
      ...product,
      stockBadge:
        product.stockQuantity <= 0
          ? 'Out of Stock'
          : product.stockQuantity <= 3
          ? `Only ${product.stockQuantity} Left`
          : product.fulfillmentType === 'DARK_STORE'
          ? `${hub?.deliveryMinutes || 18}m Delivery`
          : 'In Stock',
      inStock: product.stockQuantity > 0,
      darkStoreHub: hub,
      vendor: vendor
        ? {
            id: vendor.id,
            storeName: vendor.storeName,
            address: vendor.address,
          }
        : undefined,
    };
  }
}
