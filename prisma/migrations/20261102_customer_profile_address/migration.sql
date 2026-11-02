-- Migration: 20261102_customer_profile_address
-- Description: Add UserStatus, Address recipient and postal fields, and Order deliveryAddress snapshot

-- 1. Create UserStatus enum if not exists
DO $$ BEGIN
    CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Alter User table to add status
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- 3. Alter Address table to add recipient and postal fields
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS "recipientName" TEXT;
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS "recipientPhone" TEXT;
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS "line2" TEXT;
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS "pincode" TEXT NOT NULL DEFAULT '560038';

-- 4. Alter Order table to allow addressId to be nullable with SET NULL on delete, and store deliveryAddress snapshot
ALTER TABLE "Order" ALTER COLUMN "addressId" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryAddress" JSONB;
