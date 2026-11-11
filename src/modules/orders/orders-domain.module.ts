import { Global, Module } from '@nestjs/common';
import { StateMachineService } from './state-machine.service';
import { OrderTransitionService } from './order-transition.service';
import { RazorpayClientService } from '../payments/razorpay-client.service';
import { PaymentReconciliationService } from '../payments/payment-reconciliation.service';

@Global()
@Module({
  providers: [
    StateMachineService,
    RazorpayClientService,
    OrderTransitionService,
    PaymentReconciliationService,
  ],
  exports: [
    StateMachineService,
    RazorpayClientService,
    OrderTransitionService,
    PaymentReconciliationService,
  ],
})
export class OrdersDomainModule {}
