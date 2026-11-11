export const AFFORDZ_NOTIFICATIONS_QUEUE = 'affordz-notifications';
export const AFFORDZ_PAYMENTS_QUEUE = 'affordz-payments';

export enum QueueJobType {
  ORDER_STATUS_NOTIFICATION = 'ORDER_STATUS_NOTIFICATION',
  CUSTOMER_ORDER_PLACED = 'CUSTOMER_ORDER_PLACED',
  CUSTOMER_ORDER_DELIVERED = 'CUSTOMER_ORDER_DELIVERED',
  DRIVER_ASSIGNMENT_NOTIFICATION = 'DRIVER_ASSIGNMENT_NOTIFICATION',
  ASSIGNMENT_CANCELLATION_NOTIFICATION = 'ASSIGNMENT_CANCELLATION_NOTIFICATION',
  VENDOR_ORDER_NOTIFICATION = 'VENDOR_ORDER_NOTIFICATION',
  VENDOR_ORDER_CANCELLED = 'VENDOR_ORDER_CANCELLED',
  PAYMENT_CAPTURED_NOTIFICATION = 'PAYMENT_CAPTURED_NOTIFICATION',
  TRY_AND_BUY_HANDOVER = 'TRY_AND_BUY_HANDOVER',
  TRY_AND_BUY_DECISION = 'TRY_AND_BUY_DECISION',
  TRY_AND_BUY_EXPIRY_CHECK = 'TRY_AND_BUY_EXPIRY_CHECK',
  TRY_AND_BUY_SELECTION_NOTIFICATION = 'TRY_AND_BUY_SELECTION_NOTIFICATION',
  PAYMENT_RECONCILIATION_CHECK = 'PAYMENT_RECONCILIATION_CHECK',
  ORDER_EXPIRY_CHECK = 'ORDER_EXPIRY_CHECK',
  REFUND_PROCESSING = 'REFUND_PROCESSING',
}

export interface RedisConnectionConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  maxRetriesPerRequest: null;
}

export function getRedisConnectionOptions(): RedisConnectionConfig | null {
  if (process.env.REDIS_HOST) {
    return {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT || 6379),
      ...(process.env.REDIS_PASSWORD
        ? { password: process.env.REDIS_PASSWORD }
        : {}),
      maxRetriesPerRequest: null,
    };
  }

  if (process.env.REDIS_URL) {
    try {
      const parsed = new URL(process.env.REDIS_URL);
      return {
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
        ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
        ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
        maxRetriesPerRequest: null,
      };
    } catch {
      return null;
    }
  }

  return null;
}
