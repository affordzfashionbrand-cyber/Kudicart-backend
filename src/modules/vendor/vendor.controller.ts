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
import { VendorService } from './vendor.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { FirebaseLoginDto } from '../auth/dto/firebase-login.dto';

@Controller('api/v1/vendor')
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Post('auth/firebase/login')
  @HttpCode(HttpStatus.OK)
  async firebaseLogin(@Body() dto: FirebaseLoginDto) {
    return this.vendorService.loginFirebase(dto.idToken);
  }

  @Post('auth/login-firebase')
  @HttpCode(HttpStatus.OK)
  async loginFirebaseAlias(@Body() dto: FirebaseLoginDto) {
    return this.vendorService.loginFirebase(dto.idToken);
  }

  @Get('auth/me')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorService.getProfile(user.id);
  }

  @Patch('auth/me')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      name?: string;
      phone?: string;
      storeName?: string;
      contactPerson?: string;
      address?: string;
    },
  ) {
    return this.vendorService.updateProfile(user.id, body);
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async logout(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorService.logout(user.id);
  }

  @Get('orders')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async getOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ) {
    return this.vendorService.getOrders(user.id, user.role, status);
  }

  @Get('orders/:id')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async getOrderById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.vendorService.getOrderById(user.id, user.role, id);
  }

  @Post('orders/:id/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async acceptOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.vendorService.acceptOrder(user.id, user.role, id);
  }

  @Post('orders/:id/prepare')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async prepareOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.vendorService.prepareOrder(user.id, user.role, id);
  }

  @Post('orders/:id/ready-for-pickup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async readyForPickup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.vendorService.readyForPickup(user.id, user.role, id);
  }

  @Post('orders/:id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async rejectOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body?: { reason?: string; expectedVersion?: number },
  ) {
    return this.vendorService.rejectOrder(
      user.id,
      user.role,
      id,
      body?.reason,
      body?.expectedVersion,
    );
  }
}
