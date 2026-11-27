-- Additive, non-destructive columns for Driver Audit modules (approval acknowledgment, assigned hub link, support ticket attachments, per-driver shift history)
ALTER TABLE "SupportTicket"
  ADD COLUMN IF NOT EXISTS "attachments" JSONB;

ALTER TABLE "DriverProfile"
  ADD COLUMN IF NOT EXISTS "approvalAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assignedHubId" TEXT;

ALTER TABLE "DriverShift"
  ADD COLUMN IF NOT EXISTS "driverId" TEXT,
  ADD COLUMN IF NOT EXISTS "shiftDate" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "DriverShift_driverId_idx" ON "DriverShift"("driverId");
