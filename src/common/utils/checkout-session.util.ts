import { UnauthorizedException } from '@nestjs/common';
import { createJwtToken, verifyJwtToken } from './crypto.util';

export interface CheckoutSessionTokenPayload {
  purpose: 'razorpay_checkout';
  orderId: string;
  sub: string;
}

export function createCheckoutSessionToken(
  orderOrGroupId: string,
  customerId: string,
  expiresInSeconds: number = 900,
): string {
  return createJwtToken(
    {
      purpose: 'razorpay_checkout',
      orderId: orderOrGroupId,
      sub: customerId,
    },
    undefined,
    expiresInSeconds,
  );
}

export function verifyCheckoutSessionToken(
  token: string,
  expectedOrderOrGroupId?: string,
): CheckoutSessionTokenPayload {
  const result = verifyJwtToken(token);
  if (!result.valid || !result.payload) {
    throw new UnauthorizedException(
      result.error === 'Token has expired'
        ? 'Checkout session token has expired'
        : 'Invalid checkout session token',
    );
  }

  const payload = result.payload;
  if (
    payload.purpose !== 'razorpay_checkout' ||
    !payload.orderId ||
    !payload.sub
  ) {
    throw new UnauthorizedException('Malformed checkout session token');
  }

  if (expectedOrderOrGroupId && payload.orderId !== expectedOrderOrGroupId) {
    throw new UnauthorizedException('Checkout session token does not match requested order');
  }

  return {
    purpose: 'razorpay_checkout',
    orderId: String(payload.orderId),
    sub: String(payload.sub),
  };
}
