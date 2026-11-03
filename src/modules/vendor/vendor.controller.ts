import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { VendorService } from './vendor.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/vendor')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.VENDOR, Role.ADMIN)
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Get('orders')
  async getOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ) {
    return this.vendorService.getOrders(user.id, user.role, status);
  }

  @Get('orders/:id')
  async getOrderById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.vendorService.getOrderById(user.id, user.role, id);
  }

  @Post('orders/:id/accept')
  @HttpCode(HttpStatus.OK)
  async acceptOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.vendorService.acceptOrder(user.id, user.role, id);
  }

  @Post('orders/:id/prepare')
  @HttpCode(HttpStatus.OK)
  async prepareOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.vendorService.prepareOrder(user.id, user.role, id);
  }

  @Post('orders/:id/ready-for-pickup')
  @HttpCode(HttpStatus.OK)
  async readyForPickup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.vendorService.readyForPickup(user.id, user.role, id);
  }
}

