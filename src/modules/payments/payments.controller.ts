import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { ConfirmCodDto } from './dto/confirm-cod.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';

@Controller('api/v1/payments')
@UseGuards(FirebaseAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('razorpay/create-order')
  @HttpCode(HttpStatus.OK)
  async createRazorpayOrder(@Body() body: CreateRazorpayOrderDto) {
    return this.paymentsService.createRazorpayOrder(body.amount, body.orderId);
  }

  @Post('razorpay/verify')
  @HttpCode(HttpStatus.OK)
  async verifySignature(@Body() body: VerifySignatureDto) {
    return this.paymentsService.verifyRazorpaySignature(
      body.orderId,
      body.paymentId,
      body.signature,
    );
  }

  @Post('cod/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmCod(@Body() body: ConfirmCodDto) {
    return this.paymentsService.confirmCod(body.orderId);
  }
}
