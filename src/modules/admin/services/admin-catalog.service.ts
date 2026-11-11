import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import {
  CreateCategoryDto,
  CreateCouponDto,
  UpdateCategoryDto,
  UpdateCouponDto,
  UpdateProductStatusDto,
  UpdateProductStockDto,
} from '../dto/admin-domain.dto';
import { CreateDarkStoreProductDto } from '../dto/create-dark-store-product.dto';

@Injectable()
export class AdminCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDb() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }
  }

  private async writeAudit(
    txOrPrisma: any,
    actorId: string | undefined,
    actorName: string | undefined,
    action: string,
    entityType: string,
    entityId: string,
    details: Record<string, unknown>,
  ) {
    await txOrPrisma.auditLog.create({
      data: {
        userId: actorId || 'ADMIN',
        userEmail: actorName || null,
        userRole: 'ADMIN',
        action,
        entityType,
        entityId,
        details: JSON.stringify(details),
      },
    });
  }

  private formatProduct(p: any) {
    const stockStatus =
      p.stockQuantity <= 0
        ? 'OUT_OF_STOCK'
        : p.stockQuantity <= 5
          ? 'LOW_STOCK'
          : 'IN_STOCK';

    const vendorName =
      p.vendor?.storeName ||
      (p.fulfillmentType === 'DARK_STORE' ? 'Affordz Official Store' : 'Partner Store');

    const rawGallery = Array.isArray(p.galleryImages) && p.galleryImages.length > 0
      ? p.galleryImages
      : [p.image];

    const galleryImages = rawGallery.map((url: string, idx: number) => ({
      url,
      label: idx === 0 ? 'Primary Asset' : `Angle ${idx + 1}`,
      tag: idx === 0 ? 'Primary' : undefined,
    }));

    const specifications =
      Array.isArray(p.specifications) && p.specifications.length > 0
        ? p.specifications
        : [
            { label: 'Fabric Weave', value: p.fabric || 'Pure Silk / Cotton blend' },
            { label: 'Origin Atelier', value: p.origin || 'Mumbai Studio' },
            {
              label: 'Available Sizes',
              value: Array.isArray(p.sizes) && p.sizes.length > 0 ? p.sizes.join(', ') : 'S, M, L, XL',
            },
            {
              label: 'Fulfillment Class',
              value: p.fulfillmentType === 'DARK_STORE' ? 'Dark Store Express' : 'Vendor Dispatch',
            },
          ];

    return {
      ...p,
      sku: p.sku || `SKU-${p.id.toUpperCase()}`,
      category: p.category?.name || p.categoryId,
      vendorName,
      vendorId: p.vendorId,
      vendor: p.vendor
        ? {
            id: p.vendor.id,
            storeName: p.vendor.storeName,
            contactPerson: p.vendor.contactPerson || 'Affordz Concierge',
          }
        : {
            id: p.vendorId || 'vend-affordz-official',
            storeName: vendorName,
            contactPerson: 'Affordz Concierge',
          },
      sellingPrice: p.price,
      originalPrice: p.originalPrice || p.price,
      stockStatus,
      listingStatus: p.listingStatus || 'ACTIVE',
      hubAssignment: p.darkStoreHub?.name || 'Indiranagar Express Pod',
      primaryImageUrl: p.image,
      galleryImages,
      specifications,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    };
  }

  // ================= CATEGORIES =================

  async listCategories(query: AdminQueryDto) {
    this.ensureDb();

    const rows = await this.prisma.category.findMany({
      include: {
        parent: true,
        _count: { select: { products: true } },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    let categories = rows.map((c) => ({
      id: c.id,
      code: c.code || `CAT-${c.id.toUpperCase()}`,
      name: c.name,
      slug: c.slug || c.id,
      description: c.description || `${c.name} apparel category and curated collections.`,
      productCount: c._count?.products ?? 0,
      status: (c.isActive ? 'ACTIVE' : 'INACTIVE') as 'ACTIVE' | 'INACTIVE',
      parentCategory: c.parent?.name || undefined,
      parentId: c.parentId || null,
      level: c.level,
      displayOrder: c.displayOrder || 0,
      createdAt: c.createdAt.toISOString(),
    }));

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      categories = categories.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      );
    }

    if (query.status && query.status !== 'ALL') {
      categories = categories.filter((c) => c.status === query.status);
    }

    return {
      data: categories,
      total: categories.length,
    };
  }

  async createCategory(dto: CreateCategoryDto, actorId?: string, actorName?: string) {
    this.ensureDb();

    const cleanCode = dto.code.trim().toUpperCase();
    const cleanSlug = (dto.slug || dto.name.toLowerCase().replace(/\s+/g, '-')).trim();

    const existing = await this.prisma.category.findFirst({
      where: {
        OR: [
          { code: { equals: cleanCode, mode: 'insensitive' } },
          { slug: cleanSlug },
        ],
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Category with code '${cleanCode}' or slug '${cleanSlug}' already exists.`,
      );
    }

    let parentCategoryRecord: any = null;
    if (dto.parentCategory && dto.parentCategory.trim()) {
      const pTerm = dto.parentCategory.trim();
      parentCategoryRecord = await this.prisma.category.findFirst({
        where: {
          OR: [
            { id: pTerm },
            { code: { equals: pTerm, mode: 'insensitive' } },
            { name: { equals: pTerm, mode: 'insensitive' } },
            { slug: pTerm },
          ],
        },
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.category.create({
        data: {
          code: cleanCode,
          name: dto.name.trim(),
          slug: cleanSlug,
          description: dto.description || '',
          parentId: parentCategoryRecord?.id || null,
          level: parentCategoryRecord ? (parentCategoryRecord.level || 1) + 1 : 1,
          isActive: dto.status !== 'INACTIVE',
          displayOrder: dto.displayOrder ?? 0,
        },
        include: { parent: true, _count: { select: { products: true } } },
      });

      await this.writeAudit(tx, actorId, actorName, 'CATEGORY_CREATED', 'Category', row.id, {
        code: row.code,
        name: row.name,
        slug: row.slug,
        parentCategory: row.parent?.name || null,
      });

      return row;
    });

    const formatted = {
      id: created.id,
      code: created.code,
      name: created.name,
      slug: created.slug,
      description: created.description || '',
      productCount: created._count?.products ?? 0,
      status: created.isActive ? 'ACTIVE' : 'INACTIVE',
      parentCategory: created.parent?.name || null,
      displayOrder: created.displayOrder,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };

    return {
      success: true,
      message: `Category '${created.name}' created successfully.`,
      category: formatted,
    };
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actorId?: string, actorName?: string) {
    this.ensureDb();

    const existing = await this.prisma.category.findFirst({
      where: {
        OR: [{ id }, { code: id }, { slug: id }],
      },
      include: { parent: true },
    });

    if (!existing) {
      throw new NotFoundException(`Category record '${id}' was not found.`);
    }

    let parentId = existing.parentId;
    let level = existing.level;
    if (dto.parentCategory !== undefined) {
      if (!dto.parentCategory || !dto.parentCategory.trim()) {
        parentId = null;
        level = 1;
      } else {
        const pTerm = dto.parentCategory.trim();
        const pRec = await this.prisma.category.findFirst({
          where: {
            OR: [
              { id: pTerm },
              { code: { equals: pTerm, mode: 'insensitive' } },
              { name: { equals: pTerm, mode: 'insensitive' } },
            ],
          },
        });
        if (pRec) {
          parentId = pRec.id;
          level = (pRec.level || 1) + 1;
        }
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.category.update({
        where: { id: existing.id },
        data: {
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(dto.slug ? { slug: dto.slug.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.status ? { isActive: dto.status !== 'INACTIVE' } : {}),
          ...(dto.displayOrder !== undefined ? { displayOrder: dto.displayOrder } : {}),
          parentId,
          level,
        },
        include: { parent: true, _count: { select: { products: true } } },
      });

      await this.writeAudit(tx, actorId, actorName, 'CATEGORY_UPDATED', 'Category', row.id, {
        previousName: existing.name,
        name: row.name,
        isActive: row.isActive,
      });

      return row;
    });

    const formatted = {
      id: updated.id,
      code: updated.code,
      name: updated.name,
      slug: updated.slug,
      description: updated.description || '',
      productCount: updated._count?.products ?? 0,
      status: updated.isActive ? 'ACTIVE' : 'INACTIVE',
      parentCategory: updated.parent?.name || null,
      displayOrder: updated.displayOrder,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };

    return {
      success: true,
      message: `Category '${updated.name}' updated successfully.`,
      category: formatted,
    };
  }

  async deleteCategory(id: string, actorId?: string, actorName?: string) {
    this.ensureDb();

    const existing = await this.prisma.category.findFirst({
      where: {
        OR: [{ id }, { code: id }, { slug: id }],
      },
    });

    if (!existing) {
      throw new NotFoundException(`Category record '${id}' was not found.`);
    }

    const dependentCount = await this.prisma.product.count({
      where: { categoryId: existing.id },
    });
    if (dependentCount > 0) {
      throw new BadRequestException(
        `Cannot delete category '${existing.name}' because ${dependentCount} product(s) are assigned to it.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.category.delete({ where: { id: existing.id } });
      await this.writeAudit(tx, actorId, actorName, 'CATEGORY_DELETED', 'Category', existing.id, {
        name: existing.name,
        code: existing.code,
      });
    });

    return {
      success: true,
      message: `Category '${existing.name}' deleted successfully.`,
    };
  }

  // ================= PRODUCTS =================

  async listProducts(query: AdminQueryDto) {
    this.ensureDb();

    const rows = await this.prisma.product.findMany({
      include: {
        vendor: true,
        category: true,
        darkStoreHub: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let products = rows.map((p) => this.formatProduct(p));

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      products = products.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.vendorName.toLowerCase().includes(q),
      );
    }

    if (query.category && query.category !== 'ALL') {
      const catQ = query.category.toLowerCase();
      products = products.filter(
        (p) =>
          p.category.toLowerCase() === catQ ||
          (p.categoryId && p.categoryId.toLowerCase() === catQ),
      );
    }

    if (query.vendor && query.vendor !== 'ALL') {
      products = products.filter(
        (p) =>
          p.vendorName.toLowerCase() === query.vendor!.toLowerCase() ||
          p.vendorId === query.vendor,
      );
    }

    const fulfillmentFilter = query.fulfillmentType || (query as any).fulfillment;
    if (fulfillmentFilter && fulfillmentFilter !== 'ALL') {
      products = products.filter((p) => p.fulfillmentType === fulfillmentFilter);
    }

    if (query.status && query.status !== 'ALL') {
      if (query.status === 'LOW_STOCK') {
        products = products.filter((p) => p.stockStatus === 'LOW_STOCK');
      } else if (query.status === 'OUT_OF_STOCK') {
        products = products.filter((p) => p.stockStatus === 'OUT_OF_STOCK');
      } else if (query.status === 'ACTIVE') {
        products = products.filter((p) => p.listingStatus === 'ACTIVE');
      } else if (query.status === 'DRAFT') {
        products = products.filter(
          (p) => p.listingStatus === 'DRAFT' || p.listingStatus === 'REVIEW',
        );
      } else {
        products = products.filter((p) => p.listingStatus === query.status);
      }
    }

    const total = products.length;
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 20);
    const startIndex = (page - 1) * limit;
    const paginatedProducts = products.slice(startIndex, startIndex + limit);

    return {
      data: paginatedProducts,
      total,
      page,
      limit,
    };
  }

  async getProductById(id: string) {
    this.ensureDb();

    const product = await this.prisma.product.findFirst({
      where: {
        OR: [{ id }, { id: `prod-${id}` }],
      },
      include: {
        vendor: true,
        category: true,
        darkStoreHub: true,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product record '${id}' was not found in catalog.`);
    }

    return this.formatProduct(product);
  }

  async updateProductStatus(
    id: string,
    dto: UpdateProductStatusDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDb();

    const nextStatus = dto.listingStatus || dto.status;
    if (!nextStatus) {
      throw new BadRequestException('Listing status is required');
    }

    const existing = await this.prisma.product.findFirst({
      where: { OR: [{ id }, { id: `prod-${id}` }] },
    });

    if (!existing) {
      throw new NotFoundException(`Product record '${id}' was not found.`);
    }

    const previousStatus = existing.listingStatus || 'ACTIVE';
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.product.update({
        where: { id: existing.id },
        data: { listingStatus: nextStatus },
        include: { vendor: true, category: true, darkStoreHub: true },
      });

      await this.writeAudit(
        tx,
        actorId,
        actorName,
        'PRODUCT_STATUS_UPDATED',
        'Product',
        row.id,
        {
          title: row.title,
          previousStatus,
          newStatus: nextStatus,
        },
      );

      return row;
    });

    return {
      success: true,
      message: `Product listing status updated to ${nextStatus}.`,
      product: this.formatProduct(updated),
    };
  }

  async updateProductStock(
    id: string,
    dto: UpdateProductStockDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDb();

    const rawQty = dto.stockQuantity ?? dto.stock;
    if (rawQty === undefined || rawQty === null || Number.isNaN(Number(rawQty))) {
      throw new BadRequestException('Stock quantity is required');
    }
    const nextQty = Number(rawQty);

    const existing = await this.prisma.product.findFirst({
      where: { OR: [{ id }, { id: `prod-${id}` }] },
    });

    if (!existing) {
      throw new NotFoundException(`Product record '${id}' was not found.`);
    }

    const previousStock = existing.stockQuantity;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.product.update({
        where: { id: existing.id },
        data: {
          stockQuantity: nextQty,
          ...(dto.stockBadge !== undefined ? { stockBadge: dto.stockBadge } : {}),
        },
        include: { vendor: true, category: true, darkStoreHub: true },
      });

      await this.writeAudit(
        tx,
        actorId,
        actorName,
        'PRODUCT_STOCK_UPDATED',
        'Product',
        row.id,
        {
          title: row.title,
          previousStock,
          newStock: nextQty,
        },
      );

      return row;
    });

    return {
      success: true,
      message: `Product stock updated to ${nextQty} units.`,
      product: this.formatProduct(updated),
    };
  }

  async createDarkStoreProduct(
    dto: CreateDarkStoreProductDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDb();

    if (dto.fulfillmentType && dto.fulfillmentType !== 'DARK_STORE') {
      throw new BadRequestException(
        'Admin product creation strictly supports DARK_STORE fulfillment. Vendor products must be submitted via the Vendor Portal.',
      );
    }

    if (dto.originalPrice < dto.price) {
      throw new BadRequestException(
        `Original Price (MRP ₹${dto.originalPrice}) cannot be less than Selling Price (₹${dto.price}).`,
      );
    }

    const category = await this.prisma.category.findFirst({
      where: {
        OR: [
          { id: dto.categoryId },
          { slug: dto.categoryId },
          { code: dto.categoryId },
          { name: { equals: dto.categoryId, mode: 'insensitive' } },
        ],
      },
    });
    if (!category) {
      throw new BadRequestException(
        `Selected Category '${dto.categoryId}' does not exist or is inactive.`,
      );
    }

    const hub = await this.prisma.darkStoreHub.findFirst({
      where: {
        OR: [
          { id: dto.darkStoreHubId },
          { id: `hub-${dto.darkStoreHubId}` },
        ],
      },
    });
    if (!hub) {
      throw new BadRequestException(
        `Selected Dark Store Hub '${dto.darkStoreHubId}' does not exist or is inactive.`,
      );
    }

    const discountPct = Math.round(((dto.originalPrice - dto.price) / dto.originalPrice) * 100);
    const discount = discountPct > 0 ? `${discountPct}% OFF` : '0% OFF';

    const officialVendorId = 'vend-affordz-official';
    const officialStoreName = 'Affordz Official Store';

    let officialVendor = await this.prisma.vendor.findUnique({
      where: { id: officialVendorId },
    });
    if (!officialVendor) {
      const adminOwner =
        (actorId
          ? await this.prisma.user.findUnique({ where: { id: actorId } })
          : null) ||
        (await this.prisma.user.findFirst({
          where: { role: 'ADMIN' },
          orderBy: { createdAt: 'asc' },
        }));

      if (!adminOwner) {
        throw new BadRequestException('Official Store vendor owner account not found');
      }

      officialVendor = await this.prisma.vendor.create({
        data: {
          id: officialVendorId,
          userId: adminOwner.id,
          storeName: officialStoreName,
          commissionRate: 12.5,
          status: 'ACTIVE',
        },
      });
    }

    const cleanBrand = dto.brand?.trim() || officialStoreName;
    const baseTimestamp = Date.now();
    const colorGroupId = `grp-${baseTimestamp}`;
    const rawColors = Array.isArray(dto.colors) && dto.colors.length > 0 ? dto.colors : null;

    const siblingColors = rawColors
      ? rawColors.map((c, idx) => ({
          name: c.name,
          hex: c.hex,
          productId:
            c.productId || (idx === 0 ? `prod-${baseTimestamp}` : `prod-${baseTimestamp}-${idx + 1}`),
          image: c.image?.trim() || dto.image.trim(),
        }))
      : [
          {
            name: 'Classic Fabric',
            hex: '#111111',
            productId: `prod-${baseTimestamp}`,
            image: dto.image.trim(),
          },
        ];

    const createdDbProducts = await this.prisma.$transaction(async (tx) => {
      const rows = [];
      for (let idx = 0; idx < siblingColors.length; idx++) {
        const colorItem = siblingColors[idx];
        const specificColor = rawColors ? rawColors[idx] : null;
        const productSpecificImage = specificColor?.image?.trim() || dto.image.trim();
        const rawGallery =
          Array.isArray(specificColor?.galleryImages) && specificColor.galleryImages.length > 0
            ? specificColor.galleryImages.map((u: string) => u.trim()).filter(Boolean)
            : Array.isArray(dto.galleryImages) && dto.galleryImages.length > 0
              ? dto.galleryImages.map((u: string) => u.trim()).filter(Boolean)
              : [productSpecificImage];

        const productSpecificGallery = rawGallery.includes(productSpecificImage)
          ? rawGallery
          : [productSpecificImage, ...rawGallery];

        const productSpecificStock =
          specificColor?.stockQuantity != null
            ? Number(specificColor.stockQuantity)
            : Number(dto.stockQuantity);

        const row = await tx.product.create({
          data: {
            id: colorItem.productId,
            colorGroupId,
            colorName: colorItem.name,
            colorHex: colorItem.hex,
            vendorId: officialVendor!.id,
            categoryId: category.id,
            brand: cleanBrand,
            title:
              rawColors && rawColors.length > 1
                ? `${dto.title.trim()} - ${colorItem.name}`
                : dto.title.trim(),
            description: dto.description.trim(),
            price: Number(dto.price),
            originalPrice: Number(dto.originalPrice),
            discount,
            rating: 4.8,
            reviewsCount: 0,
            stockQuantity: productSpecificStock,
            stockBadge: 'DARK STORE STOCK',
            listingStatus: 'ACTIVE',
            readyToShip: dto.readyToShip !== false,
            gender: category.gender || 'Women',
            sizes: dto.sizes,
            fabric: dto.fabric?.trim() || null,
            origin: dto.origin?.trim() || null,
            colors: siblingColors as any,
            specifications: dto.specifications ? (dto.specifications as any) : undefined,
            certification: dto.certification?.trim() || 'Silk Mark Certified',
            tags: ['dark-store', 'official-store', 'fast-delivery', colorItem.name.toLowerCase()],
            image: productSpecificImage,
            altText: `${dto.altText.trim()} in ${colorItem.name}`,
            galleryImages: productSpecificGallery,
            fulfillmentType: 'DARK_STORE',
            darkStoreHubId: hub.id,
            tryAndBuyEligible: true,
          },
          include: {
            vendor: true,
            category: true,
            darkStoreHub: true,
          },
        });
        rows.push(row);
      }

      const primary = rows[0];
      await this.writeAudit(
        tx,
        actorId || 'ADM-001',
        actorName || 'Operations Admin',
        'PRODUCT_CREATED',
        'Product',
        primary.id,
        {
          id: primary.id,
          title: primary.title,
          group: colorGroupId,
          colorwaysCount: rows.length,
          colors: siblingColors.map((c) => c.name),
          price: primary.price,
          originalPrice: primary.originalPrice,
          hubId: hub.id,
          stock: primary.stockQuantity,
        },
      );

      return rows;
    });

    const formattedColorways = createdDbProducts.map((p) => ({
      ...this.formatProduct(p),
      vendorName: officialStoreName,
    }));
    const primaryProduct = formattedColorways[0];

    return {
      success: true,
      message:
        formattedColorways.length > 1
          ? `Created ${formattedColorways.length} separate Dark Store colorway products for '${dto.title}'.`
          : `Dark Store product '${primaryProduct.title}' created and assigned to Affordz Official Store.`,
      product: primaryProduct,
      colorways: formattedColorways,
    };
  }

  // ================= COUPONS =================

  async listCoupons(query: AdminQueryDto) {
    this.ensureDb();

    const rows = await this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    let coupons = rows.map((c) => {
      const isExpired = c.endDate < now;
      return {
        ...c,
        status: !c.isActive ? 'INACTIVE' : isExpired ? 'EXPIRED' : 'ACTIVE',
      };
    });

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      coupons = coupons.filter((c) => c.code.toLowerCase().includes(q));
    }

    if (query.status && query.status !== 'ALL') {
      coupons = coupons.filter((c) => c.status === query.status);
    }

    return {
      data: coupons,
      total: coupons.length,
    };
  }

  async createCoupon(dto: CreateCouponDto, actorId?: string, actorName?: string) {
    this.ensureDb();

    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.coupon.findUnique({ where: { code } });
    if (existing) {
      throw new BadRequestException(`Coupon code '${code}' already exists.`);
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const endDate = new Date(dto.endDate);
    if (Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      throw new BadRequestException('Coupon endDate must be a valid date after startDate');
    }

    const coupon = await this.prisma.$transaction(async (tx) => {
      const row = await tx.coupon.create({
        data: {
          code,
          discountType: (dto.discountType || 'PERCENTAGE') as any,
          discountValue: Number(dto.discountValue),
          minOrderValue: Number(dto.minOrderValue ?? 0),
          maxDiscount: dto.maxDiscount !== undefined ? Number(dto.maxDiscount) : null,
          usageLimit: dto.usageLimit !== undefined ? Number(dto.usageLimit) : null,
          startDate,
          endDate,
          isActive: dto.isActive !== false,
        },
      });

      await this.writeAudit(tx, actorId, actorName, 'COUPON_CREATED', 'Coupon', row.id, {
        code: row.code,
        discountType: row.discountType,
        discountValue: row.discountValue,
      });

      return row;
    });

    return {
      success: true,
      message: `Coupon '${coupon.code}' created successfully.`,
      coupon,
    };
  }

  async updateCoupon(id: string, dto: UpdateCouponDto, actorId?: string, actorName?: string) {
    this.ensureDb();

    const existing = await this.prisma.coupon.findFirst({
      where: { OR: [{ id }, { code: id.trim().toUpperCase() }] },
    });
    if (!existing) {
      throw new NotFoundException(`Coupon '${id}' was not found.`);
    }

    const nextCode = dto.code ? dto.code.trim().toUpperCase() : existing.code;
    if (nextCode !== existing.code) {
      const conflict = await this.prisma.coupon.findUnique({ where: { code: nextCode } });
      if (conflict) {
        throw new BadRequestException(`Coupon code '${nextCode}' already exists.`);
      }
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    if (endDate <= startDate) {
      throw new BadRequestException('Coupon endDate must be after startDate');
    }

    const coupon = await this.prisma.$transaction(async (tx) => {
      const row = await tx.coupon.update({
        where: { id: existing.id },
        data: {
          code: nextCode,
          ...(dto.discountType ? { discountType: dto.discountType as any } : {}),
          ...(dto.discountValue !== undefined ? { discountValue: Number(dto.discountValue) } : {}),
          ...(dto.minOrderValue !== undefined ? { minOrderValue: Number(dto.minOrderValue) } : {}),
          ...(dto.maxDiscount !== undefined ? { maxDiscount: dto.maxDiscount } : {}),
          ...(dto.usageLimit !== undefined ? { usageLimit: dto.usageLimit } : {}),
          startDate,
          endDate,
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });

      await this.writeAudit(tx, actorId, actorName, 'COUPON_UPDATED', 'Coupon', row.id, {
        code: row.code,
        isActive: row.isActive,
      });

      return row;
    });

    return {
      success: true,
      message: `Coupon '${coupon.code}' updated successfully.`,
      coupon,
    };
  }

  async deleteCoupon(id: string, actorId?: string, actorName?: string) {
    this.ensureDb();

    const existing = await this.prisma.coupon.findFirst({
      where: { OR: [{ id }, { code: id.trim().toUpperCase() }] },
    });
    if (!existing) {
      throw new NotFoundException(`Coupon '${id}' was not found.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.coupon.delete({ where: { id: existing.id } });
      await this.writeAudit(tx, actorId, actorName, 'COUPON_DELETED', 'Coupon', existing.id, {
        code: existing.code,
      });
    });

    return {
      success: true,
      message: `Coupon '${existing.code}' deleted successfully.`,
    };
  }
}
