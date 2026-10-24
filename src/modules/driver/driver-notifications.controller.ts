import {
  Controller,
  Get,
  Patch,
  Put,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DriverNotificationsService } from './driver-notifications.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/driver/notifications')
@UseGuards(FirebaseAuthGuard)
export class DriverNotificationsController {
  constructor(private readonly notificationsService: DriverNotificationsService) {}

  @Get()
  async getNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('category') category?: string,
  ) {
    return this.notificationsService.getNotifications(user.driverId || user.id, category);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(user.driverId || user.id, id);
  }

  @Put(':id/read')
  async markAsReadPut(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(user.driverId || user.id, id);
  }

  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllAsRead(user.driverId || user.id);
  }

  @Put('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllAsReadPut(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllAsRead(user.driverId || user.id);
  }

  @Delete(':id')
  async deleteNotification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.notificationsService.deleteNotification(user.driverId || user.id, id);
  }

  @Delete()
  async clearAll(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.clearAll(user.driverId || user.id);
  }
}
