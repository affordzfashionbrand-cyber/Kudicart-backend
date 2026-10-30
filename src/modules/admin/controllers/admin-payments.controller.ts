import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminFinanceService } from '../services/admin-finance.service';
import { PaymentReconciliationService } from '../../payments/payment-reconciliation.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';

@Controller('api/v1/admin/payments')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminPaymentsController {
  constructor(
    private readonly financeService: AdminFinanceService,
    private readonly reconciler: PaymentReconciliationService,
  ) {}

  @Get()
  async listPayments(@Query() query: AdminQueryDto) {
    return this.financeService.listPayments(query);
  }

  @Get('metrics')
  async getPaymentMetrics() {
    return this.financeService.getPaymentMetrics();
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcilePendingPayments(
    @Body() body?: { pendingThresholdMinutes?: number; expiryThresholdMinutes?: number },
  ) {
    return this.reconciler.reconcile(body);
  }

  @Get(':id')
  async getPaymentById(@Param('id') id: string) {
    return this.financeService.getPaymentById(id);
  }
}
