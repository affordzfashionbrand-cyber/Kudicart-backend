-- Migration: 20261111_order_management_production
-- Description: Canonical order lifecycle states, CheckoutGroup split orders, CAS versioning, IdempotencyKey, WebhookEvent, Notification, TryAndBuySession audit & Vendor commissionRate

-- 1. Expand OrderStatus and PaymentStatus enums
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_PENDING';

-- 2. Add commissionRate to Vendor
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 12.5;

-- 3. Create CheckoutGroup table
CREATE TABLE IF NOT EXISTS "CheckoutGroup" (
    "id" TEXT NOT NULL,
    "groupNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "addressId" TEXT,
    "deliveryAddress" JSONB,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "couponCode" TEXT,
    "itemTotal" DOUBLE PRECISION NOT NULL,
    "discountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "giftWrapFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "donationAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveryFeeTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxesTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutGroup_groupNumber_key" ON "CheckoutGroup"("groupNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutGroup_razorpayOrderId_key" ON "CheckoutGroup"("razorpayOrderId");
CREATE INDEX IF NOT EXISTS "CheckoutGroup_customerId_idx" ON "CheckoutGroup"("customerId");
CREATE INDEX IF NOT EXISTS "CheckoutGroup_paymentStatus_expiresAt_idx" ON "CheckoutGroup"("paymentStatus", "expiresAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CheckoutGroup_customerId_fkey') THEN
        ALTER TABLE "CheckoutGroup" ADD CONSTRAINT "CheckoutGroup_customerId_fkey"
            FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Upgrade Order table
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "checkoutGroupId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'DARK_STORE';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "giftWrapFee" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "donationAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryOtpHash" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "arrivedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "rejectedByVendor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_checkoutGroupId_idx" ON "Order"("checkoutGroupId");
CREATE INDEX IF NOT EXISTS "Order_paymentStatus_expiresAt_idx" ON "Order"("paymentStatus", "expiresAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_checkoutGroupId_fkey') THEN
        ALTER TABLE "Order" ADD CONSTRAINT "Order_checkoutGroupId_fkey"
            FOREIGN KEY ("checkoutGroupId") REFERENCES "CheckoutGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 5. Upgrade OrderItem & OrderStatusHistory
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "tryAndBuyDecision" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "returnCondition" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "collectedAt" TIMESTAMP(3);

ALTER TABLE "OrderStatusHistory" ADD COLUMN IF NOT EXISTS "actorId" TEXT;
ALTER TABLE "OrderStatusHistory" ADD COLUMN IF NOT EXISTS "actorRole" TEXT;

-- 6. Upgrade TryAndBuySession
ALTER TABLE "TryAndBuySession" ALTER COLUMN "driverId" DROP NOT NULL;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TryAndBuySession_orderId_fkey') THEN
        ALTER TABLE "TryAndBuySession" DROP CONSTRAINT "TryAndBuySession_orderId_fkey";
    END IF;
    ALTER TABLE "TryAndBuySession" ADD CONSTRAINT "TryAndBuySession_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END $$;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'DriverProfile_fifo_idx') THEN
        ALTER INDEX "DriverProfile_fifo_idx" RENAME TO "DriverProfile_isOnline_kycStatus_availableSince_idx";
    END IF;
END $$;
ALTER TABLE "TryAndBuySession" ADD COLUMN IF NOT EXISTS "handoverImages" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "TryAndBuySession" ADD COLUMN IF NOT EXISTS "returnImages" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "TryAndBuySession" ADD COLUMN IF NOT EXISTS "customerSelectionAt" TIMESTAMP(3);

-- 7. Upgrade PaymentTransaction for split orders & refunds
ALTER TABLE "PaymentTransaction" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "checkoutGroupId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "refundId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "transactionType" TEXT NOT NULL DEFAULT 'CAPTURE';

DROP INDEX IF EXISTS "PaymentTransaction_paymentId_key";
CREATE INDEX IF NOT EXISTS "PaymentTransaction_paymentId_idx" ON "PaymentTransaction"("paymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_refundId_key" ON "PaymentTransaction"("refundId");
CREATE INDEX IF NOT EXISTS "PaymentTransaction_checkoutGroupId_idx" ON "PaymentTransaction"("checkoutGroupId");
CREATE INDEX IF NOT EXISTS "PaymentTransaction_orderId_idx" ON "PaymentTransaction"("orderId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentTransaction_checkoutGroupId_fkey') THEN
        ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_checkoutGroupId_fkey"
            FOREIGN KEY ("checkoutGroupId") REFERENCES "CheckoutGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 8. Create IdempotencyKey table
CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyKey_userId_scope_key_key" ON "IdempotencyKey"("userId", "scope", "key");
CREATE INDEX IF NOT EXISTS "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IdempotencyKey_userId_fkey') THEN
        ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 9. Create WebhookEvent table
CREATE TABLE IF NOT EXISTS "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "orderId" TEXT,
    "checkoutGroupId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

-- 10. Create Notification table
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "role" "Role",
    "orderId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'ORDER',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_role_createdAt_idx" ON "Notification"("role", "createdAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_userId_fkey') THEN
        ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
