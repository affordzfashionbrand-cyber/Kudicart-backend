import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AdminSupportService } from '../services/admin-support.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateSupportTicketDto } from '../dto/admin-domain.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/support')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminSupportController {
  constructor(private readonly supportService: AdminSupportService) {}

  @Get('tickets')
  async listTickets(@Query() query: AdminQueryDto) {
    return this.supportService.listTickets(query);
  }

  @Get('tickets/:id')
  async getTicketById(@Param('id') id: string) {
    return this.supportService.getTicketById(id);
  }

  @Patch('tickets/:id')
  async updateTicket(
    @Param('id') id: string,
    @Body() dto: UpdateSupportTicketDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.supportService.updateTicket(id, dto, actor?.id, actor?.name);
  }
}

