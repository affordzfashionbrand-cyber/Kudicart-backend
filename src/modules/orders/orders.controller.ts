import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CheckoutDto } from './dto/checkout.dto';
import { AssignDriverDto } from './dto/assign-driver.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CustomerTryAndBuySelectionDto } from './dto/customer-try-and-buy-selection.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/orders')
@UseGuards(FirebaseAuthGuard, RolesGuard, RateLimitGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @RateLimit({ points: 10, duration: 60 })
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.ordersService.checkout(user.id, body, idempotencyKey);
  }

  @Post('verify-payment')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @RateLimit({ points: 20, duration: 60 })
  async verifyPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      orderId?: string;
      checkoutGroupId?: string;
      paymentId: string;
      signature: string;
      razorpayOrderId?: string;
    },
  ) {
    return this.ordersService.verifyPayment(
      body.orderId || body.checkoutGroupId || '',
      body.paymentId,
      body.signature,
      body.razorpayOrderId,
      user.id,
      user.role,
    );
  }

  @Get()
  async getOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.getOrders(user.id, user.role, user.driverId, user.vendorId);
  }

  @Get('groups/:groupId')
  async getCheckoutGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
  ) {
    return this.ordersService.getCheckoutGroup(groupId, user.id, user.role);
  }

  @Get(':id')
  async getOrderById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.getOrderById(id, user.id, user.role, user.driverId, user.vendorId);
  }

  @Get(':id/track')
  async trackOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.trackOrder(id, user.id, user.role, user.driverId, user.vendorId);
  }

  @Get(':id/route')
  async getOrderRoute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.getOrderRoute(id, user.id, user.role, user.driverId, user.vendorId);
  }

  @Patch(':id/status')
  @Roles(Role.VENDOR, Role.DRIVER, Role.ADMIN)
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(
      id,
      body.status,
      user.role,
      body.note,
      user.id,
      body.expectedVersion,
      user.vendorId,
      user.driverId,
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CUSTOMER, Role.VENDOR, Role.ADMIN)
  async cancelOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: CancelOrderDto,
  ) {
    return this.ordersService.cancelOrder(
      id,
      user,
      body?.reason,
      body?.expectedVersion,
    );
  }

  @Post(':id/try-and-buy/customer-selections')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  async submitCustomerTryAndBuySelections(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: CustomerTryAndBuySelectionDto,
  ) {
    return this.ordersService.submitCustomerTryAndBuySelections(
      id,
      user.id,
      user.role,
      body.selections,
    );
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  async assignDriver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AssignDriverDto,
  ) {
    return this.ordersService.assignDriver(id, body.driverId, user.role, user.id, user.name);
  }
}
