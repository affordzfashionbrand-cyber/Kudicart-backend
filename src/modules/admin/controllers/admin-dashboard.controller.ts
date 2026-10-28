import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminDashboardService } from '../services/admin-dashboard.service';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';

@Controller('api/v1/admin/dashboard')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminDashboardController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get('summary')
  async getSummary() {
    return this.dashboardService.getSummary();
  }
}

