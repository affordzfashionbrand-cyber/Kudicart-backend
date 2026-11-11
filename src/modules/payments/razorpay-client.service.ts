import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type Razorpay from 'razorpay';

// CommonJS import compatible with NestJS tsconfig (allowSyntheticDefaultImports: true, esModuleInterop: false)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RazorpayCtor = require('razorpay') as typeof import('razorpay');

@Injectable()
export class RazorpayClientService {
  private readonly logger = new Logger(RazorpayClientService.name);
  private client: Razorpay | null = null;

  get keyId(): string {
    return process.env.RAZORPAY_KEY_ID || '';
  }

  get keySecret(): string {
    return process.env.RAZORPAY_KEY_SECRET || '';
  }

  get webhookSecret(): string {
    return process.env.RAZORPAY_WEBHOOK_SECRET || '';
  }

  get isGatewayConfigured(): boolean {
    const key = this.keyId;
    const secret = this.keySecret;
    return (
      Boolean(key && secret) &&
      !key.includes('[YOUR_') &&
      !secret.includes('[YOUR_')
    );
  }

  private getClient(): Razorpay {
    if (!this.isGatewayConfigured) {
      throw new BadRequestException(
        'Razorpay payment gateway credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
      );
    }
    if (!this.client) {
      this.client = new RazorpayCtor({
        key_id: this.keyId,
        key_secret: this.keySecret,
      });
    }
    return this.client;
  }

  async createOrder(params: {
    amountInPaisa: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<{ razorpayOrderId: string }> {
    const useMockTestOrder =
      process.env.NODE_ENV === 'test' &&
      (!this.isGatewayConfigured || process.env.RAZORPAY_LIVE_IN_TEST !== 'true');

    if (useMockTestOrder) {
      return {
        razorpayOrderId: `rzp_order_test_${Date.now()}_${crypto.randomInt(1000, 9999)}`,
      };
    }

    try {
      const rzp = this.getClient();
      const order: any = await rzp.orders.create({
        amount: params.amountInPaisa,
        currency: 'INR',
        receipt: params.receipt.slice(0, 40),
        notes: params.notes || {},
      });
      if (!order?.id) {
        throw new Error('Razorpay API did not return an order ID');
      }
      return { razorpayOrderId: order.id };
    } catch (err: any) {
      const msg = err?.error?.description || err?.message || 'Razorpay order creation failed';
      this.logger.error(`Razorpay createOrder failed: ${msg}`);
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(msg);
    }
  }

  verifyPaymentSignature(params: {
    razorpayOrderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const secret = this.keySecret;
    if (!secret) {
      if (process.env.NODE_ENV === 'test') {
        const expected = crypto
          .createHmac('sha256', 'test_secret')
          .update(`${params.razorpayOrderId}|${params.paymentId}`)
          .digest('hex');
        return this.timingSafeEqualHexOrUtf8(params.signature, expected);
      }
      throw new BadRequestException('Razorpay key secret not configured for signature verification.');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${params.razorpayOrderId}|${params.paymentId}`)
      .digest('hex');

    return this.timingSafeEqualHexOrUtf8(params.signature, expected);
  }

  verifyWebhookSignatureOrThrow(rawBody: Buffer | string, signature?: string): void {
    const secret = this.webhookSecret;
    if (!secret) {
      throw new UnauthorizedException(
        'Razorpay webhook secret (RAZORPAY_WEBHOOK_SECRET) is not configured. Failing closed.',
      );
    }
    if (!signature) {
      throw new UnauthorizedException('Missing x-razorpay-signature header');
    }

    const payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '', 'utf8');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payloadBuffer)
      .digest('hex');

    if (!this.timingSafeEqualHexOrUtf8(signature, expected)) {
      throw new UnauthorizedException('Invalid Razorpay webhook signature');
    }
  }

  async fetchOrderPayments(razorpayOrderId: string): Promise<any[]> {
    if (process.env.NODE_ENV === 'test' && process.env.RAZORPAY_LIVE_IN_TEST !== 'true') {
      return [];
    }
    const rzp = this.getClient();
    const res: any = await rzp.orders.fetchPayments(razorpayOrderId);
    return Array.isArray(res?.items) ? res.items : [];
  }

  async refundPayment(params: {
    paymentId: string;
    amountInPaisa: number;
    notes?: Record<string, string>;
  }): Promise<{ refundId: string; status: string }> {
    const useMockTestRefund =
      process.env.NODE_ENV === 'test' &&
      (!this.isGatewayConfigured || process.env.RAZORPAY_LIVE_IN_TEST !== 'true');

    if (useMockTestRefund) {
      return {
        refundId: `rfnd_test_${Date.now()}_${crypto.randomInt(1000, 9999)}`,
        status: 'processed',
      };
    }

    const rzp = this.getClient();
    const refund: any = await (rzp.payments as any).refund(params.paymentId, {
      amount: params.amountInPaisa,
      speed: 'normal',
      notes: params.notes || {},
    });
    if (!refund?.id) {
      throw new BadRequestException('Razorpay refund did not return a refund ID');
    }
    return {
      refundId: refund.id,
      status: refund.status || 'processed',
    };
  }

  private timingSafeEqualHexOrUtf8(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a.trim(), 'utf8');
    const bufB = Buffer.from(b.trim(), 'utf8');
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
