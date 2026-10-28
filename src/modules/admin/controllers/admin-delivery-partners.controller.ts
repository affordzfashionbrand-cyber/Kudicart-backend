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
import { AdminDriversService } from '../services/admin-drivers.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { AdminKycReviewDto } from '../dto/admin-domain.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/delivery-partners')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminDeliveryPartnersController {
  constructor(private readonly driversService: AdminDriversService) {}

  @Get()
  async listDrivers(@Query() query: AdminQueryDto) {
    return this.driversService.listDrivers(query);
  }

  @Get(':id')
  async getDriverById(@Param('id') id: string) {
    return this.driversService.getDriverById(id);
  }

  @Post(':id/kyc-review')
  @HttpCode(HttpStatus.OK)
  async reviewKyc(
    @Param('id') id: string,
    @Body() dto: AdminKycReviewDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.driversService.reviewKyc(id, dto, actor?.id, actor?.name);
  }

  @Patch(':id/availability')
  async toggleAvailability(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.driversService.toggleAvailability(id, actor?.id, actor?.name);
  }
}

