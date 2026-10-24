import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachineService } from '../orders/state-machine.service';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';

import { DriverAuthController } from './driver-auth.controller';
import { DriverAuthService } from './driver-auth.service';

import { DriverProfileController } from './driver-profile.controller';
import { DriverProfileService } from './driver-profile.service';

import { DriverShiftsController } from './driver-shifts.controller';
import { DriverShiftsService } from './driver-shifts.service';

import { DriverEarningsController } from './driver-earnings.controller';
import { DriverEarningsService } from './driver-earnings.service';

import { DriverNotificationsController } from './driver-notifications.controller';
import { DriverNotificationsService } from './driver-notifications.service';

import { DriverOrdersController } from './driver-orders.controller';
import { DriverOrdersService } from './driver-orders.service';
import { DriverTryAndBuyService } from './driver-try-and-buy.service';

import { DriverAdminController } from './driver-admin.controller';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';

@Module({
  controllers: [
    DriverAuthController,
    DriverProfileController,
    DriverShiftsController,
    DriverEarningsController,
    DriverNotificationsController,
    DriverOrdersController,
    DriverAdminController,
    DriverController,
  ],
  providers: [
    StateMachineService,
    RateLimitGuard,
    DriverAuthService,
    DriverProfileService,
    DriverShiftsService,
    DriverEarningsService,
    DriverNotificationsService,
    DriverTryAndBuyService,
    DriverOrdersService,
    DriverService,
  ],
  exports: [
    DriverService,
    DriverAuthService,
    DriverProfileService,
    DriverShiftsService,
    DriverEarningsService,
    DriverNotificationsService,
    DriverTryAndBuyService,
    DriverOrdersService,
    RateLimitGuard,
  ],
})
export class DriverModule {}
