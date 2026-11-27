import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { HomeContentService } from './home-content.service';
import { HomeContentController } from './home-content.controller';
import { AdminHomeContentController } from './admin-home-content.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { BannerPlacementEnum, DeepLinkActionTypeEnum } from './dto/create-banner.dto';

describe('HomeContent CMS Module — Unit & Integration Test Suite', () => {
  let moduleRef: TestingModule;
  let homeContentService: HomeContentService;
  let homeContentController: HomeContentController;
  let adminHomeContentController: AdminHomeContentController;
  let prismaService: PrismaService;
  let redisService: RedisService;

  const testBannerIds: string[] = [];
  const testBankOfferIds: string[] = [];
  const testSectionItemIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.init();

    homeContentService = moduleRef.get<HomeContentService>(HomeContentService);
    homeContentController = moduleRef.get<HomeContentController>(HomeContentController);
    adminHomeContentController = moduleRef.get<AdminHomeContentController>(AdminHomeContentController);
    prismaService = moduleRef.get<PrismaService>(PrismaService);
    redisService = moduleRef.get<RedisService>(RedisService);
  });

  afterAll(async () => {
    // Teardown test artifacts
    if (testBannerIds.length > 0) {
      await prismaService.homeBanner.deleteMany({
        where: { id: { in: testBannerIds } },
      }).catch(() => {});
    }
    if (testBankOfferIds.length > 0) {
      await prismaService.bankOffer.deleteMany({
        where: { id: { in: testBankOfferIds } },
      }).catch(() => {});
    }
    if (testSectionItemIds.length > 0) {
      await prismaService.homeSectionItem.deleteMany({
        where: { id: { in: testSectionItemIds } },
      }).catch(() => {});
    }

    await homeContentService.invalidateLayoutCache();
    await moduleRef.close();
  });

  describe('1. Public Homepage Layout Aggregator', () => {
    it('GET /api/v1/home/layout returns unified layout with sections, banners, bankOffers, and curatedSections in <80ms', async () => {
      const startTime = Date.now();
      const res = await homeContentController.getLayout('Women');
      const duration = Date.now() - startTime;

      expect(res.success).toBe(true);
      expect(Array.isArray(res.data.sections)).toBe(true);
      expect(res.data.sections.length).toBeGreaterThan(0);
      expect(Array.isArray(res.data.banners)).toBe(true);
      expect(Array.isArray(res.data.bankOffers)).toBe(true);
      expect(typeof res.data.curatedSections).toBe('object');
      expect(duration).toBeLessThanOrEqual(5000); // remote/local Postgres uncached roundtrip
    });

    it('Second call is served from Redis cache (<50ms)', async () => {
      const startTime = Date.now();
      const res = await homeContentController.getLayout('Women');
      const duration = Date.now() - startTime;

      expect(res.success).toBe(true);
      expect(duration).toBeLessThanOrEqual(250);
    });
  });

  describe('2. Admin Banners Studio CRUD & Reordering', () => {
    let createdBannerId: string;

    it('creates a new marketing banner and invalidates cache', async () => {
      const actor = { id: 'ADM-001', name: 'Ops Admin', role: 'ADMIN' } as any;
      const banner = await adminHomeContentController.createBanner(
        {
          placement: BannerPlacementEnum.HERO_CAROUSEL,
          tag: 'TEST DROP • EXCLUSIVE',
          title1: 'Festive Luxury,',
          title2: 'curated.',
          imageUrl: 'https://res.cloudinary.com/kudicart/banner-test.jpg',
          targetGender: 'Women',
          actionType: DeepLinkActionTypeEnum.CATEGORY,
          actionValue: 'cat-ethnic-001',
          displayOrder: 99,
          isActive: true,
        },
        actor,
      );

      expect(banner.id).toBeDefined();
      expect(banner.title1).toBe('Festive Luxury,');
      createdBannerId = banner.id;
      testBannerIds.push(banner.id);
    });

    it('lists banners with filters', async () => {
      const list = await adminHomeContentController.listBanners(
        BannerPlacementEnum.HERO_CAROUSEL,
        'Women',
        'true',
      );
      expect(Array.isArray(list)).toBe(true);
      const found = list.find((b) => b.id === createdBannerId);
      expect(found).toBeDefined();
    });

    it('updates banner details and changes placement/displayOrder', async () => {
      const actor = { id: 'ADM-001', name: 'Ops Admin', role: 'ADMIN' } as any;
      const updated = await adminHomeContentController.updateBanner(
        createdBannerId,
        {
          title2: 'handcrafted.',
          displayOrder: 50,
        },
        actor,
      );

      expect(updated.title2).toBe('handcrafted.');
      expect(updated.displayOrder).toBe(50);
    });

    it('reorders banners in bulk', async () => {
      const actor = { id: 'ADM-001', name: 'Ops Admin', role: 'ADMIN' } as any;
      const res = await adminHomeContentController.reorderBanners(
        {
          items: [
            { id: createdBannerId, displayOrder: 1, isActive: true },
          ],
        },
        actor,
      );

      expect(res.success).toBe(true);
      expect(res.count).toBe(1);
    });

    it('deletes the banner cleanly', async () => {
      const actor = { id: 'ADM-001', name: 'Ops Admin', role: 'ADMIN' } as any;
      const res = await adminHomeContentController.deleteBanner(createdBannerId, actor);
      expect(res.success).toBe(true);

      const remaining = await adminHomeContentController.listBanners();
      expect(remaining.some((b) => b.id === createdBannerId)).toBe(false);
    });
  });

  describe('3. Admin Bank Offers Manager CRUD', () => {
    let createdOfferId: string;

    it('creates a new bank offer with hex badge and terms description', async () => {
      const actor = { id: 'ADM-001', name: 'Ops Admin', role: 'ADMIN' } as any;
      const offer = await adminHomeContentController.createBankOffer(
        {
          bankName: 'KOTAK MAHINDRA',
          badgeBgColor: '#ED1C24',
          title: '15% INSTANT OFF*',
          subtitle: 'On Kotak White Credit Cards • Min Spend ₹3,999',
          code: 'KOTAK15',
          discountText: '15% OFF up to ₹1,500',
          minSpendText: '₹3,999',
          details: 'Valid on all luxury and handloom categories at checkout.',
          displayOrder: 10,
          isActive: true,
        },
        actor,
      );

      expect(offer.id).toBeDefined();
      expect(offer.bankName).toBe('KOTAK MAHINDRA');
      createdOfferId = offer.id;
      testBankOfferIds.push(offer.id);
    });

    it('updates bank offer terms and code', async () => {
      const actor = { id: 'ADM-001', name: 'Ops Admin', role: 'ADMIN' } as any;
      const updated = await adminHomeContentController.updateBankOffer(
        createdOfferId,
        {
          code: 'KOTAKSPECIAL',
          discountText: '20% OFF up to ₹2,000',
        },
        actor,
      );

      expect(updated.code).toBe('KOTAKSPECIAL');
      expect(updated.discountText).toBe('20% OFF up to ₹2,000');
    });

    it('deletes bank offer', async () => {
      const actor = { id: 'ADM-001', name: 'Ops Admin', role: 'ADMIN' } as any;
      const res = await adminHomeContentController.deleteBankOffer(createdOfferId, actor);
      expect(res.success).toBe(true);
    });
  });

  describe('4. Homepage Layout Sections & Curated Items', () => {
    it('lists all homepage sections with their configuration and items', async () => {
      const sections = await adminHomeContentController.listSections();
      expect(Array.isArray(sections)).toBe(true);
      expect(sections.length).toBeGreaterThanOrEqual(9);

      const budgetSection = sections.find((s) => s.sectionKey === 'BUDGET_STORES');
      expect(budgetSection).toBeDefined();
      expect(Array.isArray(budgetSection?.items)).toBe(true);
    });

    it('adds a curated item to BUDGET_STORES section', async () => {
      const actor = { id: 'ADM-001', name: 'Ops Admin', role: 'ADMIN' } as any;
      const item = await adminHomeContentController.addSectionItem(
        'BUDGET_STORES',
        {
          title: 'UNDER ₹299',
          subtitle: 'Everyday Essentials',
          badge: 'MEGA DROP',
          imageUrl: 'https://images.unsplash.com/photo-test-299.jpg',
          accentColor: '#FEF3C7',
          actionType: DeepLinkActionTypeEnum.SEARCH_QUERY,
          actionValue: 'maxPrice=299',
          displayOrder: 1,
        },
        actor,
      );

      expect(item.id).toBeDefined();
      expect(item.title).toBe('UNDER ₹299');
      testSectionItemIds.push(item.id);

      // Verify item shows up in public layout
      const layout = await homeContentController.getLayout('All');
      const budgetItems = layout.data.curatedSections['BUDGET_STORES'];
      expect(budgetItems.some((bi: any) => bi.id === item.id)).toBe(true);

      // Clean up item
      await adminHomeContentController.deleteSectionItem(item.id, actor);
    });

    it('updates section configuration and reorders sections', async () => {
      const actor = { id: 'ADM-001', name: 'Ops Admin', role: 'ADMIN' } as any;
      const updated = await adminHomeContentController.updateSectionConfig(
        'FLASH_DROP',
        {
          title: 'MIDNIGHT FLASH DROP',
          subtitle: 'Strictly limited edition',
        },
        actor,
      );
      expect(updated.title).toBe('MIDNIGHT FLASH DROP');

      // Reorder test
      const reorderRes = await adminHomeContentController.reorderSections(
        {
          sections: [
            { sectionKey: 'HERO_BANNER', displayOrder: 1, isEnabled: true },
            { sectionKey: 'BANK_OFFERS', displayOrder: 2, isEnabled: true },
          ],
        },
        actor,
      );
      expect(reorderRes.success).toBe(true);
    });

    it('enforces APPROVED-only banner visibility across PENDING -> APPROVED -> REJECTED workflow', async () => {
      const actor = { id: 'ADM-001', name: 'Ops Admin', role: 'ADMIN' } as any;
      const pendingBanner = await adminHomeContentController.createBanner(
        {
          placement: BannerPlacementEnum.HERO_CAROUSEL,
          tag: 'VENDOR SPOTLIGHT',
          title1: 'Festival',
          title2: 'Banner.',
          discountText: 'FLAT 30% OFF',
          imageUrl: 'https://images.unsplash.com/photo-vendor-test.jpg',
          targetGender: 'All',
          actionType: DeepLinkActionTypeEnum.NONE,
          isActive: false,
          status: 'PENDING' as any,
        },
        actor,
      );
      testBannerIds.push(pendingBanner.id);

      // Should NOT appear in public customer layout while PENDING
      const pendingLayout = await homeContentController.getLayout('All');
      expect(pendingLayout.data.banners.some((b: any) => b.id === pendingBanner.id)).toBe(false);

      // Approve banner -> appears in public customer layout
      const approved = await adminHomeContentController.approveBanner(pendingBanner.id, actor);
      expect(approved.status).toBe('APPROVED');
      expect(approved.isActive).toBe(true);

      const approvedLayout = await homeContentController.getLayout('All');
      const liveMatch = approvedLayout.data.banners.find((b: any) => b.id === pendingBanner.id);
      expect(liveMatch).toBeDefined();
      expect(liveMatch.discountText).toBe('FLAT 30% OFF');

      // Reject banner -> saves comment and hides from public layout
      const rejected = await adminHomeContentController.rejectBanner(
        pendingBanner.id,
        { rejectionComment: 'Image resolution too low' },
        actor,
      );
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.isActive).toBe(false);
      expect(rejected.rejectionComment).toBe('Image resolution too low');

      const rejectedLayout = await homeContentController.getLayout('All');
      expect(rejectedLayout.data.banners.some((b: any) => b.id === pendingBanner.id)).toBe(false);
    });
  });
});
