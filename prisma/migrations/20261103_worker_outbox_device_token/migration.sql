-- Migration: 20261103_worker_outbox_device_token
-- Description: Add availableSince to DriverProfile, create DeviceToken table for FCM, and OutboxEvent for transactional reliability

-- 1. Add availableSince to DriverProfile for deterministic FIFO ordering
ALTER TABLE "DriverProfile" ADD COLUMN IF NOT EXISTS "availableSince" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "DriverProfile_fifo_idx" ON "DriverProfile"("isOnline", "kycStatus", "availableSince");

-- 2. Create DeviceToken table for multi-device authenticated FCM registrations
CREATE TABLE IF NOT EXISTS "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DeviceToken_token_key" ON "DeviceToken"("token");
CREATE INDEX IF NOT EXISTS "DeviceToken_userId_role_idx" ON "DeviceToken"("userId", "role");
CREATE INDEX IF NOT EXISTS "DeviceToken_token_idx" ON "DeviceToken"("token");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DeviceToken_userId_fkey'
    ) THEN
        ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. Create OutboxStatus enum and OutboxEvent table for reliable transactional outbox
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OutboxStatus') THEN
        CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OutboxEvent" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");

