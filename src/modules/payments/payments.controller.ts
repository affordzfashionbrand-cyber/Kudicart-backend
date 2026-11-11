import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { PaymentsService } from './payments.service';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { ConfirmCodDto } from './dto/confirm-cod.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('api/v1/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('razorpay/create-order')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  async createRazorpayOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateRazorpayOrderDto,
  ) {
    return this.paymentsService.createRazorpayOrder(
      body.amount,
      body.orderId,
      user.id,
      user.role,
    );
  }

  @Post('razorpay/verify')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async verifySignature(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VerifySignatureDto,
  ) {
    return this.paymentsService.verifyRazorpaySignature(
      body.orderId,
      body.paymentId,
      body.signature,
      body.razorpayOrderId,
      user.id,
      user.role,
    );
  }

  @Get('razorpay/checkout-session/:orderId')
  async getCheckoutSession(
    @Param('orderId') orderId: string,
    @Res() res: Response,
    @Query('st') sessionToken?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const actor = await this.paymentsService.authenticateCheckoutSessionAccess(
      orderId,
      sessionToken,
      authHeader,
    );
    const html = await this.paymentsService.generateCheckoutHtml(
      orderId,
      actor.actorId,
      actor.actorRole,
    );
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }

  @Get('status/:orderId')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.VENDOR, Role.DRIVER, Role.ADMIN)
  async getPaymentStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
  ) {
    return this.paymentsService.getPaymentStatus(orderId, user.id, user.role);
  }

  @Post('cod/confirm')
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(Role.DRIVER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async confirmCod(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmCodDto,
  ) {
    return this.paymentsService.confirmCod(body.orderId, user.id, user.role);
  }
}
