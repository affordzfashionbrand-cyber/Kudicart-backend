import * as crypto from 'crypto';

function getOtpSecret(): string {
  const isProduction =
    process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
  const secret = process.env.ORDER_OTP_SECRET || process.env.JWT_SECRET;

  if (isProduction) {
    if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
      throw new Error(
        'FATAL: ORDER_OTP_SECRET or JWT_SECRET environment variable is strictly required in production mode',
      );
    }
    if (secret.length < 32) {
      throw new Error(
        'FATAL: ORDER_OTP_SECRET or JWT_SECRET must be at least 32 characters in length in production mode',
      );
    }
    return secret;
  }

  // Non-production isolated secret
  return secret || 'affordz_dev_testing_only_order_otp_secret_not_for_production';
}

/**
 * Generates a per-order 4-digit OTP derived via HMAC-SHA256 so no plaintext OTP
 * ever needs to be stored in PostgreSQL, while still remaining deterministically
 * retrievable strictly for the owning customer's authenticated order responses.
 */
export function deriveCustomerOrderOtp(orderId: string): string {
  const hmac = crypto
    .createHmac('sha256', getOtpSecret())
    .update(`affordz-otp-v1:${orderId}`)
    .digest();
  const numeric = ((hmac[0] << 24) | (hmac[1] << 16) | (hmac[2] << 8) | hmac[3]) >>> 0;
  const code = 1000 + (numeric % 9000);
  return String(code);
}

export function hashOrderOtp(orderId: string, otp: string): string {
  return crypto
    .createHmac('sha256', `${getOtpSecret()}:hash`)
    .update(`${orderId}:${otp.trim()}`)
    .digest('hex');
}

export function verifyOrderOtpHash(
  orderId: string,
  submittedOtp: string,
  storedHash?: string | null,
): boolean {
  if (!storedHash || !submittedOtp) return false;
  const candidateHash = hashOrderOtp(orderId, submittedOtp);
  const a = Buffer.from(candidateHash, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
