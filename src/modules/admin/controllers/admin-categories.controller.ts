import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminCatalogService } from '../services/admin-catalog.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto/admin-domain.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/categories')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminCategoriesController {
  constructor(private readonly catalogService: AdminCatalogService) {}

  @Get()
  async listCategories(@Query() query: AdminQueryDto) {
    return this.catalogService.listCategories(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalogService.createCategory(dto, actor?.id, actor?.name);
  }

  @Patch(':id')
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalogService.updateCategory(id, dto, actor?.id, actor?.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteCategory(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalogService.deleteCategory(id, actor?.id, actor?.name);
  }
}

