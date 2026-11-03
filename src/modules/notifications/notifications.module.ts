import { Module, Global } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DeviceTokensService } from './device-tokens.service';
import { DeviceTokensController } from './device-tokens.controller';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

@Global()
@Module({
  controllers: [DeviceTokensController],
  providers: [NotificationsService, DeviceTokensService, FirebaseAdminService],
  exports: [NotificationsService, DeviceTokensService, FirebaseAdminService],
})
export class NotificationsModule {}

