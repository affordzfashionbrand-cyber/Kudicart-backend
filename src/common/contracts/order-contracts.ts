/**
 * Canonical Affordz Order Management Contracts (DCR-006..DCR-015)
 * Authoritative source in kudicart-backend; synced to all client repos.
 * Must stay TypeScript 4.8+ compatible (driver-app compatibility).
 */

export type KudiRole = 'CUSTOMER' | 'DRIVER' | 'VENDOR' | 'ADMIN';
export type TransitionActorRole = KudiRole | 'SYSTEM';

export const CANONICAL_ORDER_STATUSES = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RETURNING',
  'RETURNED',
  'CANCELLED',
  'FAILED',
] as const;

export type OrderStatus = (typeof CANONICAL_ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ['RAZORPAY', 'COD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  'PENDING',
  'COMPLETED',
  'FAILED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FULFILLMENT_TYPES = ['DARK_STORE', 'VENDOR'] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const TRY_AND_BUY_STAGES = [
  'HANDOVER_PENDING',
  'TRIAL_IN_PROGRESS',
  'SELECTION_CONFIRMED',
  'RETURN_COLLECTION',
  'PAYMENT_PENDING',
  'RETURNING_TO_STORE',
  'STORE_RECONCILIATION',
] as const;
export type TryAndBuyStage = (typeof TRY_AND_BUY_STAGES)[number];

export type TryAndBuyDecision = 'KEEP' | 'RETURN';
export type ReturnCondition = 'GOOD' | 'DAMAGED' | 'TAG_MISSING';

export const LIVE_TRACKING_ACTIVE_STATUSES: readonly OrderStatus[] = [
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
];

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
  'FAILED',
];

export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PLACED: ['ACCEPTED', 'CANCELLED', 'FAILED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RETURNING'],
  DELIVERED: [],
  RETURNING: ['RETURNED'],
  RETURNED: [],
  CANCELLED: [],
  FAILED: [],
};

// Strictly enforced server-side role matrix (D-006 reaffirmed, DCR-008)
export const ORDER_TRANSITION_ROLES: Record<string, readonly TransitionActorRole[]> = {
  'PLACED->ACCEPTED': ['VENDOR', 'ADMIN'],
  'PLACED->CANCELLED': ['CUSTOMER', 'VENDOR', 'ADMIN'],
  'PLACED->FAILED': ['SYSTEM', 'ADMIN'],
  'ACCEPTED->PREPARING': ['VENDOR', 'ADMIN'],
  'ACCEPTED->CANCELLED': ['CUSTOMER', 'ADMIN'],
  'PREPARING->READY_FOR_PICKUP': ['VENDOR', 'ADMIN'],
  'PREPARING->CANCELLED': ['ADMIN'],
  'READY_FOR_PICKUP->ASSIGNED': ['ADMIN'],
  'READY_FOR_PICKUP->CANCELLED': ['ADMIN'],
  'ASSIGNED->PICKED_UP': ['DRIVER', 'ADMIN'],
  'ASSIGNED->CANCELLED': ['ADMIN'],
  'PICKED_UP->OUT_FOR_DELIVERY': ['DRIVER', 'ADMIN'],
  'OUT_FOR_DELIVERY->DELIVERED': ['DRIVER', 'ADMIN'],
  'OUT_FOR_DELIVERY->RETURNING': ['DRIVER', 'ADMIN'],
  'RETURNING->RETURNED': ['DRIVER', 'ADMIN'],
};

export interface OrderItemContract {
  id: string;
  productId: string;
  title: string;
  brand: string;
  size: string;
  trialSize?: string | null;
  price: number;
  quantity: number;
  image: string;
  tryAndBuyDecision?: TryAndBuyDecision | null;
  returnCondition?: ReturnCondition | null;
  collectedAt?: string | null;
}

export interface TryAndBuySessionContract {
  id: string;
  orderId: string;
  stage: TryAndBuyStage;
  trialDurationMinutes: number;
  handoverConfirmedAt?: string | null;
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
  customerSelectionAt?: string | null;
  finalPayableTotal?: number | null;
  refundAmount?: number | null;
  amountDue?: number | null;
  paymentStatus?: string | null;
  returnManifestId?: string | null;
  keptItemIds: string[];
  returnedItemIds: string[];
  handoverImages?: string[];
  returnImages?: string[];
  storeReconciliationStatus?: string | null;
  storeReconciledAt?: string | null;
}

export interface OrderContract {
  id: string;
  orderNumber: string;
  version: number;
  checkoutGroupId?: string | null;
  customerId: string;
  customerName?: string;
  vendorId?: string | null;
  vendorName?: string;
  driverId?: string | null;
  driverProfileId?: string | null;
  fulfillmentType: FulfillmentType;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  itemTotal: number;
  deliveryFee: number;
  taxes: number;
  giftWrapFee: number;
  donationAmount: number;
  discountAmount: number;
  couponCode?: string | null;
  grandTotal: number;
  etaMinutes: number;
  isTryAndBuy: boolean;
  deliveryAddress?: Record<string, any> | null;
  arrivedAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  rejectedByVendor?: boolean;
  expiresAt?: string | null;
  deliveryInstructions?: string | null;
  verificationPhotos?: string[];
  createdAt: string;
  updatedAt: string;
  items: OrderItemContract[];
  tryAndBuySession?: TryAndBuySessionContract | null;
}

export interface CheckoutRequestContract {
  addressId: string;
  paymentMethod: PaymentMethod;
  couponCode?: string;
  deliveryInstructions?: string;
  isTryAndBuy?: boolean;
  giftWrap?: boolean;
  donationAmount?: number;
  isBuyNow?: boolean;
  buyNowItem?: {
    productId: string;
    size: string;
    trialSize?: string | null;
    quantity: number;
  };
}

export interface CheckoutResponseContract {
  checkoutGroupId: string;
  groupNumber: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  razorpayOrderId?: string | null;
  razorpayKeyId?: string | null;
  checkoutSessionToken?: string | null;
  checkoutSessionUrl?: string | null;
  itemTotal: number;
  discountTotal: number;
  giftWrapFee: number;
  donationAmount: number;
  deliveryFeeTotal: number;
  taxesTotal: number;
  grandTotal: number;
  expiresAt?: string | null;
  orders: OrderContract[];
  // Backwards-compatible primary order shortcut when single order
  primaryOrderId: string;
  orderNumber: string;
}

export interface TryAndBuyCustomerSelectionRequest {
  selections: Record<string, TryAndBuyDecision>;
}

export type TrackingRealtimeEventType =
  | 'CONNECTED'
  | 'SUBSCRIBED'
  | 'PONG'
  | 'DRIVER_LOCATION'
  | 'ORDER_STATUS_UPDATE'
  | 'TRY_AND_BUY_UPDATED'
  | 'ORDER_ARRIVED'
  | 'ERROR';

export interface TrackingRealtimeMessageContract {
  type: TrackingRealtimeEventType;
  seq?: number;
  orderId?: string;
  orderNumber?: string;
  status?: OrderStatus;
  stage?: string;
  items?: OrderItemContract[];
  tryAndBuySession?: TryAndBuySessionContract | null;
  order?: OrderContract;
  latitude?: number;
  longitude?: number;
  heading?: number;
  etaMinutes?: number;
  timestamp: string;
}

