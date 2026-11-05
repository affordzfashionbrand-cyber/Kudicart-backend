import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { GoogleRoutesService } from './google-routes.service';
import { TrackingRealtimeGateway } from './tracking-realtime.gateway';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [FirebaseAdminService, GoogleRoutesService, TrackingRealtimeGateway],
  exports: [GoogleRoutesService, TrackingRealtimeGateway],
})
export class TrackingModule {}

