import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';
import { CatalogController } from './modules/catalog/catalog.controller';
import { CatalogService } from './modules/catalog/catalog.service';
import { CartController } from './modules/cart/cart.controller';
import { CartService } from './modules/cart/cart.service';
import { AddressController } from './modules/address/address.controller';
import { AddressService } from './modules/address/address.service';
import { OrdersController } from './modules/orders/orders.controller';
import { OrdersService } from './modules/orders/orders.service';
import { StateMachineService } from './modules/orders/state-machine.service';
import { DriverController } from './modules/driver/driver.controller';
import { DriverService } from './modules/driver/driver.service';
import { PaymentsController } from './modules/payments/payments.controller';
import { PaymentsService } from './modules/payments/payments.service';
import { ReviewsController } from './modules/reviews/reviews.controller';
import { ReviewsService } from './modules/reviews/reviews.service';
import { SupportController } from './modules/support/support.controller';
import { SupportService } from './modules/support/support.service';

@Module({
  imports: [],
  controllers: [
    AuthController,
    UsersController,
    CatalogController,
    CartController,
    AddressController,
    OrdersController,
    DriverController,
    PaymentsController,
    ReviewsController,
    SupportController,
  ],
  providers: [
    PrismaService,
    AuthService,
    UsersService,
    CatalogService,
    CartService,
    AddressService,
    OrdersService,
    StateMachineService,
    DriverService,
    PaymentsService,
    ReviewsService,
    SupportService,
  ],
  exports: [PrismaService, StateMachineService],
})
export class AppModule {}
