import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminReportsService } from '../services/admin-reports.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';

@Controller('api/v1/admin/reports')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminReportsController {
  constructor(private readonly reportsService: AdminReportsService) {}

  @Get(':category')
  async generateReport(
    @Param('category') category: string,
    @Query() query: AdminQueryDto,
  ) {
    return this.reportsService.generateReport(category, query);
  }
}

