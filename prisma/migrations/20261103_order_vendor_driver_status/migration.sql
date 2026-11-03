-- Migration: 20261103_order_vendor_driver_status
-- Description: Expand OrderStatus enum, add vendor/driverProfile relations to Order and TryAndBuySession, and create DispatchAssignment

-- 1. Expand OrderStatus enum
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURNING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURNED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- 2. Alter Order table to add vendorId and driverProfileId
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "vendorId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "driverProfileId" TEXT;

-- 3. Add Foreign Keys to Order if they don't exist
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Order_vendorId_fkey'
    ) THEN
        ALTER TABLE "Order" ADD CONSTRAINT "Order_vendorId_fkey"
            FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Order_driverProfileId_fkey'
    ) THEN
        ALTER TABLE "Order" ADD CONSTRAINT "Order_driverProfileId_fkey"
            FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Order Indexes
CREATE INDEX IF NOT EXISTS "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX IF NOT EXISTS "Order_vendorId_idx" ON "Order"("vendorId");
CREATE INDEX IF NOT EXISTS "Order_driverId_idx" ON "Order"("driverId");
CREATE INDEX IF NOT EXISTS "Order_driverProfileId_idx" ON "Order"("driverProfileId");
CREATE INDEX IF NOT EXISTS "Order_status_idx" ON "Order"("status");
CREATE INDEX IF NOT EXISTS "Order_createdAt_idx" ON "Order"("createdAt");

-- 5. TryAndBuySession updates
ALTER TABLE "TryAndBuySession" ADD COLUMN IF NOT EXISTS "driverProfileId" TEXT;
ALTER TABLE "TryAndBuySession" ALTER COLUMN "trialDurationMinutes" SET DEFAULT 10;
ALTER TABLE "TryAndBuySession" ADD COLUMN IF NOT EXISTS "keptItemIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "TryAndBuySession" ADD COLUMN IF NOT EXISTS "returnedItemIds" TEXT[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TryAndBuySession_driverProfileId_fkey'
    ) THEN
        ALTER TABLE "TryAndBuySession" ADD CONSTRAINT "TryAndBuySession_driverProfileId_fkey"
            FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TryAndBuySession_driverProfileId_idx" ON "TryAndBuySession"("driverProfileId");
CREATE INDEX IF NOT EXISTS "TryAndBuySession_stage_idx" ON "TryAndBuySession"("stage");

-- 6. Create DispatchAssignment table
CREATE TABLE IF NOT EXISTS "DispatchAssignment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "driverProfileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "offeredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DispatchAssignment_orderId_key" ON "DispatchAssignment"("orderId");
CREATE INDEX IF NOT EXISTS "DispatchAssignment_status_idx" ON "DispatchAssignment"("status");
CREATE INDEX IF NOT EXISTS "DispatchAssignment_driverProfileId_idx" ON "DispatchAssignment"("driverProfileId");
CREATE INDEX IF NOT EXISTS "DispatchAssignment_createdAt_idx" ON "DispatchAssignment"("createdAt");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DispatchAssignment_orderId_fkey'
    ) THEN
        ALTER TABLE "DispatchAssignment" ADD CONSTRAINT "DispatchAssignment_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DispatchAssignment_driverProfileId_fkey'
    ) THEN
        ALTER TABLE "DispatchAssignment" ADD CONSTRAINT "DispatchAssignment_driverProfileId_fkey"
            FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

