import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import {
  DEFAULT_HOMEPAGE_SECTIONS,
  HOME_CONTENT_CACHE_PREFIX,
  HOME_CONTENT_CACHE_TTL_SECONDS,
} from './home-content.constants';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { CreateBankOfferDto } from './dto/create-bank-offer.dto';
import { UpdateBankOfferDto } from './dto/update-bank-offer.dto';
import {
  ReorderItemsDto,
  ReorderSectionsDto,
} from './dto/reorder-items.dto';
import { UpdateSectionConfigDto } from './dto/update-section-config.dto';
import {
  CreateSectionItemDto,
  UpdateSectionItemDto,
} from './dto/create-section-item.dto';

@Injectable()
export class HomeContentService implements OnModuleInit {
  private readonly logger = new Logger(HomeContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    try {
      await this.seedDefaultContentIfEmpty();
    } catch (err: any) {
      this.logger.warn(`Failed to auto-seed default home content: ${err.message}`);
    }
  }

  // =========================================================================
  // CACHE INVALIDATION
  // =========================================================================
  async invalidateLayoutCache(): Promise<void> {
    const genders = ['All', 'Men', 'Women', 'Kids', ''];
    for (const g of genders) {
      const key = g ? `${HOME_CONTENT_CACHE_PREFIX}:${g}` : HOME_CONTENT_CACHE_PREFIX;
      await this.redis.del(key);
    }
    this.logger.log('Home content layout cache invalidated.');
  }

  // =========================================================================
  // PUBLIC LAYOUT AGGREGATOR (<50ms cached, <80ms uncached)
  // =========================================================================
  async getPublicLayout(gender: string = 'All') {
    const normalizedGender = ['Men', 'Women', 'Kids'].includes(gender) ? gender : 'All';
    const cacheKey = `${HOME_CONTENT_CACHE_PREFIX}:${normalizedGender}`;

    // 1. Try reading from cache
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err: any) {
      this.logger.warn(`Redis get failed: ${err.message}. Proceeding to database query.`);
    }

