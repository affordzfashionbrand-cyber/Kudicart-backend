import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuditService } from '../services/admin-audit.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';

@Controller('api/v1/admin/audit')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminAuditController {
  constructor(private readonly auditService: AdminAuditService) {}

  @Get()
  async listAuditEvents(@Query() query: AdminQueryDto) {
    return this.auditService.listAuditEvents(query);
  }
}

