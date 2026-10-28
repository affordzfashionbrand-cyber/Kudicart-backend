import { Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  /**
   * Returns categories. Supports:
   * - tree: true (returns full L1 -> L2 -> L3 hierarchy)
   * - parentId (returns direct children)
   * - level (returns categories at that level, e.g. 1 for main departments)
   * - gender ('Women' | 'Men' | 'Kids' | 'Unisex')
   */
  async getCategories(options?: {
    tree?: boolean;
    parentId?: string;
    level?: number;
    gender?: string;
  }) {
    const store = this.prisma.getStore();
    const allCategories = store.categories || [];
    const allProducts = store.products || [];

    const countStylesForCategory = (cat: any): number => {
      const descendantIds = new Set<string>([
        cat.id.toLowerCase(),
        cat.slug.toLowerCase(),
        cat.name.toLowerCase(),
      ]);

      const collectDescendants = (parentId: string) => {
        allCategories
          .filter((c: any) => c.parentId === parentId)
          .forEach((child: any) => {
            descendantIds.add(child.id.toLowerCase());
            descendantIds.add(child.slug.toLowerCase());
            descendantIds.add(child.name.toLowerCase());
            collectDescendants(child.id);
          });
      };
      collectDescendants(cat.id);

      return allProducts.filter((p: any) => {
        const pCat = (p.category || '').toLowerCase();
        const pCatId = (p.categoryId || '').toLowerCase();
        const pGender = (p.gender || '').toLowerCase();
        return descendantIds.has(pCat) || descendantIds.has(pCatId) || (cat.level === 1 && cat.name.toLowerCase() === pGender);
      }).length;
    };

    if (options?.tree) {
      return this.getCategoryHierarchy(options?.gender);
    }

    let filtered = [...allCategories];

    if (options?.parentId !== undefined) {
      filtered = filtered.filter((c: any) => c.parentId === options.parentId);
    } else if (options?.level !== undefined) {
      filtered = filtered.filter((c: any) => c.level === options.level);
    }

    if (options?.gender && options.gender.toLowerCase() !== 'all') {
      const g = options.gender.toLowerCase();
      filtered = filtered.filter(
        (c: any) =>
          !c.gender ||
          c.gender.toLowerCase() === g ||
          c.gender.toLowerCase() === 'unisex',
      );
    }

    filtered.sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0));

    return filtered.map((c: any) => {
      const styles = countStylesForCategory(c);
      return {
        ...c,
        productCount: styles,
        countText: styles > 0 ? `${styles} styles` : c.countText || 'Explore styles',
      };
    });
  }

  /**
   * Full 3-Tier Hierarchy:
   * Level 1 (Departments: Women, Men, Kids, Footwear, Beauty, Accessories)
   * -> Level 2 (Sub-Categories: Indian & Fusion Wear, Western Wear, Footwear, etc.)
   *   -> Level 3 (Sub-Sub-Categories: Kurtas, Sarees, Dresses, T-Shirts, Sneakers, etc.)
   */
  async getCategoryHierarchy(gender?: string) {
    const store = this.prisma.getStore();
    const allCategories = store.categories || [];
    const allProducts = store.products || [];

    const countStyles = (cat: any): number => {
      const ids = new Set<string>([
        cat.id.toLowerCase(),
        cat.slug.toLowerCase(),
        cat.name.toLowerCase(),
      ]);
      const addChildren = (pid: string) => {
        allCategories
          .filter((c: any) => c.parentId === pid)
          .forEach((child: any) => {
            ids.add(child.id.toLowerCase());
            ids.add(child.slug.toLowerCase());
            ids.add(child.name.toLowerCase());
            addChildren(child.id);
          });
      };
      addChildren(cat.id);

      return allProducts.filter((p: any) => {
        const pCat = (p.category || '').toLowerCase();
        const pCatId = (p.categoryId || '').toLowerCase();
        const pGender = (p.gender || '').toLowerCase();
        return ids.has(pCat) || ids.has(pCatId) || (cat.level === 1 && cat.name.toLowerCase() === pGender);
      }).length;
    };

    let l1 = allCategories.filter((c: any) => c.level === 1);
    if (gender && gender.toLowerCase() !== 'all') {
      const g = gender.toLowerCase();
      l1 = l1.filter(
        (c: any) =>
          !c.gender ||
          c.gender.toLowerCase() === g ||
          c.gender.toLowerCase() === 'unisex',
      );
    }

    l1.sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0));

    return l1.map((catL1: any) => {
      const l1Count = countStyles(catL1);
      const l2 = allCategories
        .filter((c: any) => c.parentId === catL1.id)
        .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
        .map((catL2: any) => {
          const l2Count = countStyles(catL2);
          const l3 = allCategories
            .filter((c: any) => c.parentId === catL2.id)
            .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
            .map((catL3: any) => {
              const l3Count = countStyles(catL3);
              return {
                ...catL3,
                productCount: l3Count,
                countText: l3Count > 0 ? `${l3Count} styles` : catL3.countText,
              };
            });

          return {
            ...catL2,
            productCount: l2Count,
            countText: l2Count > 0 ? `${l2Count} styles` : catL2.countText,
            subcategories: l3,
            children: l3,
          };
        });

      return {
        ...catL1,
        productCount: l1Count,
        countText: l1Count > 0 ? `${l1Count} styles` : catL1.countText,
        subcategories: l2,
        children: l2,
      };
    });
  }

  async getCategoryById(id: string) {
    const store = this.prisma.getStore();
    const cat = store.categories.find(
      (c: any) => c.id.toLowerCase() === id.toLowerCase() || c.slug.toLowerCase() === id.toLowerCase(),
    );
    if (!cat) throw new NotFoundException(`Category ${id} not found`);
    const children = store.categories.filter((c: any) => c.parentId === cat.id);
    return {
      ...cat,
      children,
      subcategories: children,
    };
  }

  async getSubcategories(parentId: string) {
    const store = this.prisma.getStore();
    const subcats = store.categories.filter(
      (c: any) => c.parentId && c.parentId.toLowerCase() === parentId.toLowerCase(),
    );
    return subcats.map((sc: any) => {
      const leaves = store.categories.filter((leaf: any) => leaf.parentId === sc.id);
      return {
        ...sc,
        children: leaves,
        subcategories: leaves,
      };
    });
  }

  async getDarkStores() {
    return this.prisma.getStore().darkStores;
  }

  async getActiveCoupons() {
    return this.prisma.getStore().coupons.filter((c) => c.isActive);
  }

  /**
   * Search Suggestions Engine:
   * Provides real-time keyword autocompletions, matching categories, matching brands,
   * trending queries, and instant preview products.
   */
  async getSearchSuggestions(dto?: SearchSuggestionsDto): Promise<SearchSuggestionsResponse> {
    const rawQuery = (dto?.q || '').trim();
    const query = rawQuery.toLowerCase();
    const limit = Math.min(20, Math.max(1, Number(dto?.limit) || 8));
    const allProducts = this.prisma.getStore().products;
    const allCategories = this.prisma.getStore().categories;

    const trending = [
      'Handloom Silk Sarees',
      'Embroidered Anarkali Sets',
      'Chanderi Silk Tunics',
      'Tiered Floral Maxi Dresses',
      'Structured Linen Shirts',
      'Raw Selvedge Denim',
      'Court Leather Sneakers',
      'Minimal Leather Totes',
    ];

    // If query is empty, return trending keywords, top categories, top brands & instant picks
    if (!query) {
      const popularCategories = allCategories.slice(0, 5).map((c) => {
        const count = allProducts.filter(
          (p) =>
            p.category.toLowerCase() === c.name.toLowerCase() ||
            p.categoryId.toLowerCase() === c.id.toLowerCase(),
        ).length;
        return { id: c.id, name: c.name, count };
      });

      const brandCounts: Record<string, number> = {};
      allProducts.forEach((p) => {
        brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1;
      });

      const topBrands = Object.entries(brandCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const recentPicks = allProducts
        .filter((p) => p.rating >= 4.8)
        .slice(0, 4)
        .map((p) => this.mapProductWithHub(p));

      return {
        query: '',
        suggestions: trending.slice(0, limit).map((text) => ({ text, type: 'keyword' })),
        categories: popularCategories,
        brands: topBrands,
        trending,
        recentPicks,
      };
    }

    const tokens = query.split(/\s+/).filter(Boolean);

    // 1. Gather Keyword Suggestions from Titles, Tags, Fabrics
    const suggestionMap = new Map<string, { type: 'keyword' | 'category' | 'brand'; count: number }>();

    // Check Categories
    allCategories.forEach((cat) => {
      const catNameLower = cat.name.toLowerCase();
      if (catNameLower.includes(query) || tokens.some((t) => catNameLower.includes(t))) {
        const count = allProducts.filter(
          (p) =>
            p.category.toLowerCase() === cat.name.toLowerCase() ||
            p.categoryId.toLowerCase() === cat.id.toLowerCase(),
        ).length;
        suggestionMap.set(cat.name, { type: 'category', count });
      }
    });

    // Check Brands
    const brandSeen = new Set<string>();
    allProducts.forEach((p) => {
      const brandLower = p.brand.toLowerCase();
      if (brandLower.includes(query) || tokens.some((t) => brandLower.includes(t))) {
        if (!brandSeen.has(p.brand)) {
          brandSeen.add(p.brand);
          const count = allProducts.filter((prod) => prod.brand === p.brand).length;
          suggestionMap.set(p.brand, { type: 'brand', count });
        }
      }
    });

    // Check Titles and Tags for completions
    allProducts.forEach((p) => {
      const titleLower = p.title.toLowerCase();
      if (titleLower.includes(query) || tokens.every((t) => titleLower.includes(t))) {
        suggestionMap.set(p.title, { type: 'keyword', count: 1 });
      }

      if (p.tags && Array.isArray(p.tags)) {
        p.tags.forEach((tag: string) => {
          if (tag.toLowerCase().includes(query)) {
            const capitalTag = tag.charAt(0).toUpperCase() + tag.slice(1);
            if (!suggestionMap.has(capitalTag)) {
              suggestionMap.set(capitalTag, { type: 'keyword', count: 1 });
            }
          }
        });
      }

      if (p.fabric && p.fabric.toLowerCase().includes(query)) {
        if (!suggestionMap.has(p.fabric)) {
          suggestionMap.set(p.fabric, { type: 'keyword', count: 1 });
        }
      }
    });

    const suggestions: SearchSuggestionItem[] = Array.from(suggestionMap.entries())
      .map(([text, meta]) => ({
        text,
        type: meta.type,
        count: meta.count,
        highlight: query,
      }))
      .slice(0, limit);

    // Matching Categories with counts
    const matchingCategories = allCategories
      .filter((c) => c.name.toLowerCase().includes(query) || tokens.some((t) => c.name.toLowerCase().includes(t)))
      .map((c) => ({
        id: c.id,
        name: c.name,
        count: allProducts.filter(
          (p) =>
            p.category.toLowerCase() === c.name.toLowerCase() ||
            p.categoryId.toLowerCase() === c.id.toLowerCase(),
        ).length,
      }));

    // Matching Brands with counts
    const matchingBrands = Array.from(brandSeen).map((brand) => ({
      name: brand,
      count: allProducts.filter((p) => p.brand === brand).length,
    }));

    // Instant Product Picks: top matching products
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
   * Multi-token relevance scoring, token matching across title, brand, category,
   * fabric, origin, description, tags. Supports comprehensive filters and sorting.
   */
  async searchProducts(query?: GetProductsDto) {
    let products = [...this.prisma.getStore().products];
    const searchTerm = (query?.search || '').trim();

    // 1. Keyword & Multi-token Relevance Scoring
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const tokens = q.split(/\s+/).filter(Boolean);

      const scoredProducts = products
        .map((p: any) => {
          let score = 0;
          const title = (p.title || '').toLowerCase();
          const brand = (p.brand || '').toLowerCase();
          const category = (p.category || '').toLowerCase();
          const categoryId = (p.categoryId || '').toLowerCase();
          const fabric = (p.fabric || '').toLowerCase();
          const origin = (p.origin || '').toLowerCase();
          const desc = (p.description || '').toLowerCase();
          const tags: string[] = Array.isArray(p.tags) ? p.tags.map((t: string) => t.toLowerCase()) : [];

          // Exact phrase matches
          if (title === q) score += 120;
          else if (title.startsWith(q)) score += 70;
          else if (title.includes(q)) score += 45;

          if (brand === q) score += 100;
          else if (brand.includes(q)) score += 40;

          if (category === q || categoryId === q) score += 60;
          else if (category.includes(q)) score += 30;

          if (fabric.includes(q)) score += 30;
          if (origin.includes(q)) score += 20;
          if (desc.includes(q)) score += 15;

          if (tags.some((t) => t === q)) score += 50;
          else if (tags.some((t) => t.includes(q))) score += 25;

          // Multi-token evaluation
          let matchedTokensCount = 0;
          tokens.forEach((token) => {
            let tokenMatched = false;
            if (title.includes(token)) {
              score += 25;
              tokenMatched = true;
            }
            if (brand.includes(token)) {
              score += 20;
              tokenMatched = true;
            }
            if (category.includes(token) || categoryId.includes(token)) {
              score += 20;
              tokenMatched = true;
            }
            if (tags.some((t) => t.includes(token))) {
              score += 15;
              tokenMatched = true;
            }
            if (fabric.includes(token)) {
              score += 10;
              tokenMatched = true;
            }
            if (desc.includes(token)) {
              score += 5;
              tokenMatched = true;
            }
            if (tokenMatched) matchedTokensCount++;
          });

          // All tokens matched bonus
          if (tokens.length > 1 && matchedTokensCount === tokens.length) {
            score += 50;
          }

          return { product: p, score };
        })
        .filter((item) => item.score > 0);

      // Sort by score descending unless explicit sort is specified
      if (!query?.sortBy && !query?.sort) {
        scoredProducts.sort((a, b) => b.score - a.score);
      }

      products = scoredProducts.map((item) => item.product);
    }

    // 2. Fulfillment Type Filter
    if (query?.fulfillmentType) {
      const ft = query.fulfillmentType.toUpperCase();
      if (ft !== 'ALL') {
        products = products.filter((p: any) => p.fulfillmentType === ft);
      }
    }

    // 3. Try & Buy Filter
    if (query?.tryAndBuyOnly === 'true' || query?.tryAndBuyOnly === '1' || (query?.tryAndBuyOnly as any) === true) {
      products = products.filter((p: any) => p.tryAndBuyEligible === true);
    }

    // 4. Category Filter (Supports L1 Department, L2 Subcategory, or L3 Leaf matching)
    if (query?.category && query.category.toLowerCase() !== 'all') {
      const cat = query.category.toLowerCase();
      const store = this.prisma.getStore();
      const allCategories = store.categories || [];

      // Collect target category and all its descendants
      const matchingCatIds = new Set<string>([cat]);
      const targetCat = allCategories.find(
        (c: any) =>
          c.id.toLowerCase() === cat ||
          c.slug.toLowerCase() === cat ||
          c.name.toLowerCase() === cat,
      );

      if (targetCat) {
        matchingCatIds.add(targetCat.id.toLowerCase());
        matchingCatIds.add(targetCat.slug.toLowerCase());
        matchingCatIds.add(targetCat.name.toLowerCase());

        const collectDescendants = (parentId: string) => {
          allCategories
            .filter((c: any) => c.parentId === parentId)
            .forEach((child: any) => {
              matchingCatIds.add(child.id.toLowerCase());
              matchingCatIds.add(child.slug.toLowerCase());
              matchingCatIds.add(child.name.toLowerCase());
              collectDescendants(child.id);
            });
        };
        collectDescendants(targetCat.id);
      }

      products = products.filter((p: any) => {
        const pCat = (p.category || '').toLowerCase();
        const pCatId = (p.categoryId || '').toLowerCase();
        const pGender = (p.gender || '').toLowerCase();
        return (
          matchingCatIds.has(pCat) ||
          matchingCatIds.has(pCatId) ||
          (targetCat?.level === 1 && targetCat.name.toLowerCase() === pGender)
        );
      });
    }

    // 5. Price Bounds
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

    // 6. Sorting
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

    // 7. Attach Real-Time Badges & Dark Store Hub
    const mapped = products.map((p: any) => this.mapProductWithHub(p));

    // 8. Pagination
    if (query?.page && query?.limit) {
      const page = Math.max(1, Number(query.page));
      const limit = Math.max(1, Number(query.limit));
      const start = (page - 1) * limit;
      return mapped.slice(start, start + limit);
    }

    if (query?.limit && !query?.page) {
      const limit = Math.max(1, Number(query.limit));
      return mapped.slice(0, limit);
    }

    return mapped;
  }

  async getProducts(query?: GetProductsDto) {
    return this.searchProducts(query);
  }

  async getProductById(id: string) {
    const rawId = String(id).trim();
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
      'prod-2': 'prod-2',
      '3': 'prod-9',
      'prod-3': 'prod-3',
      '4': 'prod-6',
      'prod-4': 'prod-4',
      '5': 'prod-5',
      'prod-5': 'prod-5',
      '6': 'prod-6',
      'prod-6': 'prod-6',
      '7': 'prod-7',
      'prod-7': 'prod-7',
      '8': 'prod-8',
      'prod-8': 'prod-8',
      '9': 'prod-4',
      'prod-9': 'prod-9',
      '10': 'prod-10',
      'prod-10': 'prod-10',
    };
    const cleanId = ID_ALIASES[rawId] || rawId;

    const product: any = this.prisma.getStore().products.find(
      (p) =>
        p.id === cleanId ||
        p.id === `prod-${cleanId}` ||
        p.id.replace('prod-', '') === cleanId ||
        p.id.replace('deal-', '') === cleanId ||
        (cleanId.startsWith('prod-') && p.id === cleanId.replace('prod-', '')) ||
        p.id === ID_ALIASES[cleanId],
    );
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

  private mapProductWithHub(p: any) {
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
  }
}
