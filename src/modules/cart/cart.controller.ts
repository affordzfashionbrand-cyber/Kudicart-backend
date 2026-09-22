import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { CartService } from './cart.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';

@Controller('api/v1/cart')
@UseGuards(FirebaseAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart() {
    return this.cartService.getCart('usr-1');
  }

  @Post('items')
  async addItem(@Body() body: { productId: string; size?: string }) {
    return this.cartService.addItem('usr-1', body.productId, body.size);
  }

  @Patch('items/:id')
  async updateQuantity(@Param('id') id: string, @Body() body: { delta: number }) {
    return this.cartService.updateQuantity(id, body.delta);
  }

  @Delete('items/:id')
  async removeItem(@Param('id') id: string) {
    return this.cartService.removeItem(id);
  }
}
