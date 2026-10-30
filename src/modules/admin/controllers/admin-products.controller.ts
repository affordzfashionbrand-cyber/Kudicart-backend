import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminCatalogService } from '../services/admin-catalog.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateProductStatusDto, UpdateProductStockDto } from '../dto/admin-domain.dto';
import { CreateDarkStoreProductDto } from '../dto/create-dark-store-product.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/products')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminProductsController {
  constructor(private readonly catalogService: AdminCatalogService) {}

  @Get()
  async listProducts(@Query() query: AdminQueryDto) {
    return this.catalogService.listProducts(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createDarkStoreProduct(
    @Body() dto: CreateDarkStoreProductDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalogService.createDarkStoreProduct(dto, actor?.id, actor?.name);
  }

  @Get(':id')
  async getProductById(@Param('id') id: string) {
    return this.catalogService.getProductById(id);
  }

  @Patch(':id/status')
  async updateProductStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProductStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalogService.updateProductStatus(id, dto, actor?.id, actor?.name);
  }

  @Patch(':id/stock')
  async updateProductStock(
    @Param('id') id: string,
    @Body() dto: UpdateProductStockDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalogService.updateProductStock(id, dto, actor?.id, actor?.name);
  }
}
