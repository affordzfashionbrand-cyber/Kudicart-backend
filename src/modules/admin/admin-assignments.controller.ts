import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/assignments')
@UseGuards(FirebaseAuthGuard)
export class AdminAssignmentsController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  async listAssignments(@Query() query: any) {
    return this.adminService.listAssignments(query);
  }

  @Post(':orderId/assign')
  async assign(
    @Param('orderId') orderId: string,
    @Body() body: { driverId: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.assignDriverToOrder(orderId, body.driverId, user);
  }
}
