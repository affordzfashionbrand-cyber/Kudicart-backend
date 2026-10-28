import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';

@Controller('api/v1/admin')
@UseGuards(FirebaseAuthGuard)
export class AdminFinanceController {
  constructor(private readonly adminService: AdminService) {}

  @Get('payments')
  async listPayments(@Query() query: any) {
    return this.adminService.listPayments(query);
  }

  @Get('payments/metrics')
  async getPaymentMetrics() {
    return this.adminService.getPaymentMetrics();
  }

  @Get('ledger')
  async listLedger(@Query() query: any) {
    return this.adminService.listLedger(query);
  }

  @Get('ledger/metrics')
  async getLedgerMetrics() {
    return this.adminService.getLedgerMetrics();
  }

  @Patch('ledger/:id/status')
  async updateLedgerStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return { success: true, message: `Ledger entry ${id} marked ${body.status}` };
  }
}
