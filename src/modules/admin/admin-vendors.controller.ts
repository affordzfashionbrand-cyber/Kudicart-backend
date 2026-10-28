import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/vendors')
@UseGuards(FirebaseAuthGuard)
export class AdminVendorsController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  async listVendors(@Query() query: any) {
    return this.adminService.listVendors(query);
  }

  @Get(':id')
  async getVendorById(@Param('id') id: string) {
    return this.adminService.getVendorById(id);
  }

  @Post(':id/approve')
  async approveVendor(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adminService.updateVendorStatus(id, 'approve', user);
  }

  @Post(':id/reject')
  async rejectVendor(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateVendorStatus(id, 'reject', user);
  }

  @Post(':id/suspend')
  async suspendVendor(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateVendorStatus(id, 'suspend', user);
  }
}