    // 2. Fetch active sections
    const sections = await this.prisma.homeSectionConfig.findMany({
      where: { isEnabled: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        items: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    // 3. Fetch active banners matching gender
    const now = new Date();
    const banners = await this.prisma.homeBanner.findMany({
      where: {
        isActive: true,
        OR: [
          { targetGender: 'All' },
          { targetGender: normalizedGender },
        ],
        AND: [
          {
            OR: [
              { startDate: null },
              { startDate: { lte: now } },
            ],
          },
          {
            OR: [
              { endDate: null },
              { endDate: { gte: now } },
            ],
          },
        ],
      },
      orderBy: { displayOrder: 'asc' },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        product: { select: { id: true, title: true, brand: true, price: true } },
      },
    });

    // 4. Fetch active bank offers
    const bankOffers = await this.prisma.bankOffer.findMany({
      where: {
        isActive: true,
        AND: [
          {
            OR: [
              { validFrom: null },
              { validFrom: { lte: now } },
            ],
          },
          {
            OR: [
              { validTill: null },
              { validTill: { gte: now } },
            ],
          },
        ],
      },
      orderBy: { displayOrder: 'asc' },
    });

    // 5. Structure curated sections map
    const curatedSections: Record<string, any[]> = {};
    for (const sec of sections) {
      if (sec.items && sec.items.length > 0) {
        curatedSections[sec.sectionKey] = sec.items.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          badge: item.badge,
          imageUrl: item.imageUrl,
          accentColor: item.accentColor,
          actionType: item.actionType,
          actionValue: item.actionValue,
          displayOrder: item.displayOrder,
        }));
      }
    }

    const payload = {
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        sections: sections.map((s) => ({
          id: s.id,
          sectionKey: s.sectionKey,
          displayName: s.displayName,
          title: s.title,
          subtitle: s.subtitle,
          displayOrder: s.displayOrder,
          isEnabled: s.isEnabled,
          metadata: s.metadata,
        })),
        banners: banners.map((b) => ({
          id: b.id,
          placement: b.placement,
          tag: b.tag,
          title1: b.title1,
          title2: b.title2,
          imageUrl: b.imageUrl,
          mobileImageUrl: b.mobileImageUrl,
          targetGender: b.targetGender,
          actionType: b.actionType,
          actionValue:
            b.actionValue ||
            (b.actionType === 'CATEGORY'
              ? b.categoryId
              : b.actionType === 'PRODUCT'
              ? b.productId
              : undefined),
          categoryId: b.categoryId,
          categoryName: b.category?.name,
          productId: b.productId,
          productTitle: b.product?.title,
          displayOrder: b.displayOrder,
          startDate: b.startDate,
          endDate: b.endDate,
        })),
        bankOffers: bankOffers.map((o) => ({
          id: o.id,
          bankName: o.bankName,
          badgeBgColor: o.badgeBgColor,
          badgeBg: o.badgeBgColor,
          title: o.title,
          subtitle: o.subtitle,
          code: o.code,
          discountText: o.discountText,
          discount: o.discountText,
          minSpendText: o.minSpendText,
          minSpend: o.minSpendText,
          details: o.details,
          termsUrl: o.termsUrl,
          displayOrder: o.displayOrder,
        })),
        curatedSections,
      },
    };

    // 6. Write to Redis cache
    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(payload),
        HOME_CONTENT_CACHE_TTL_SECONDS,
      );
    } catch (err: any) {
      this.logger.warn(`Redis set failed: ${err.message}`);
    }

    return payload;
  }

  // =========================================================================
  // ADMIN: BANNERS CRUD
  // =========================================================================
  async listBanners(query?: {
    placement?: string;
    targetGender?: string;
    isActive?: boolean | string;
  }) {
    const where: any = {};
    if (query?.placement) where.placement = query.placement;
    if (query?.targetGender) where.targetGender = query.targetGender;
    if (query?.isActive !== undefined) {
      where.isActive =
        query.isActive === true || query.isActive === 'true' || query.isActive === '1';
    }

    return this.prisma.homeBanner.findMany({
      where,
      orderBy: { displayOrder: 'asc' },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        product: { select: { id: true, title: true, brand: true, price: true } },
      },
    });
  }

  async getBannerById(id: string) {
    const banner = await this.prisma.homeBanner.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        product: { select: { id: true, title: true, brand: true, price: true } },
      },
    });
    if (!banner) throw new NotFoundException(`Banner with ID ${id} not found.`);
    return banner;
  }

  async createBanner(dto: CreateBannerDto, actorId?: string, actorName?: string) {
    const banner = await this.prisma.homeBanner.create({
      data: {
        placement: dto.placement as any,
        tag: dto.tag,
        title1: dto.title1,
        title2: dto.title2,
        imageUrl: dto.imageUrl,
        mobileImageUrl: dto.mobileImageUrl,
        targetGender: dto.targetGender || 'All',
        actionType: dto.actionType as any,
        actionValue: dto.actionValue,
        categoryId: dto.categoryId || null,
        productId: dto.productId || null,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
    });

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'BANNER_CREATED',
      entityId: banner.id,
      entityType: 'HomeBanner',
      summary: `Created home banner "${banner.title1}"`,
      changePayload: dto as any,
    });

    return banner;
  }

  async updateBanner(
    id: string,
    dto: UpdateBannerDto,
    actorId?: string,
    actorName?: string,
  ) {
    await this.getBannerById(id);

    const banner = await this.prisma.homeBanner.update({
      where: { id },
      data: {
        ...(dto.placement && { placement: dto.placement as any }),
        ...(dto.tag !== undefined && { tag: dto.tag }),
        ...(dto.title1 !== undefined && { title1: dto.title1 }),
        ...(dto.title2 !== undefined && { title2: dto.title2 }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.mobileImageUrl !== undefined && { mobileImageUrl: dto.mobileImageUrl }),
        ...(dto.targetGender !== undefined && { targetGender: dto.targetGender }),
        ...(dto.actionType && { actionType: dto.actionType as any }),
        ...(dto.actionValue !== undefined && { actionValue: dto.actionValue }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId || null }),
        ...(dto.productId !== undefined && { productId: dto.productId || null }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.startDate !== undefined && {
          startDate: dto.startDate ? new Date(dto.startDate) : null,
        }),
        ...(dto.endDate !== undefined && {
          endDate: dto.endDate ? new Date(dto.endDate) : null,
        }),
      },
    });

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'BANNER_UPDATED',
      entityId: banner.id,
      entityType: 'HomeBanner',
      summary: `Updated home banner "${banner.title1}"`,
      changePayload: dto as any,
    });

    return banner;
  }

  async deleteBanner(id: string, actorId?: string, actorName?: string) {
    const existing = await this.getBannerById(id);
    await this.prisma.homeBanner.delete({ where: { id } });

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'BANNER_DELETED',
      entityId: id,
      entityType: 'HomeBanner',
      summary: `Deleted home banner "${existing.title1}"`,
    });

    return { success: true, message: `Banner ${id} deleted.` };
  }

  async reorderBanners(
    dto: ReorderItemsDto,
    actorId?: string,
    actorName?: string,
  ) {
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.homeBanner.update({
          where: { id: item.id },
          data: {
            displayOrder: item.displayOrder,
            ...(item.isActive !== undefined && { isActive: item.isActive }),
          },
        }),
      ),
    );

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'BANNERS_REORDERED',
      entityId: 'BULK',
      entityType: 'HomeBanner',
      summary: `Reordered ${dto.items.length} home banners`,
      changePayload: dto as any,
    });

    return { success: true, count: dto.items.length };
  }

  // =========================================================================
  // ADMIN: BANK OFFERS CRUD
  // =========================================================================
  async listBankOffers(query?: { isActive?: boolean | string }) {
    const where: any = {};
    if (query?.isActive !== undefined) {
      where.isActive =
        query.isActive === true || query.isActive === 'true' || query.isActive === '1';
    }

    return this.prisma.bankOffer.findMany({
      where,
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getBankOfferById(id: string) {
    const offer = await this.prisma.bankOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException(`Bank Offer with ID ${id} not found.`);
    return offer;
  }

  async createBankOffer(
    dto: CreateBankOfferDto,
    actorId?: string,
    actorName?: string,
  ) {
    const offer = await this.prisma.bankOffer.create({
      data: {
        bankName: dto.bankName,
        badgeBgColor: dto.badgeBgColor || '#111111',
        title: dto.title,
        subtitle: dto.subtitle,
        code: dto.code || null,
        discountText: dto.discountText,
        minSpendText: dto.minSpendText || null,
        details: dto.details,
        termsUrl: dto.termsUrl || null,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validTill: dto.validTill ? new Date(dto.validTill) : null,
      },
    });

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'BANK_OFFER_CREATED',
      entityId: offer.id,
      entityType: 'BankOffer',
      summary: `Created bank offer "${offer.bankName} - ${offer.title}"`,
      changePayload: dto as any,
    });

    return offer;
  }

  async updateBankOffer(
    id: string,
    dto: UpdateBankOfferDto,
    actorId?: string,
    actorName?: string,
  ) {
    await this.getBankOfferById(id);

    const offer = await this.prisma.bankOffer.update({
      where: { id },
      data: {
        ...(dto.bankName !== undefined && { bankName: dto.bankName }),
        ...(dto.badgeBgColor !== undefined && { badgeBgColor: dto.badgeBgColor }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.discountText !== undefined && { discountText: dto.discountText }),
        ...(dto.minSpendText !== undefined && { minSpendText: dto.minSpendText }),
        ...(dto.details !== undefined && { details: dto.details }),
        ...(dto.termsUrl !== undefined && { termsUrl: dto.termsUrl }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.validFrom !== undefined && {
          validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        }),
        ...(dto.validTill !== undefined && {
          validTill: dto.validTill ? new Date(dto.validTill) : null,
        }),
      },
    });

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'BANK_OFFER_UPDATED',
      entityId: offer.id,
      entityType: 'BankOffer',
      summary: `Updated bank offer "${offer.bankName}"`,
      changePayload: dto as any,
    });

    return offer;
  }

  async deleteBankOffer(id: string, actorId?: string, actorName?: string) {
    const existing = await this.getBankOfferById(id);
    await this.prisma.bankOffer.delete({ where: { id } });

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'BANK_OFFER_DELETED',
      entityId: id,
      entityType: 'BankOffer',
      summary: `Deleted bank offer "${existing.bankName}"`,
    });

    return { success: true, message: `Bank offer ${id} deleted.` };
  }

  async reorderBankOffers(
    dto: ReorderItemsDto,
    actorId?: string,
    actorName?: string,
  ) {
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.bankOffer.update({
          where: { id: item.id },
          data: {
            displayOrder: item.displayOrder,
            ...(item.isActive !== undefined && { isActive: item.isActive }),
          },
        }),
      ),
    );

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'BANK_OFFERS_REORDERED',
      entityId: 'BULK',
      entityType: 'BankOffer',
      summary: `Reordered ${dto.items.length} bank offers`,
      changePayload: dto as any,
    });

    return { success: true, count: dto.items.length };
  }

  // =========================================================================
  // ADMIN: SECTIONS & CURATED ITEMS MANAGEMENT
  // =========================================================================
  async listSections() {
    return this.prisma.homeSectionConfig.findMany({
      orderBy: { displayOrder: 'asc' },
      include: {
        items: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
  }

  async getSectionByKey(sectionKey: string) {
    const sec = await this.prisma.homeSectionConfig.findUnique({
      where: { sectionKey },
      include: {
        items: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
    if (!sec) throw new NotFoundException(`Section ${sectionKey} not found.`);
    return sec;
  }

  async updateSectionConfig(
    sectionKey: string,
    dto: UpdateSectionConfigDto,
    actorId?: string,
    actorName?: string,
  ) {
    await this.getSectionByKey(sectionKey);

    const updated = await this.prisma.homeSectionConfig.update({
      where: { sectionKey },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata }),
      },
    });

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'HOME_SECTION_CONFIG_UPDATED',
      entityId: sectionKey,
      entityType: 'HomeSectionConfig',
      summary: `Updated section configuration for "${updated.displayName}"`,
      changePayload: dto as any,
    });

    return updated;
  }

  async reorderSections(
    dto: ReorderSectionsDto,
    actorId?: string,
    actorName?: string,
  ) {
    await this.prisma.$transaction(
      dto.sections.map((sec) =>
        this.prisma.homeSectionConfig.update({
          where: { sectionKey: sec.sectionKey },
          data: {
            displayOrder: sec.displayOrder,
            ...(sec.isEnabled !== undefined && { isEnabled: sec.isEnabled }),
          },
        }),
      ),
    );

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'HOME_SECTIONS_REORDERED',
      entityId: 'BULK',
      entityType: 'HomeSectionConfig',
      summary: `Reordered ${dto.sections.length} home sections`,
      changePayload: dto as any,
    });

    return { success: true, count: dto.sections.length };
  }

  async addSectionItem(
    sectionKey: string,
    dto: CreateSectionItemDto,
    actorId?: string,
    actorName?: string,
  ) {
    const sec = await this.getSectionByKey(sectionKey);

    const item = await this.prisma.homeSectionItem.create({
      data: {
        sectionConfigId: sec.id,
        title: dto.title,
        subtitle: dto.subtitle,
        badge: dto.badge,
        imageUrl: dto.imageUrl,
        accentColor: dto.accentColor,
        actionType: dto.actionType as any,
        actionValue: dto.actionValue,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'HOME_SECTION_ITEM_CREATED',
      entityId: item.id,
      entityType: 'HomeSectionItem',
      summary: `Added item "${item.title}" to section ${sectionKey}`,
      changePayload: dto as any,
    });

    return item;
  }

  async updateSectionItem(
    itemId: string,
    dto: UpdateSectionItemDto,
    actorId?: string,
    actorName?: string,
  ) {
    const existing = await this.prisma.homeSectionItem.findUnique({
      where: { id: itemId },
    });
    if (!existing) throw new NotFoundException(`Section item ${itemId} not found.`);

    const updated = await this.prisma.homeSectionItem.update({
      where: { id: itemId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
        ...(dto.badge !== undefined && { badge: dto.badge }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.accentColor !== undefined && { accentColor: dto.accentColor }),
        ...(dto.actionType && { actionType: dto.actionType as any }),
        ...(dto.actionValue !== undefined && { actionValue: dto.actionValue }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'HOME_SECTION_ITEM_UPDATED',
      entityId: updated.id,
      entityType: 'HomeSectionItem',
      summary: `Updated item "${updated.title}" in section`,
      changePayload: dto as any,
    });

    return updated;
  }

  async deleteSectionItem(itemId: string, actorId?: string, actorName?: string) {
    const existing = await this.prisma.homeSectionItem.findUnique({
      where: { id: itemId },
    });
    if (!existing) throw new NotFoundException(`Section item ${itemId} not found.`);

    await this.prisma.homeSectionItem.delete({ where: { id: itemId } });

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'HOME_SECTION_ITEM_DELETED',
      entityId: itemId,
      entityType: 'HomeSectionItem',
      summary: `Deleted item "${existing.title}"`,
    });

    return { success: true, message: `Item ${itemId} deleted.` };
  }

  async reorderSectionItems(
    dto: ReorderItemsDto,
    actorId?: string,
    actorName?: string,
  ) {
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.homeSectionItem.update({
          where: { id: item.id },
          data: {
            displayOrder: item.displayOrder,
            ...(item.isActive !== undefined && { isActive: item.isActive }),
          },
        }),
      ),
    );

    await this.invalidateLayoutCache();
    await this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'HOME_SECTION_ITEMS_REORDERED',
      entityId: 'BULK',
      entityType: 'HomeSectionItem',
      summary: `Reordered ${dto.items.length} section items`,
      changePayload: dto as any,
    });

    return { success: true, count: dto.items.length };
  }

  // =========================================================================
  // SEED DEFAULT CONTENT IF EMPTY
  // =========================================================================
  async seedDefaultContentIfEmpty(): Promise<void> {
    const sectionCount = await this.prisma.homeSectionConfig.count();
    if (sectionCount > 0) {
      return;
    }

    this.logger.log('Seeding initial homepage CMS records from homeData...');

    // 1. Seed sections
    const createdSections: Record<string, string> = {};
    for (const sec of DEFAULT_HOMEPAGE_SECTIONS) {
      const created = await this.prisma.homeSectionConfig.upsert({
        where: { sectionKey: sec.sectionKey },
        update: {},
        create: {
          sectionKey: sec.sectionKey,
          displayName: sec.displayName,
          title: sec.title,
          subtitle: sec.subtitle,
          displayOrder: sec.displayOrder,
          isEnabled: sec.isEnabled,
          metadata: sec.metadata || null,
        },
      });
      createdSections[sec.sectionKey] = created.id;
    }

    // 2. Seed Hero Banners
    const heroBanners = [
      {
        tag: 'DROP_04 • 00:28',
        title1: 'Fashion,',
        title2: 'now.',
        imageUrl: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1200&q=90',
        targetGender: 'Women',
        actionType: 'CATEGORY',
        actionValue: 'Western',
        displayOrder: 1,
      },
      {
        tag: "TODAY'S LOOK. TODAY.",
        title1: 'Style today,',
        title2: 'delivered now.',
        imageUrl: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=90',
        targetGender: 'Women',
        actionType: 'CATEGORY',
        actionValue: 'Ethnic',
        displayOrder: 2,
      },
      {
        tag: 'NEW DROP.',
        title1: 'Order. Change.',
        title2: 'go.',
        imageUrl: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=90',
        targetGender: 'Men',
        actionType: 'CATEGORY',
        actionValue: 'Tops',
        displayOrder: 3,
      },
      {
        tag: 'URBAN EDITORIAL.',
        title1: "Fashion doesn't",
        title2: 'wait.',
        imageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=90',
        targetGender: 'All',
        actionType: 'CATEGORY',
        actionValue: 'Western',
        displayOrder: 4,
      },
      {
        tag: 'YOU ORDERED. WE MOVED.',
        title1: 'Timeless',
        title2: 'silhouettes.',
        imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=90',
        targetGender: 'Women',
        actionType: 'CATEGORY',
        actionValue: 'Western',
        displayOrder: 5,
      },
    ];

    for (const b of heroBanners) {
      await this.prisma.homeBanner.create({
        data: {
          placement: 'HERO_CAROUSEL',
          tag: b.tag,
          title1: b.title1,
          title2: b.title2,
          imageUrl: b.imageUrl,
          targetGender: b.targetGender,
          actionType: b.actionType as any,
          actionValue: b.actionValue,
          displayOrder: b.displayOrder,
          isActive: true,
        },
      });
    }

    // 3. Seed Bank Offers
    const bankOffers = [
      {
        bankName: 'AXIS BANK',
        badgeBgColor: '#861F41',
        title: '10% INSTANT DISCOUNT*',
        subtitle: 'On Axis Bank Credit Cards • Min Spend ₹2,499',
        code: 'AXIS10',
        discountText: '10% OFF up to ₹1,000',
        minSpendText: '₹2,499',
        details: 'Get 10% instant discount up to ₹1,000 on Axis Bank Credit Cards.',
        displayOrder: 1,
      },
      {
        bankName: 'HDFC BANK',
        badgeBgColor: '#004C8F',
        title: 'FLAT ₹500 OFF*',
        subtitle: 'On HDFC Credit & Debit Cards • Min ₹2,999',
        code: 'HDFC500',
        discountText: 'Flat ₹500 OFF',
        minSpendText: '₹2,999',
        details: 'Flat ₹500 instant discount on all HDFC Bank Credit & Debit Cards.',
        displayOrder: 2,
      },
      {
        bankName: 'ICICI BANK',
        badgeBgColor: '#B02A30',
        title: 'UP TO ₹1,500 DISCOUNT*',
        subtitle: 'On ICICI Net Banking & Cards • No Min Spend',
        code: 'ICICIMAX',
        discountText: '15% OFF up to ₹1,500',
        minSpendText: '₹1,999',
        details: 'Get 15% instant discount up to ₹1,500 on all ICICI Bank Netbanking and Cards.',
        displayOrder: 3,
      },
      {
        bankName: 'SBI CARD',
        badgeBgColor: '#138808',
        title: '10% CASHBACK*',
        subtitle: 'On SBI Credit Cards • Code: SBISPECIAL',
        code: 'SBISPECIAL',
        discountText: '10% Cashback',
        minSpendText: '₹3,000',
        details: '10% additional cashback credited directly to your SBI Card statement.',
        displayOrder: 4,
      },
      {
        bankName: 'ONECARD',
        badgeBgColor: '#18181b',
        title: 'FLAT ₹750 REBATE*',
        subtitle: 'On OneCard Metal Cards • Instant Apply',
        code: 'ONECART',
        discountText: 'Flat ₹750 OFF',
        minSpendText: '₹3,499',
        details: 'Instant ₹750 rebate when checking out with OneCard metal credit cards.',
        displayOrder: 5,
      },
    ];

    for (const bo of bankOffers) {
      await this.prisma.bankOffer.create({
        data: {
          ...bo,
          isActive: true,
        },
      });
    }

    // 4. Seed Curated Items for BUDGET_STORES
    if (createdSections['BUDGET_STORES']) {
      const budgetItems = [
        {
          title: 'UNDER ₹499',
          subtitle: 'Tees, Camis & Daily Staples',
          badge: 'STEAL DEALS',
          imageUrl: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=85',
          actionType: 'SEARCH_QUERY',
          actionValue: 'maxPrice=499',
          accentColor: '#EEF2FF',
          displayOrder: 1,
        },
        {
          title: 'UNDER ₹799',
          subtitle: 'Casual Shirts, Kurtas & Crops',
          badge: 'DAILY HEROES',
          imageUrl: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=600&q=85',
          actionType: 'SEARCH_QUERY',
          actionValue: 'maxPrice=799',
          accentColor: '#F0FDF4',
          displayOrder: 2,
        },
        {
          title: 'UNDER ₹1,299',
          subtitle: 'Co-ords, Denim & Evening Wear',
          badge: 'POPULAR PICKS',
          imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=85',
          actionType: 'SEARCH_QUERY',
          actionValue: 'maxPrice=1299',
          accentColor: '#FEF3C7',
          displayOrder: 3,
        },
        {
          title: 'UNDER ₹1,999',
          subtitle: 'Handloom Silks, Blazers & Kicks',
          badge: 'PREMIUM FINDS',
          imageUrl: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=600&q=85',
          actionType: 'SEARCH_QUERY',
          actionValue: 'maxPrice=1999',
          accentColor: '#FDF2F8',
          displayOrder: 4,
        },
      ];

      for (const item of budgetItems) {
        await this.prisma.homeSectionItem.create({
          data: {
            sectionConfigId: createdSections['BUDGET_STORES'],
            title: item.title,
            subtitle: item.subtitle,
            badge: item.badge,
            imageUrl: item.imageUrl,
            accentColor: item.accentColor,
            actionType: item.actionType as any,
            actionValue: item.actionValue,
            displayOrder: item.displayOrder,
            isActive: true,
          },
        });
      }
    }

    // 5. Seed Curated Items for TREND_RADAR
    if (createdSections['TREND_RADAR']) {
      const trendItems = [
        {
          title: 'OLD MONEY',
          subtitle: 'Linen trousers, polo knits & timeless neutrals',
          badge: 'QUIET LUXURY',
          imageUrl: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=600&q=85',
          actionType: 'SEARCH_QUERY',
          actionValue: 'Linen',
          accentColor: '#1E293B',
          displayOrder: 1,
        },
        {
          title: 'STREET REBEL',
          subtitle: 'Heavyweight tees, baggy cargos & retro sneakers',
          badge: 'FWD_DROP',
          imageUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=600&q=85',
          actionType: 'SEARCH_QUERY',
          actionValue: 'Streetwear',
          accentColor: '#0F172A',
          displayOrder: 2,
        },
        {
          title: 'HERITAGE WEAVE',
          subtitle: 'Pure zari borders, Chanderi & royal festive drapes',
          badge: 'ROYAL ATELIER',
          imageUrl: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=600&q=85',
          actionType: 'SEARCH_QUERY',
          actionValue: 'Silk Saree',
          accentColor: '#450A0A',
          displayOrder: 3,
        },
      ];

      for (const item of trendItems) {
        await this.prisma.homeSectionItem.create({
          data: {
            sectionConfigId: createdSections['TREND_RADAR'],
            title: item.title,
            subtitle: item.subtitle,
            badge: item.badge,
            imageUrl: item.imageUrl,
            accentColor: item.accentColor,
            actionType: item.actionType as any,
            actionValue: item.actionValue,
            displayOrder: item.displayOrder,
            isActive: true,
          },
        });
      }
    }

    this.logger.log('Default homepage CMS content seeded successfully.');
  }
}
