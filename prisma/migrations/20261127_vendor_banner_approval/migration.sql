-- CreateEnum
CREATE TYPE "BannerApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "HomeBanner" ADD COLUMN     "discountText" TEXT,
ADD COLUMN     "rejectionComment" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "status" "BannerApprovalStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "vendorId" TEXT;

-- CreateIndex
CREATE INDEX "HomeBanner_vendorId_status_idx" ON "HomeBanner"("vendorId", "status");

-- CreateIndex
CREATE INDEX "HomeBanner_status_isActive_displayOrder_idx" ON "HomeBanner"("status", "isActive", "displayOrder");

-- AddForeignKey
ALTER TABLE "HomeBanner" ADD CONSTRAINT "HomeBanner_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
