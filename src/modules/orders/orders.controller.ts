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
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/orders')
@UseGuards(FirebaseAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CheckoutDto,
  ) {
    return this.ordersService.checkout(user.id, body);
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
  async trackOrder(@Param('id') id: string) {
    return this.ordersService.trackOrder(id);
  }

  // Admin Manual Rider Assignment (D-006)
  @Post(':id/assign-driver')
  @HttpCode(HttpStatus.OK)
  async assignDriver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AssignDriverDto,
  ) {
    return this.ordersService.assignDriver(id, body.driverId, user.role);
  }

  // Vendor State Transition: Accept
  @Post(':id/vendor-accept')
  @HttpCode(HttpStatus.OK)
  async vendorAccept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.vendorAccept(id, user.role);
  }

  // Vendor State Transition: Prepare
  @Post(':id/vendor-prepare')
  @HttpCode(HttpStatus.OK)
  async vendorPrepare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.vendorPrepare(id, user.role);
  }

  // Vendor State Transition: Ready for Pickup
  @Post(':id/vendor-ready')
  @HttpCode(HttpStatus.OK)
  async vendorReady(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.vendorReadyForPickup(id, user.role);
  }

  // Status transition with role check
  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, body.status, body.note, user.role);
  }
}
