import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';

@Controller('api/v1/payments')
@UseGuards(FirebaseAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('razorpay/create-order')
  async createRazorpayOrder(@Body() body: { amount: number }) {
    return this.paymentsService.createRazorpayOrder(body.amount);
  }

  @Post('razorpay/verify')
  async verifySignature(
    @Body() body: { orderId: string; paymentId: string; signature: string },
  ) {
    return this.paymentsService.verifyRazorpaySignature(
      body.orderId,
      body.paymentId,
      body.signature,
    );
  }

  @Post('cod/confirm')
  async confirmCod(@Body() body: { orderId: string }) {
    return this.paymentsService.confirmCod(body.orderId);
  }
}
