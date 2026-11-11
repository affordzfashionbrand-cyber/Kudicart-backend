import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetProductsDto } from './dto/get-products.dto';
import { SearchSuggestionsDto } from './dto/search-suggestions.dto';

export interface SearchSuggestionItem {
  text: string;
  type: 'keyword' | 'category' | 'brand';
  highlight?: string;
  count?: number;
}

export interface SearchSuggestionsResponse {
  query: string;
  suggestions: SearchSuggestionItem[];
  categories: Array<{ id: string; name: string; count: number }>;
  brands: Array<{ name: string; count: number }>;
  trending: string[];
  recentPicks: any[];
}

const ID_ALIASES: Record<string, string> = {
  '101': 'prod-2',
  'prod-101': 'prod-2',
  '102': 'prod-1',
  'prod-102': 'prod-1',
  '103': 'prod-3',
  'prod-103': 'prod-3',
  '104': 'prod-5',
  'prod-104': 'prod-5',
  '105': 'prod-6',
  'prod-105': 'prod-6',
  '106': 'prod-4',
  'prod-106': 'prod-4',
  '107': 'prod-10',
  'prod-107': 'prod-10',
  '108': 'prod-7',
  'prod-108': 'prod-7',
  '1': 'prod-1',
  'prod-1': 'prod-1',
  '2': 'prod-5',
  'prod-2': 'prod-5',
  '3': 'prod-9',
  'prod-3': 'prod-3',
  '4': 'prod-6',
  'prod-4': 'prod-4',
  '9': 'prod-4',
  'prod-9': 'prod-9',
};

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private computeCategoryCounts(
    categories: any[],
    directProductCounts: Map<string, number>,
  ): Map<string, number> {
    const childrenMap = new Map<string, string[]>();
    for (const c of categories) {
      if (c.parentId) {
        const list = childrenMap.get(c.parentId) || [];
        list.push(c.id);
        childrenMap.set(c.parentId, list);
      }
    }

    const memo = new Map<string, number>();
    const countWithDescendants = (id: string, visited = new Set<string>()): number => {
      if (memo.has(id)) return memo.get(id)!;
      if (visited.has(id)) return 0;
      visited.add(id);

      let total = directProductCounts.get(id) || 0;
      for (const childId of childrenMap.get(id) || []) {
        total += countWithDescendants(childId, visited);
      }
      memo.set(id, total);
      return total;
    };

    for (const c of categories) {
      countWithDescendants(c.id);
    }

    return memo;
  }

  private async loadCategoryStats() {
    const [categories, groupedCounts] = await Promise.all([
      this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ level: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.product.groupBy({
        by: ['categoryId'],
        where: { listingStatus: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);

    const directCounts = new Map<string, number>();
    for (const row of groupedCounts) {
      directCounts.set(row.categoryId, row._count._all);
    }

    const totalCounts = this.computeCategoryCounts(categories, directCounts);
    return { categories, totalCounts };
  }

  private formatCategoryNode(cat: any, totalCounts: Map<string, number>, children: any[] = []) {
    const productCount = totalCounts.get(cat.id) || 0;
    return {
      id: cat.id,
      code: cat.code,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      level: cat.level,
      parentId: cat.parentId,
      icon: cat.icon,
      image: cat.image,
      banner: cat.banner,
      gender: cat.gender,
      displayOrder: cat.displayOrder,
      isActive: cat.isActive,
      isPopular: cat.isPopular,
      productCount,
      countText: productCount > 0 ? `${productCount} styles` : cat.countText || '0 styles',
      children,
    };
  }

  private collectDescendantIds(categories: any[], rootId: string): Set<string> {
    const result = new Set<string>([rootId]);
    const queue = [rootId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const cat of categories) {
        if (cat.parentId === current && !result.has(cat.id)) {
          result.add(cat.id);
          queue.push(cat.id);
        }
      }
    }

    return result;
  }

  private matchesGender(catGender: string | null | undefined, requestedGender?: string): boolean {
    if (!requestedGender) return true;
    if (!catGender) return true;
    const req = requestedGender.trim().toLowerCase();
    const val = catGender.trim().toLowerCase();
    return val === req || val === 'unisex';
  }

  /**
   * Returns categories. Supports:
   * - tree: true (returns full L1 -> L2 -> L3 hierarchy)
   * - parentId (returns direct children)
   * - level (returns categories at that level)
   * - gender ('Women' | 'Men' | 'Kids' | 'Unisex')
   */
  async getCategories(options?: {
    tree?: boolean;
    parentId?: string;
    level?: number;
    gender?: string;
  }) {
    this.ensureDbConnected();

    if (options?.tree) {
      return this.getCategoryHierarchy(options?.gender);
    }

    const { categories, totalCounts } = await this.loadCategoryStats();

    return categories
      .filter((c) => {
        if (options?.parentId && c.parentId !== options.parentId) return false;
        if (options?.level !== undefined && c.level !== options.level) return false;
        if (!this.matchesGender(c.gender, options?.gender)) return false;
        return true;
      })
      .map((c) => this.formatCategoryNode(c, totalCounts));
  }

  async getCategoryHierarchy(gender?: string) {
    this.ensureDbConnected();
    const { categories, totalCounts } = await this.loadCategoryStats();

    const filtered = categories.filter((c) => this.matchesGender(c.gender, gender));
    const byParent = new Map<string, any[]>();

    for (const c of filtered) {
      const parentKey = c.parentId || '__ROOT__';
      const arr = byParent.get(parentKey) || [];
      arr.push(c);
      byParent.set(parentKey, arr);
    }

    const buildTree = (parentId: string, visited = new Set<string>()): any[] => {
      const children = byParent.get(parentId) || [];
      return children.map((node) => {
        if (visited.has(node.id)) {
          return this.formatCategoryNode(node, totalCounts, []);
        }
        const nextVisited = new Set(visited);
        nextVisited.add(node.id);
        return this.formatCategoryNode(node, totalCounts, buildTree(node.id, nextVisited));
      });
    };

    return buildTree('__ROOT__');
  }

  async getCategoryById(id: string) {
    this.ensureDbConnected();
    const { categories, totalCounts } = await this.loadCategoryStats();

    const target = categories.find(
      (c) => c.id === id || c.code === id || c.slug === id,
    );

    if (!target) {
      throw new NotFoundException(`Category '${id}' not found.`);
    }

    const children = categories
      .filter((c) => c.parentId === target.id)
      .map((child) => this.formatCategoryNode(child, totalCounts));

    return this.formatCategoryNode(target, totalCounts, children);
  }

  async getSubcategories(parentId: string) {
    this.ensureDbConnected();
    const { categories, totalCounts } = await this.loadCategoryStats();

    const resolvedParent = categories.find(
      (c) => c.id === parentId || c.code === parentId || c.slug === parentId,
    );
    const lookupParentId = resolvedParent ? resolvedParent.id : parentId;

    return categories
      .filter((c) => c.parentId === lookupParentId)
      .map((c) => this.formatCategoryNode(c, totalCounts));
  }

  async getDarkStores() {
    this.ensureDbConnected();
    return this.prisma.darkStoreHub.findMany({
      where: { isActive: true },
      orderBy: [{ deliveryMinutes: 'asc' }, { name: 'asc' }],
    });
  }

  async getActiveCoupons() {
    this.ensureDbConnected();
    const now = new Date();
    return this.prisma.coupon.findMany({
      where: {
        isActive: true,
        endDate: { gte: now },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSearchSuggestions(dto?: SearchSuggestionsDto): Promise<SearchSuggestionsResponse> {
    this.ensureDbConnected();

    const rawQuery = (dto?.q || '').trim();
    const query = rawQuery.toLowerCase();
    const limit = Math.min(Math.max(Number(dto?.limit || 8), 1), 20);

    const [allProductsRaw, allCategories] = await Promise.all([
      this.prisma.product.findMany({
        where: { listingStatus: 'ACTIVE' },
        include: {
          category: true,
          vendor: true,
          darkStoreHub: true,
        },
      }),
      this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const allProducts = allProductsRaw.map((p) => this.mapProductWithHub(p));
    const trending = [
      'Mulberry Silk',
      'Banarasi',
      'Kurta Set',
      'Try & Buy',
      'Bandhgala',
      'Express Pod',
    ];

    if (!query) {
      const popularCats = allCategories
        .filter((c) => c.isPopular || c.level === 1)
        .slice(0, 6)
        .map((c) => ({
          id: c.id,
          name: c.name,
          count: allProducts.filter(
            (p) =>
              p.category.toLowerCase() === c.name.toLowerCase() ||
              p.categoryId.toLowerCase() === c.id.toLowerCase(),
          ).length,
        }));

      const brandCounts = new Map<string, number>();
      for (const p of allProducts) {
        brandCounts.set(p.brand, (brandCounts.get(p.brand) || 0) + 1);
      }

      const brands = Array.from(brandCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .slice(0, 6);

      return {
        query: '',
        suggestions: trending.map((text) => ({ text, type: 'keyword' as const })),
        categories: popularCats,
        brands,
        trending,
        recentPicks: allProducts.slice(0, 4),
      };
    }

    const tokens = query.split(/\s+/).filter(Boolean);
    const suggestionMap = new Map<
      string,
      { type: 'keyword' | 'category' | 'brand'; count: number }
    >();

    for (const c of allCategories) {
      if (
        c.name.toLowerCase().includes(query) ||
        tokens.some((t) => c.name.toLowerCase().includes(t))
      ) {
        const count = allProducts.filter(
          (p) =>
            p.category.toLowerCase() === c.name.toLowerCase() ||
            p.categoryId.toLowerCase() === c.id.toLowerCase(),
        ).length;
        suggestionMap.set(c.name, { type: 'category', count });
      }
    }

    const brandSeen = new Set<string>();
    for (const p of allProducts) {
      if (
        p.brand.toLowerCase().includes(query) ||
        tokens.some((t) => p.brand.toLowerCase().includes(t))
      ) {
        if (!brandSeen.has(p.brand)) {
          brandSeen.add(p.brand);
          const count = allProducts.filter((prod) => prod.brand === p.brand).length;
          suggestionMap.set(p.brand, { type: 'brand', count });
        }
      }

      const titleLower = p.title.toLowerCase();
      if (titleLower.includes(query) || tokens.every((t) => titleLower.includes(t))) {
        suggestionMap.set(p.title, { type: 'keyword', count: 1 });
      }

      if (Array.isArray(p.tags)) {
        for (const tag of p.tags) {
          if (String(tag).toLowerCase().includes(query)) {
            const capitalTag = String(tag).charAt(0).toUpperCase() + String(tag).slice(1);
            if (!suggestionMap.has(capitalTag)) {
              suggestionMap.set(capitalTag, { type: 'keyword', count: 1 });
            }
          }
        }
      }

      if (p.fabric && p.fabric.toLowerCase().includes(query) && !suggestionMap.has(p.fabric)) {
        suggestionMap.set(p.fabric, { type: 'keyword', count: 1 });
      }
    }

    const suggestions: SearchSuggestionItem[] = Array.from(suggestionMap.entries())
      .map(([text, meta]) => ({
        text,
        type: meta.type,
        count: meta.count,
        highlight: query,
      }))
      .slice(0, limit);

    const matchingCategories = allCategories
      .filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          tokens.some((t) => c.name.toLowerCase().includes(t)),
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        count: allProducts.filter(
          (p) =>
            p.category.toLowerCase() === c.name.toLowerCase() ||
            p.categoryId.toLowerCase() === c.id.toLowerCase(),
        ).length,
      }));

    const matchingBrands = Array.from(brandSeen).map((brand) => ({
      name: brand,
      count: allProducts.filter((p) => p.brand === brand).length,
    }));

    const instantProducts = await this.searchProducts({ search: rawQuery, limit: 4 });

    return {
      query: rawQuery,
      suggestions,
      categories: matchingCategories,
      brands: matchingBrands,
      trending,
      recentPicks: instantProducts,
    };
  }

  /**
   * Search Products Engine:
   * Multi-token relevance scoring across title, brand, category, fabric, origin,
   * description, and tags with filtering and sorting backed by PostgreSQL.
   */
  async searchProducts(query?: GetProductsDto) {
    this.ensureDbConnected();

    const [rawProducts, allCategories] = await Promise.all([
      this.prisma.product.findMany({
        where: { listingStatus: 'ACTIVE' },
        include: {
          category: true,
          vendor: true,
          darkStoreHub: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.category.findMany({
        where: { isActive: true },
      }),
    ]);

    let products = rawProducts.map((p) => this.mapProductWithHub(p));
    const searchTerm = (query?.search || '').trim();

    if (searchTerm) {
      const tokens = searchTerm
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const fullQuery = searchTerm.toLowerCase();

      const scored: Array<{ product: any; score: number }> = [];
      for (const p of products) {
        const title = (p.title || '').toLowerCase();
        const brand = (p.brand || '').toLowerCase();
        const category = (p.category || '').toLowerCase();
        const fabric = (p.fabric || '').toLowerCase();
        const origin = (p.origin || '').toLowerCase();
        const description = (p.description || '').toLowerCase();
        const tags = Array.isArray(p.tags) ? p.tags.join(' ').toLowerCase() : '';
        const gender = (p.gender || '').toLowerCase();

        let score = 0;
        if (title.includes(fullQuery)) score += 30;
        if (brand.includes(fullQuery)) score += 20;
        if (category.includes(fullQuery)) score += 18;
        if (tags.includes(fullQuery)) score += 16;
        if (fabric.includes(fullQuery)) score += 12;

        let matchedTokenCount = 0;
        for (const token of tokens) {
          let tokenMatched = false;
          if (title.includes(token)) {
            score += 10;
            tokenMatched = true;
          }
          if (brand.includes(token)) {
            score += 8;
            tokenMatched = true;
          }
          if (category.includes(token)) {
            score += 8;
            tokenMatched = true;
          }
          if (tags.includes(token)) {
            score += 7;
            tokenMatched = true;
          }
          if (fabric.includes(token)) {
            score += 6;
            tokenMatched = true;
          }
          if (origin.includes(token)) {
            score += 4;
            tokenMatched = true;
          }
          if (gender === token) {
            score += 5;
            tokenMatched = true;
          }
          if (description.includes(token)) {
            score += 2;
            tokenMatched = true;
          }
          if (tokenMatched) {
            matchedTokenCount += 1;
          }
        }

        if (tokens.length > 1 && matchedTokenCount === tokens.length) {
          score += 25;
        }

        const singleFuzzy =
          tokens.length === 1 &&
          matchedTokenCount === 0 &&
          [title, brand, category, tags, fabric].some((field) =>
            field.split(/\s+/).some((word) => word.startsWith(tokens[0].slice(0, 3))),
          );
        if (singleFuzzy && tokens[0].length >= 3) {
          score += 3;
          matchedTokenCount = 1;
        }

        if (matchedTokenCount > 0 && score > 0) {
          scored.push({ product: p, score });
        }
      }

      scored.sort((a, b) => b.score - a.score || b.product.rating - a.product.rating);
      products = scored.map((s) => s.product);
    }

    if (query?.fulfillmentType) {
      products = products.filter((p) => p.fulfillmentType === query.fulfillmentType);
    }

    if (
      query?.tryAndBuyOnly === 'true' ||
      query?.tryAndBuyOnly === '1' ||
      (query?.tryAndBuyOnly as any) === true
    ) {
      products = products.filter((p) => p.tryAndBuyEligible === true);
    }

    if (query?.gender) {
      const reqGender = query.gender.trim().toLowerCase();
      products = products.filter(
        (p) => !p.gender || p.gender.toLowerCase() === reqGender || p.gender.toLowerCase() === 'unisex',
      );
    }

    const activeCategoryFilter =
      query?.subSubCategory ||
      query?.subCategory ||
      (query?.category && query.category.toLowerCase() !== 'all' ? query.category : undefined);

    if (activeCategoryFilter) {
      const needle = activeCategoryFilter.trim().toLowerCase();
      const matchedCategory = allCategories.find(
        (c) =>
          c.id.toLowerCase() === needle ||
          c.slug?.toLowerCase() === needle ||
          c.code?.toLowerCase() === needle ||
          c.name.toLowerCase() === needle,
      );

      if (matchedCategory) {
        const descendantIds = this.collectDescendantIds(allCategories, matchedCategory.id);
        products = products.filter(
          (p) =>
            descendantIds.has(p.categoryId) ||
            p.category.toLowerCase() === matchedCategory.name.toLowerCase(),
        );
      } else {
        products = products.filter(
          (p) =>
            p.category.toLowerCase().includes(needle) ||
            p.categoryId.toLowerCase() === needle,
        );
      }
    }

    if (query?.minPrice !== undefined && query?.minPrice !== '') {
      const min = Number(query.minPrice);
      if (!Number.isNaN(min)) {
        products = products.filter((p) => p.price >= min);
      }
    }

    if (query?.maxPrice !== undefined && query?.maxPrice !== '') {
      const max = Number(query.maxPrice);
      if (!Number.isNaN(max)) {
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
          products.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          break;
      }
    }

    if (query?.page && query?.limit) {
      const page = Math.max(Number(query.page) || 1, 1);
      const limit = Math.max(Number(query.limit) || 20, 1);
      const offset = (page - 1) * limit;
      return products.slice(offset, offset + limit);
    }

    if (query?.limit && !query?.page) {
      const limit = Math.max(Number(query.limit) || 20, 1);
      return products.slice(0, limit);
    }

    return products;
  }

  async getProducts(query?: GetProductsDto) {
    return this.searchProducts(query);
  }

  async getProductById(id: string) {
    this.ensureDbConnected();

    const rawId = String(id).trim();
    const resolvedId = ID_ALIASES[rawId] || rawId;

    const dbProduct = await this.prisma.product.findFirst({
      where: {
        OR: [{ id: resolvedId }, { id: rawId }, { sku: rawId }],
      },
      include: {
        category: true,
        vendor: true,
        darkStoreHub: true,
      },
    });

    if (!dbProduct) {
      throw new NotFoundException(`Product with ID '${id}' not found.`);
    }

    return this.mapProductWithHub(dbProduct);
  }

  private mapProductWithHub(p: any) {
    const categoryName =
      typeof p.category === 'string' ? p.category : p.category?.name || '';
    const stockBadge =
      p.stockBadge ||
      (p.stockQuantity > 0
        ? p.stockQuantity <= 3
          ? `Only ${p.stockQuantity} left`
          : 'In Stock'
        : 'Out of Stock');

    return {
      ...p,
      category: categoryName,
      categoryId: p.categoryId || p.category?.id || '',
      stockBadge,
      vendorName: p.vendor?.storeName || 'Affordz Official Store',
      vendor: p.vendor
        ? {
            id: p.vendor.id,
            storeName: p.vendor.storeName,
            operatingHub: p.vendor.operatingHub,
            address: p.vendor.address,
          }
        : null,
      darkStoreHub: p.darkStoreHub
        ? {
            id: p.darkStoreHub.id,
            name: p.darkStoreHub.name,
            locality: p.darkStoreHub.locality,
            address: p.darkStoreHub.address,
            lat: p.darkStoreHub.lat,
            lng: p.darkStoreHub.lng,
            deliveryMinutes: p.darkStoreHub.deliveryMinutes,
            isActive: p.darkStoreHub.isActive,
          }
        : null,
    };
  }
}
