import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/orders')
@UseGuards(FirebaseAuthGuard)
export class AdminOrdersController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  async listOrders(@Query() query: any) {
    return this.adminService.listOrders(query);
  }

  @Get(':id')
  async getOrderById(@Param('id') id: string) {
    return this.adminService.getOrderById(id);
  }

  @Post(':orderId/assign-driver')
  async assignDriver(
    @Param('orderId') orderId: string,
    @Body() body: { driverId: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.assignDriverToOrder(orderId, body.driverId, user);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateOrderStatus(id, body.status, user);
  }
}
