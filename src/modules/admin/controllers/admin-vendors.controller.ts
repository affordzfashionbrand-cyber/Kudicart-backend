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
import { AdminVendorsService } from '../services/admin-vendors.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { VendorReviewActionDto } from '../dto/admin-actions.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/vendors')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminVendorsController {
  constructor(private readonly vendorsService: AdminVendorsService) {}

  @Get()
  async listVendors(@Query() query: AdminQueryDto) {
    return this.vendorsService.listVendors(query);
  }

  @Get(':id')
  async getVendorById(@Param('id') id: string) {
    return this.vendorsService.getVendorById(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approveVendor(
    @Param('id') id: string,
    @Body() dto: VendorReviewActionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.vendorsService.approveVendor(id, dto, actor?.id, actor?.name);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectVendor(
    @Param('id') id: string,
    @Body() dto: VendorReviewActionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.vendorsService.rejectVendor(id, dto, actor?.id, actor?.name);
  }

  @Patch(':id/suspend')
  async toggleSuspendVendor(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.vendorsService.toggleSuspendVendor(id, actor?.id, actor?.name);
  }
}

