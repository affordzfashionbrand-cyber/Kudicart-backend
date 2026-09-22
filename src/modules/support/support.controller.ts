import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { SupportService } from './support.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';

@Controller('api/v1/support')
@UseGuards(FirebaseAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('tickets')
  async createTicket(@Body() body: { title: string; category?: string; orderId?: string }) {
    return this.supportService.createTicket('usr-1', body);
  }

  @Get('tickets')
  async getTickets() {
    return this.supportService.getTickets('usr-1');
  }
}
