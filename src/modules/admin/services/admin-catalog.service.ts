import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  UpdateProductStatusDto,
  UpdateProductStockDto,
} from '../dto/admin-domain.dto';

@Injectable()
export class AdminCatalogService {
  constructor(private prisma: PrismaService) {}

  // ================= CATEGORIES =================

  async listCategories(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let categories = (store.categories || []).map((c: any) => {
      const productCount = store.products.filter(
        (p: any) => p.categoryId === c.id || p.category?.toLowerCase() === c.name?.toLowerCase(),
      ).length;

      return {
        id: c.id,
        code: c.code || `CAT-${c.id.toUpperCase()}`,
        name: c.name,
        slug: c.slug || c.id,
        description: c.description || `${c.name} apparel category and curated collections.`,
        productCount: c.productCount || productCount,
        status: (c.isActive === false ? 'INACTIVE' : c.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
        parentCategory: c.parentCategory || (c.parent ? c.parent.name : undefined),
        displayOrder: c.displayOrder || 1,
        createdAt: c.createdAt || new Date('2026-01-01').toISOString(),
      };
    });

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      categories = categories.filter(
        (c: any) =>
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      );
    }

    if (query.status && query.status !== 'ALL') {
      categories = categories.filter((c: any) => c.status === query.status);
    }

    return {
      data: categories,
      total: categories.length,
    };
  }

  async createCategory(dto: CreateCategoryDto, actorId?: string, actorName?: string) {
    const store = this.prisma.getStore();
    const cleanCode = dto.code.trim().toUpperCase();
    const cleanSlug = (dto.slug || dto.name.toLowerCase().replace(/\s+/g, '-')).trim();

    // Check duplicate code or slug
    const existing = (store.categories || []).find(
      (c: any) => (c.code && c.code.toUpperCase() === cleanCode) || c.slug === cleanSlug,
    );
    if (existing) {
      throw new BadRequestException(`Category with code '${cleanCode}' or slug '${cleanSlug}' already exists.`);
    }

    const newCategory = {
      id: `cat-${Date.now()}`,
      code: cleanCode,
      name: dto.name.trim(),
      slug: cleanSlug,
      description: dto.description || '',
      parentCategory: dto.parentCategory || null,
      status: dto.status || 'ACTIVE',
      isActive: dto.status !== 'INACTIVE',
      displayOrder: dto.displayOrder || 0,
      productCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.categories.push(newCategory);

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'CATEGORY_CREATED' as any,
      entityId: newCategory.id,
      entityName: newCategory.name,
      entityType: 'Product' as any,
      summary: `Created apparel category '${newCategory.name}' (${newCategory.code})`,
      targetDescription: `Catalog Category Tree`,
      changePayload: {
        code: newCategory.code,
        name: newCategory.name,
        slug: newCategory.slug,
      },
      entityLink: `/admin/categories`,
    });

