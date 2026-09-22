import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { OrderStatus } from './state-machine.service';

@Controller('api/v1/orders')
@UseGuards(FirebaseAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  async checkout(@Body() body: { addressId: string; paymentMethod: 'RAZORPAY' | 'COD' }) {
    return this.ordersService.checkout('usr-1', body.addressId || 'addr-1', body.paymentMethod || 'RAZORPAY');
  }

  @Get()
  async getOrders() {
    return this.ordersService.getOrders('usr-1');
  }

  @Get(':id')
  async getOrderById(@Param('id') id: string) {
    return this.ordersService.getOrderById(id);
  }

  @Get(':id/track')
  async trackOrder(@Param('id') id: string) {
    return this.ordersService.trackOrder(id);
  }

  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: OrderStatus; note?: string }) {
    return this.ordersService.updateStatus(id, body.status, body.note);
  }
}
