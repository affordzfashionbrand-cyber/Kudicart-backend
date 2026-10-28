import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminFinanceService } from '../services/admin-finance.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';

@Controller('api/v1/admin/payments')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminPaymentsController {
  constructor(private readonly financeService: AdminFinanceService) {}

  @Get()
  async listPayments(@Query() query: AdminQueryDto) {
    return this.financeService.listPayments(query);
  }

  @Get('metrics')
  async getPaymentMetrics() {
    return this.financeService.getPaymentMetrics();
  }

  @Get(':id')
  async getPaymentById(@Param('id') id: string) {
    return this.financeService.getPaymentById(id);
  }
}

