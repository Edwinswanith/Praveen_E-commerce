-- CreateEnum
CREATE TYPE "NewsletterStatus" AS ENUM ('PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED');

-- AlterTable
ALTER TABLE "newsletter_subscribers" ADD COLUMN     "confirmedAt" TIMESTAMPTZ(3),
ADD COLUMN     "consentAt" TIMESTAMPTZ(3),
ADD COLUMN     "source" TEXT,
ADD COLUMN     "status" "NewsletterStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "unsubscribedAt" TIMESTAMPTZ(3),
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "moderatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "moderatedById" TEXT,
ADD COLUMN     "moderationNote" TEXT;

-- CreateIndex
CREATE INDEX "newsletter_subscribers_status_idx" ON "newsletter_subscribers"("status");

-- Existing sign-ups were single opt-in (never confirmed), so they stay PENDING
-- and receive nothing until the owner confirms via a double opt-in email.
UPDATE "newsletter_subscribers" SET "consentAt" = "createdAt", "source" = 'legacy' WHERE "consentAt" IS NULL;
