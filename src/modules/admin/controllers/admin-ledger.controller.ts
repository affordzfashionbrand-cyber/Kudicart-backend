import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AdminFinanceService } from '../services/admin-finance.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateSettlementStatusDto } from '../dto/admin-domain.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/ledger')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminLedgerController {
  constructor(private readonly financeService: AdminFinanceService) {}

  @Get()
  async listLedger(@Query() query: AdminQueryDto) {
    return this.financeService.listLedger(query);
  }

  @Get('metrics')
  async getLedgerMetrics() {
    return this.financeService.getLedgerMetrics();
  }

  @Patch(':id/status')
  async updateSettlementStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSettlementStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.financeService.updateSettlementStatus(
      id,
      dto,
      actor?.id,
      actor?.name,
    );
  }
}

