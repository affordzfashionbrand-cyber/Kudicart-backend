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

  // --- Store Availability & Timings ---

  @Get('store/status')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async getStoreStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorService.getStoreStatus(user.id);
  }

  @Patch('store/status')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async toggleStoreStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { isOnline: boolean },
  ) {
    return this.vendorService.toggleStoreStatus(user.id, body.isOnline);
  }

  @Patch('store/operating-hours')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async updateOperatingHours(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { operatingHours: any; autoScheduleEnabled?: boolean },
  ) {
    return this.vendorService.updateOperatingHours(user.id, body);
  }

  // --- Financial Overview & Commission ---

  @Get('finance/overview')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async getFinanceOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorService.getFinanceOverview(user.id);
  }

  // --- Boutique Catalog Management ---

  @Get('products')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async getProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: any,
  ) {
    return this.vendorService.getProducts(user.id, user.role, query);
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async createProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: any,
  ) {
    return this.vendorService.createProduct(user.id, user.role, body);
  }

  @Patch('products/:id/status')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async updateProductStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.vendorService.updateProductStatus(user.id, user.role, id, body.status);
  }

  @Patch('products/:id/stock')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async updateProductStock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { stock: number },
  ) {
    return this.vendorService.updateProductStock(user.id, user.role, id, body.stock);
  }

  // --- Promotional Banners (Admin Approval Workflow) ---

  @Get('banners')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async getBanners(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorService.getBanners(user.id, user.role);
  }

  @Post('banners')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async createBanner(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      title: string;
      subtitle?: string;
      discountText?: string;
      imageUrl: string;
      placement?: 'HERO_CAROUSEL' | 'EDITORIAL_STRIP' | 'MODERN_REDEFINED';
      targetGender?: string;
      tag?: string;
      actionType?: string;
      actionValue?: string;
    },
  ) {
    return this.vendorService.createBanner(user.id, user.role, body);
  }

  @Delete('banners/:id')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  async deleteBanner(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.vendorService.deleteBanner(user.id, user.role, id);
  }
}
