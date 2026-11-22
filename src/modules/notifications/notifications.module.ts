import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DeviceTokensService } from './device-tokens.service';
import { DeviceTokensController } from './device-tokens.controller';
import { NotificationsController } from './notifications.controller';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { EmailService } from './email.service';

@Global()
@Module({
  controllers: [DeviceTokensController, NotificationsController],
  providers: [NotificationsService, DeviceTokensService, FirebaseAdminService, EmailService],
  exports: [NotificationsService, DeviceTokensService, FirebaseAdminService, EmailService],
})
export class NotificationsModule {}
