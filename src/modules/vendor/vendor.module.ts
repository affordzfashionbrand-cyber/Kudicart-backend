import { Module } from '@nestjs/common';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { OrdersService } from '../orders/orders.service';
import { OrdersDomainModule } from '../orders/orders-domain.module';
import { CartService } from '../cart/cart.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

@Module({
  imports: [OrdersDomainModule],
  controllers: [VendorController],
  providers: [
    VendorService,
    OrdersService,
    CartService,
    FirebaseAdminService,
  ],
  exports: [VendorService],
})
export class VendorModule {}
