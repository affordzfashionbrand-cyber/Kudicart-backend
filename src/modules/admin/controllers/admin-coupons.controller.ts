import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminCatalogService } from '../services/admin-catalog.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { CreateCouponDto, UpdateCouponDto } from '../dto/admin-domain.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/coupons')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminCouponsController {
  constructor(private readonly catalogService: AdminCatalogService) {}

  @Get()
  async listCoupons(@Query() query: AdminQueryDto) {
    return this.catalogService.listCoupons(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCoupon(
    @Body() dto: CreateCouponDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalogService.createCoupon(dto, actor?.id, actor?.name);
  }

  @Patch(':id')
  async updateCoupon(
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalogService.updateCoupon(id, dto, actor?.id, actor?.name);
  }

  @Delete(':id')
  async deleteCoupon(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalogService.deleteCoupon(id, actor?.id, actor?.name);
  }
}
