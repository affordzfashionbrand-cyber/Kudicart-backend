import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  async getCategories() {
    return this.prisma.getStore().categories;
  }

  async getProducts(category?: string, search?: string) {
    let products = this.prisma.getStore().products;
    if (category && category !== 'all') {
      products = products.filter(
        (p) => p.category.toLowerCase() === category.toLowerCase(),
      );
    }
    if (search) {
      const q = search.toLowerCase();
      products = products.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          (p.fabric && p.fabric.toLowerCase().includes(q)),
      );
    }
    return products;
  }

  async getProductById(id: string) {
    const product = this.prisma.getStore().products.find((p) => p.id === id);
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }
}