    return {
      success: true,
      message: `Category '${newCategory.name}' created successfully.`,
      category: newCategory,
    };
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actorId?: string, actorName?: string) {
    const store = this.prisma.getStore();
    const category = (store.categories || []).find((c: any) => c.id === id || c.code === id);

    if (!category) {
      throw new NotFoundException(`Category record '${id}' was not found.`);
    }

    if (dto.name) category.name = dto.name.trim();
    if (dto.code) category.code = dto.code.trim().toUpperCase();
    if (dto.slug) category.slug = dto.slug.trim();
    if (dto.description !== undefined) category.description = dto.description;
    if (dto.parentCategory !== undefined) category.parentCategory = dto.parentCategory;
    if (dto.status) {
      category.status = dto.status;
      category.isActive = dto.status === 'ACTIVE';
    }
    if (dto.displayOrder !== undefined) category.displayOrder = dto.displayOrder;
    category.updatedAt = new Date().toISOString();

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'CATEGORY_UPDATED' as any,
      entityId: category.id,
      entityName: category.name,
      entityType: 'Product' as any,
      summary: `Updated category '${category.name}' details`,
      targetDescription: `Catalog Category Tree`,
      changePayload: { ...dto },
      entityLink: `/admin/categories`,
    });

    return {
      success: true,
      message: `Category '${category.name}' updated successfully.`,
      category,
    };
  }

  async deleteCategory(id: string, actorId?: string, actorName?: string) {
    const store = this.prisma.getStore();
    const index = (store.categories || []).findIndex((c: any) => c.id === id || c.code === id);

    if (index === -1) {
      throw new NotFoundException(`Category record '${id}' was not found.`);
    }

    const category = store.categories[index];

    // Check dependent products
    const dependentProducts = store.products.filter(
      (p: any) => p.categoryId === category.id || p.category?.toLowerCase() === category.name?.toLowerCase(),
    );
    if (dependentProducts.length > 0) {
      throw new BadRequestException(
        `Cannot delete category '${category.name}' because ${dependentProducts.length} product(s) are assigned to it.`,
      );
    }

    store.categories.splice(index, 1);

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'CATEGORY_DELETED' as any,
      entityId: category.id,
      entityName: category.name,
      entityType: 'Product' as any,
      summary: `Deleted category '${category.name}' from catalog tree`,
      targetDescription: `Catalog Category Tree`,
      entityLink: `/admin/categories`,
    });

    return {
      success: true,
      message: `Category '${category.name}' deleted successfully.`,
    };
  }

  // ================= PRODUCTS =================

  async listProducts(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let products = store.products.map((p: any) => {
      const vendor = (store.adminVendors || []).find((v: any) => v.id === p.vendorId) || {
        storeName: 'Avanya Ethnic Boutique',
      };

      const stockStatus =
        p.stockQuantity <= 0
          ? 'OUT_OF_STOCK'
          : p.stockQuantity <= 5
          ? 'LOW_STOCK'
          : 'IN_STOCK';

      return {
        id: p.id,
        sku: p.sku || `SKU-${p.id.toUpperCase()}`,
        title: p.title,
        brand: p.brand,
        category: p.category || (typeof p.categoryId === 'string' ? p.categoryId : 'Kurtis'),
        vendorName: p.vendorName || vendor.storeName,
        vendorId: p.vendorId || vendor.id,
        sellingPrice: p.price,
        originalPrice: p.originalPrice || p.price * 1.5,
        stockQuantity: p.stockQuantity,
        stockStatus,
        fulfillmentType: p.fulfillmentType || 'DARK_STORE',
        listingStatus: p.listingStatus || 'ACTIVE',
        tryAndBuyEligible: p.tryAndBuyEligible !== false,
        hubAssignment: p.hubAssignment || 'Bandra West Terminal Hub, Mumbai',
        primaryImageUrl: p.image,
        galleryImages: (p.galleryImages || []).map((url: string, idx: number) => ({
          url,
          label: idx === 0 ? 'Primary Asset' : `Angle ${idx + 1}`,
          tag: idx === 0 ? 'Primary' : undefined,
        })),
        description: p.description,
        specifications: [
          { label: 'Fabric Weave', value: p.fabric || 'Pure Silk / Cotton blend' },
          { label: 'Origin Atelier', value: p.origin || 'Mumbai Studio' },
          { label: 'Available Sizes', value: Array.isArray(p.sizes) ? p.sizes.join(', ') : 'S, M, L, XL' },
          { label: 'Fulfillment Class', value: p.fulfillmentType === 'DARK_STORE' ? 'Dark Store Express' : 'Vendor Dispatch' },
        ],
        createdAt: p.createdAt || new Date('2026-01-10').toISOString(),
        updatedAt: p.updatedAt || new Date('2026-01-15').toISOString(),
      };
    });

    // Filter by search
    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      products = products.filter(
        (p: any) =>
          p.title.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.vendorName.toLowerCase().includes(q),
      );
    }

    // Filter by status tab
    if (query.status && query.status !== 'ALL') {
      if (query.status === 'ACTIVE') {
        products = products.filter((p: any) => p.listingStatus === 'ACTIVE');
      } else if (query.status === 'LOW_STOCK') {
        products = products.filter((p: any) => p.stockStatus === 'LOW_STOCK');
      } else if (query.status === 'OUT_OF_STOCK') {
        products = products.filter((p: any) => p.stockStatus === 'OUT_OF_STOCK');
      } else if (query.status === 'DRAFT') {
        products = products.filter((p: any) => p.listingStatus === 'DRAFT' || p.listingStatus === 'REVIEW');
      } else {
        products = products.filter((p: any) => p.listingStatus === query.status);
      }
    }

    // Filter by category
    if (query.category && query.category !== 'ALL') {
      products = products.filter((p: any) => p.category.toLowerCase() === query.category.toLowerCase());
    }

    // Filter by vendor
    if (query.vendor && query.vendor !== 'ALL') {
      products = products.filter((p: any) => p.vendorName === query.vendor);
    }

    // Filter by fulfillment
    if (query.fulfillmentType && query.fulfillmentType !== 'ALL') {
      products = products.filter((p: any) => p.fulfillmentType === query.fulfillmentType);
    }

    const total = products.length;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const paginated = products.slice(startIndex, startIndex + limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getProductById(id: string) {
    const listRes = await this.listProducts({ limit: 1000 });
    const product = listRes.data.find(
      (p: any) => p.id === id || p.sku.toLowerCase() === id.toLowerCase() || p.id.replace('prod-', '') === id,
    );

    if (!product) {
      throw new NotFoundException(`Product record '${id}' was not found.`);
    }

    return product;
  }

  async updateProductStatus(id: string, dto: UpdateProductStatusDto, actorId?: string, actorName?: string) {
    const store = this.prisma.getStore();
    const product = store.products.find(
      (p: any) => p.id === id || p.id.replace('prod-', '') === id,
    );

    if (!product) {
      throw new NotFoundException(`Product record '${id}' was not found.`);
    }

    const previousStatus = (product as any).listingStatus || 'ACTIVE';
    (product as any).listingStatus = dto.listingStatus;
    (product as any).updatedAt = new Date().toISOString();

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'PRODUCT_STATUS_CHANGED' as any,
      entityId: product.id,
      entityName: product.title,
      entityType: 'Product' as any,
      summary: `Product '${product.title}' listing status changed: ${previousStatus} -> ${dto.listingStatus}`,
      targetDescription: `Catalog SKU #${product.id}`,
      changePayload: {
        previousStatus,
        newStatus: dto.listingStatus,
      },
      entityLink: `/admin/products/${product.id}`,
    });

    return {
      success: true,
      message: `Product listing status updated to ${dto.listingStatus}.`,
      product,
    };
  }

  async updateProductStock(id: string, dto: UpdateProductStockDto, actorId?: string, actorName?: string) {
    const store = this.prisma.getStore();
    const product = store.products.find(
      (p: any) => p.id === id || p.id.replace('prod-', '') === id,
    );

    if (!product) {
      throw new NotFoundException(`Product record '${id}' was not found.`);
    }

    const previousStock = product.stockQuantity;
    product.stockQuantity = dto.stockQuantity;
    (product as any).stockStatus =
      dto.stockQuantity <= 0 ? 'OUT_OF_STOCK' : dto.stockQuantity <= 5 ? 'LOW_STOCK' : 'IN_STOCK';
    (product as any).updatedAt = new Date().toISOString();

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'PRODUCT_STOCK_UPDATED' as any,
      entityId: product.id,
      entityName: product.title,
      entityType: 'Product' as any,
      summary: `Product '${product.title}' inventory stock adjusted: ${previousStock} -> ${dto.stockQuantity} units`,
      targetDescription: `Catalog SKU #${product.id}`,
      changePayload: {
        previousStock,
        newStock: dto.stockQuantity,
      },
      entityLink: `/admin/products/${product.id}`,
    });

    return {
      success: true,
      message: `Product stock updated to ${dto.stockQuantity} units.`,
      product,
    };
  }
}
