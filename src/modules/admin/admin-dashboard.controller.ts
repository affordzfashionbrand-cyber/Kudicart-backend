import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';

@Controller('api/v1/admin/dashboard')
@UseGuards(FirebaseAuthGuard)
export class AdminDashboardController {
  constructor(private readonly adminService: AdminService) {}

  @Get('summary')
  async getSummary(@Query('dateRange') dateRange?: string) {
    return this.adminService.getDashboardSummary(dateRange || 'today');
  }
}
