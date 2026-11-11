import * as crypto from 'crypto';

function getOtpSecret(): string {
  const secret = process.env.ORDER_OTP_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: ORDER_OTP_SECRET or JWT_SECRET is required in production mode');
    }
    return 'affordz-order-otp-dev-secret-change-in-prod';
  }
  return secret;
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
