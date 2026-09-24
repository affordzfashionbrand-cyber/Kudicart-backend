import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/support')
@UseGuards(FirebaseAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  async createTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateTicketDto,
  ) {
    return this.supportService.createTicket(user.id, body);
  }

  @Get('tickets')
  async getTickets(@CurrentUser() user: AuthenticatedUser) {
    return this.supportService.getTickets(user.id);
  }

  @Get('tickets/:id')
  async getTicketById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.supportService.getTicketById(user.id, id);
  }
}
