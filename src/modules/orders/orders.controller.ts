import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CheckoutDto } from './dto/checkout.dto';
import { AssignDriverDto } from './dto/assign-driver.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/orders')
@UseGuards(FirebaseAuthGuard, RateLimitGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ points: 10, duration: 60 }) // Max 10 checkouts per minute per user
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CheckoutDto,
  ) {
    return this.ordersService.checkout(user.id, body);
  }

  @Post('verify-payment')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 20, duration: 60 }) // Max 20 verification attempts per minute
  async verifyPayment(
    @Body() body: { orderId: string; paymentId: string; signature: string },
  ) {
    return this.ordersService.verifyPayment(body.orderId, body.paymentId, body.signature);
  }

  @Get()
  async getOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.getOrders(user.id, user.role, user.driverId);
  }

  @Get(':id')
  async getOrderById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.getOrderById(id, user.id, user.role);
  }

  @Get(':id/track')
  async trackOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.trackOrder(id, user.id, user.role);
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, body.status, user.role, user.id);
  }

  @Post(':id/assign')
  async assignDriver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AssignDriverDto,
  ) {
    return this.ordersService.assignDriver(id, body.driverId, user.role);
  }
}
