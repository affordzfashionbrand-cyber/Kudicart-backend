import * as crypto from 'crypto';

const KNOWN_INSECURE_SECRETS = new Set([
  'affordz_dev_testing_only_jwt_secret_not_for_production',
  'kudicart-super-secret-jwt-key',
  'secret',
  'jwt_secret',
  'changeme',
  '1234567890',
  'test',
  'development',
]);

/**
 * Validate and resolve the JWT signing secret.
 * Enforces strict length (min 32 bytes/characters) and high entropy in production.
 * Fails closed if missing, weak, or using an insecure fallback.
 */
export function validateJwtSecret(explicitSecret?: string): string {
  const isProduction =
    process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
  const secret = explicitSecret || process.env.JWT_SECRET;

  if (isProduction) {
    if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
      throw new Error(
        'FATAL: JWT_SECRET environment variable is strictly required in production mode',
      );
    }
    if (secret.length < 32) {
      throw new Error(
        'FATAL: JWT_SECRET must be at least 32 characters in length in production mode for secure HMAC-SHA256 signing',
      );
    }
    if (KNOWN_INSECURE_SECRETS.has(secret.toLowerCase())) {
      throw new Error(
        'FATAL: Insecure or default JWT_SECRET detected in production mode. Set a cryptographically secure random secret.',
      );
    }
    return secret;
  }

  // Non-production environment (development / test)
  if (secret && typeof secret === 'string' && secret.trim().length > 0) {
    return secret;
  }

  // Isolated development / test secret (strictly blocked in production)
  return 'affordz_dev_testing_only_jwt_secret_not_for_production';
}

/**
 * Resolve JWT signing secret from environment with production fail-closed validation.
 */
export function getJwtSecret(): string {
  return validateJwtSecret();
}

/**
 * Hash a plain-text password using PBKDF2 with 100,000 iterations and a random salt
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
    .toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a plain-text password against a stored PBKDF2 salt:hash string
 */
export function verifyPassword(password: string, combinedHash: string): boolean {
  if (!combinedHash || !combinedHash.includes(':')) {
    return false;
  }
  const [salt, originalHash] = combinedHash.split(':');
  const verifyHash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
    .toString('hex');
  return crypto.timingSafeEqual(
    Buffer.from(originalHash, 'hex'),
    Buffer.from(verifyHash, 'hex'),
  );
}

/**
 * Generate a standard 3-part HMAC-SHA256 JWT string with cryptographic signature
 */
export function createJwtToken(
  payload: Record<string, any>,
  secret?: string,
  expiresInSeconds: number = 86400, // 24 hours
): string {
  const signingSecret = secret || getJwtSecret();
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', signingSecret)
    .update(signatureInput)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode an HMAC-SHA256 JWT string with timing-safe signature comparison
 */
export function verifyJwtToken(
  token: string,
  secret?: string,
): { valid: boolean; payload?: any; error?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token missing or invalid' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token structure' };
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  if (!signature) {
    return { valid: false, error: 'Token signature missing' };
  }

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const verificationSecret = secret || getJwtSecret();

  try {
    // Enforce JWT header algorithm restriction to prevent algorithm confusion attacks
    const headerJson = Buffer.from(encodedHeader, 'base64url').toString('utf-8');
    const header = JSON.parse(headerJson);
    if (!header || header.alg !== 'HS256') {
      return { valid: false, error: 'Unsupported or prohibited JWT algorithm' };
    }

    const expectedSignature = crypto
      .createHmac('sha256', verificationSecret)
      .update(signatureInput)
      .digest('base64url');

    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(expectedSignature);

    // Cryptographic timing-safe signature verification to prevent timing attacks
    if (
      sigBuffer.length !== expBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expBuffer)
    ) {
      return { valid: false, error: 'Invalid token signature' };
    }

    // Decode payload
    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson);

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now >= payload.exp) {
      return { valid: false, error: 'Token has expired' };
    }

    // Check not before if present
    if (payload.nbf && now < payload.nbf) {
      return { valid: false, error: 'Token is not yet valid' };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Signature verification failed' };
  }
}
