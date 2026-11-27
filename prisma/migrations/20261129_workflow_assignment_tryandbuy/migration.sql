-- Additive non-destructive migration for independent OrderProcessingStatus & DeliveryAssignmentStatus
-- Plus Try & Buy order-level workflow state & explicit OrderType identifier

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PACKING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'TRY_AND_BUY';

DO $$ BEGIN
  CREATE TYPE "OrderType" AS ENUM ('STANDARD', 'TRY_AND_BUY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "DeliveryAssignmentStatus" AS ENUM (
    'NOT_ASSIGNED',
    'ASSIGNMENT_PENDING',
    'ASSIGNED',
    'ACCEPTED_BY_DELIVERY_PARTNER',
    'REJECTED_BY_DELIVERY_PARTNER',
    'REASSIGNMENT_PENDING',
    'COMPLETED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "orderType" "OrderType" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS "deliveryAssignmentStatus" "DeliveryAssignmentStatus" NOT NULL DEFAULT 'NOT_ASSIGNED',
  ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "packingStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "readyForPickupAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pickedUpAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pickedUpByDriverId" TEXT,
  ADD COLUMN IF NOT EXISTS "tryAndBuyStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "returnReason" TEXT,
  ADD COLUMN IF NOT EXISTS "assignmentFailureReason" TEXT;

ALTER TABLE "DispatchAssignment"
  ADD COLUMN IF NOT EXISTS "assignmentStatus" "DeliveryAssignmentStatus" NOT NULL DEFAULT 'NOT_ASSIGNED',
  ADD COLUMN IF NOT EXISTS "assignmentSource" TEXT NOT NULL DEFAULT 'AUTO',
  ADD COLUMN IF NOT EXISTS "assignedByActorId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedByRole" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedDriverIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS "Order_deliveryAssignmentStatus_idx" ON "Order"("deliveryAssignmentStatus");
CREATE INDEX IF NOT EXISTS "Order_orderType_idx" ON "Order"("orderType");
CREATE INDEX IF NOT EXISTS "DispatchAssignment_assignmentStatus_idx" ON "DispatchAssignment"("assignmentStatus");

-- Backfill orderType from existing isTryAndBuy flag
UPDATE "Order"
SET "orderType" = CASE
  WHEN "isTryAndBuy" = true THEN 'TRY_AND_BUY'::"OrderType"
  ELSE 'STANDARD'::"OrderType"
END;

-- Backfill deliveryAssignmentStatus from existing Order state & driver links
UPDATE "Order"
SET "deliveryAssignmentStatus" = CASE
  WHEN "status"::text IN ('DELIVERED', 'RETURNED') THEN 'COMPLETED'::"DeliveryAssignmentStatus"
  WHEN "status"::text IN ('PICKED_UP', 'OUT_FOR_DELIVERY', 'RETURNING') THEN 'ACCEPTED_BY_DELIVERY_PARTNER'::"DeliveryAssignmentStatus"
  WHEN "status"::text = 'ASSIGNED' OR ("driverProfileId" IS NOT NULL OR "driverId" IS NOT NULL) THEN 'ASSIGNED'::"DeliveryAssignmentStatus"
  WHEN "status"::text IN ('ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP') THEN 'ASSIGNMENT_PENDING'::"DeliveryAssignmentStatus"
  WHEN "status"::text IN ('CANCELLED', 'FAILED') AND ("driverProfileId" IS NOT NULL OR "driverId" IS NOT NULL) THEN 'FAILED'::"DeliveryAssignmentStatus"
  ELSE 'NOT_ASSIGNED'::"DeliveryAssignmentStatus"
END;

-- Normalize legacy ASSIGNED order processing status back to READY_FOR_PICKUP so processing & assignment dimensions remain independent
UPDATE "Order"
SET "status" = 'READY_FOR_PICKUP'::"OrderStatus"
WHERE "status"::text = 'ASSIGNED';

-- Backfill DispatchAssignment rows for any active/historical orders that already had a driver assigned
INSERT INTO "DispatchAssignment" (
  "id",
  "orderId",
  "driverProfileId",
  "status",
  "assignmentStatus",
  "assignmentSource",
  "offeredAt",
  "respondedAt",
  "completedAt",
  "attempts",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  o."id",
  o."driverProfileId",
  CASE
    WHEN o."deliveryAssignmentStatus"::text = 'COMPLETED' THEN 'COMPLETED'
    WHEN o."deliveryAssignmentStatus"::text = 'ACCEPTED_BY_DELIVERY_PARTNER' THEN 'ACCEPTED'
    WHEN o."deliveryAssignmentStatus"::text = 'ASSIGNED' THEN 'ASSIGNED'
    ELSE 'PENDING'
  END,
  o."deliveryAssignmentStatus",
  'LEGACY_BACKFILL',
  o."updatedAt",
  CASE WHEN o."deliveryAssignmentStatus"::text IN ('ACCEPTED_BY_DELIVERY_PARTNER', 'COMPLETED') THEN o."updatedAt" ELSE NULL END,
  CASE WHEN o."deliveryAssignmentStatus"::text = 'COMPLETED' THEN COALESCE(o."deliveredAt", o."updatedAt") ELSE NULL END,
  1,
  o."createdAt",
  NOW()
FROM "Order" o
WHERE (o."driverProfileId" IS NOT NULL OR o."deliveryAssignmentStatus"::text <> 'NOT_ASSIGNED')
  AND NOT EXISTS (
    SELECT 1 FROM "DispatchAssignment" da WHERE da."orderId" = o."id"
  );
