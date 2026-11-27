-- Phase 4: Per-account coupon usage limits & GST invoice metadata
ALTER TABLE "Coupon"
  ADD COLUMN IF NOT EXISTS "perUserLimit" INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS "CouponUsage" (
  "id" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "checkoutGroupId" TEXT,
  "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CouponUsage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CouponUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CouponUsage_couponId_userId_idx" ON "CouponUsage"("couponId", "userId");
CREATE INDEX IF NOT EXISTS "CouponUsage_checkoutGroupId_idx" ON "CouponUsage"("checkoutGroupId");

ALTER TABLE "CheckoutGroup"
  ADD COLUMN IF NOT EXISTS "needGstInvoice" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "customerGstin" TEXT,
  ADD COLUMN IF NOT EXISTS "gstBusinessName" TEXT;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "needGstInvoice" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "customerGstin" TEXT,
  ADD COLUMN IF NOT EXISTS "gstBusinessName" TEXT;
