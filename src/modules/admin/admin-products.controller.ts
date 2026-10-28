import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/products')
@UseGuards(FirebaseAuthGuard)
export class AdminProductsController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  async listProducts(@Query() query: any) {
    return this.adminService.listProducts(query);
  }

  @Get(':id')
  async getProductById(@Param('id') id: string) {
    const list = (await this.adminService.listProducts()).data;
    return list.find((p: any) => p.id === id) || { id, title: 'Product' };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateProductStatus(id, body.status, user);
  }

  @Patch(':id/stock')
  async updateStock(
    @Param('id') id: string,
    @Body() body: { stock: number },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateProductStock(id, body.stock, user);
  }
}
