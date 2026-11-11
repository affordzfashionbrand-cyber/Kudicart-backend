import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('api/v1/notifications')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER, Role.VENDOR, Role.ADMIN, Role.DRIVER)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('category') category?: string,
  ) {
    if (!user?.id) {
      throw new BadRequestException('Authenticated user identity required');
    }
    return this.notificationsService.listForUser(user.id, user.role, {
      limit: limit ? Number(limit) : undefined,
      unreadOnly: unreadOnly === 'true',
      category: category || undefined,
    });
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.id) {
      throw new BadRequestException('Authenticated user identity required');
    }
    return this.notificationsService.markAllAsReadForUser(user.id, user.role);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    if (!user?.id) {
      throw new BadRequestException('Authenticated user identity required');
    }
    return this.notificationsService.markAsReadForUser(id, user.id, user.role);
  }
}
