import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetProductsDto } from './dto/get-products.dto';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  async getCategories() {
    return this.prisma.getStore().categories;
  }

  async getProducts(query?: GetProductsDto) {
    let products = [...this.prisma.getStore().products];

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

    if (query?.sort) {
      switch (query.sort) {
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
      }
    }

    // Attach real-time stock badge if stock is low
    return products.map((p) => ({
      ...p,
      stockBadge:
        p.stockQuantity <= 0
          ? 'Out of Stock'
          : p.stockQuantity <= 3
          ? `Only ${p.stockQuantity} Left`
          : 'In Stock',
      inStock: p.stockQuantity > 0,
    }));
  }

  async getProductById(id: string) {
    const product = this.prisma.getStore().products.find((p) => p.id === id);
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    const vendor = this.prisma.getStore().vendors.find((v) => v.id === product.vendorId);

    return {
      ...product,
      stockBadge:
        product.stockQuantity <= 0
          ? 'Out of Stock'
          : product.stockQuantity <= 3
          ? `Only ${product.stockQuantity} Left`
          : 'In Stock',
      inStock: product.stockQuantity > 0,
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
