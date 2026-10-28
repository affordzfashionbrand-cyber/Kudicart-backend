import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminNotificationsService } from '../services/admin-notifications.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { BroadcastNotificationDto } from '../dto/admin-domain.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/notifications')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminNotificationsController {
  constructor(private readonly notificationsService: AdminNotificationsService) {}

  @Get()
  async listNotifications(@Query() query: AdminQueryDto) {
    return this.notificationsService.listNotifications(query);
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }

  @Post('broadcast')
  @HttpCode(HttpStatus.OK)
  async broadcast(
    @Body() dto: BroadcastNotificationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.notificationsService.broadcast(dto, actor?.id, actor?.name);
  }
}

