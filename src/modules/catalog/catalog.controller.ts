import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('api/v1')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  async getCategories() {
    return this.catalogService.getCategories();
  }

  @Get('products')
  async getProducts(
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.catalogService.getProducts(category, search);
  }

  @Get('products/:id')
  async getProductById(@Param('id') id: string) {
    return this.catalogService.getProductById(id);
  }
}
