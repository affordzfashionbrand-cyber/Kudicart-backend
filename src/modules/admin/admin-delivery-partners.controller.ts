import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/delivery-partners')
@UseGuards(FirebaseAuthGuard)
export class AdminDeliveryPartnersController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  async list(@Query() query: any) {
    return this.adminService.listDeliveryPartners(query);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.adminService.getDeliveryPartnerById(id);
  }

  @Post(':id/kyc')
  async reviewKycPost(
    @Param('id') id: string,
    @Body() body: { status: string; rejectionReason?: string; notes?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateDriverKyc(
      id,
      { status: body.status, notes: body.rejectionReason || body.notes },
      user,
    );
  }

  @Patch(':id/kyc')
  async reviewKycPatch(
    @Param('id') id: string,
    @Body() body: { status: string; notes?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateDriverKyc(id, body, user);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateDriverStatus(id, body, user);
  }
}
