import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { GetProductsDto } from './dto/get-products.dto';
import { SearchSuggestionsDto } from './dto/search-suggestions.dto';

@Controller('api/v1')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  async getCategories(
    @Query('tree') tree?: string,
    @Query('parentId') parentId?: string,
    @Query('level') level?: string,
    @Query('gender') gender?: string,
  ) {
    return this.catalogService.getCategories({
      tree: tree === 'true' || tree === '1',
      parentId,
      level: level ? parseInt(level, 10) : undefined,
      gender,
    });
  }

  @Get('categories/hierarchy')
  async getCategoryHierarchy(@Query('gender') gender?: string) {
    return this.catalogService.getCategoryHierarchy(gender);
  }

  @Get('categories/:id')
  async getCategoryById(@Param('id') id: string) {
    return this.catalogService.getCategoryById(id);
  }

  @Get('categories/:id/subcategories')
  async getSubcategories(@Param('id') id: string) {
    return this.catalogService.getSubcategories(id);
  }

  @Get('dark-stores')
  async getDarkStores() {
    return this.catalogService.getDarkStores();
  }

  @Get('coupons/active')
  async getActiveCoupons() {
    return this.catalogService.getActiveCoupons();
  }

  @Get('search/suggestions')
  async getSearchSuggestions(@Query() query: SearchSuggestionsDto) {
    return this.catalogService.getSearchSuggestions(query);
  }

  @Get('catalog/suggestions')
  async getCatalogSuggestions(@Query() query: SearchSuggestionsDto) {
    return this.catalogService.getSearchSuggestions(query);
  }

  @Get('search')
  async searchProducts(@Query() query: GetProductsDto) {
    return this.catalogService.searchProducts(query);
  }

  @Get('products')
  async getProducts(@Query() query: GetProductsDto) {
    return this.catalogService.getProducts(query);
  }

  @Get('products/:id')
  async getProductById(@Param('id') id: string) {
    return this.catalogService.getProductById(id);
  }
}
