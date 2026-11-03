import { Module } from '@nestjs/common';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { OrdersService } from '../orders/orders.service';
import { StateMachineService } from '../orders/state-machine.service';
import { PaymentsService } from '../payments/payments.service';
import { CartService } from '../cart/cart.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

@Module({
  controllers: [VendorController],
  providers: [
    VendorService,
    OrdersService,
    StateMachineService,
    PaymentsService,
    CartService,
    FirebaseAdminService,
  ],
  exports: [VendorService],
})
export class VendorModule {}
