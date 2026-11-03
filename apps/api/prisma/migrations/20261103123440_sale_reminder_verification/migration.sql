-- Sale reminders: a phone is only messaged after its owner proved it.
ALTER TYPE "OtpPurpose" ADD VALUE 'SALE_REMINDER';

ALTER TABLE "campaign_subscriptions" ADD COLUMN     "consentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMPTZ(3);

-- Existing rows: only a phone that equals the subscriber's own verified account
-- phone counts as verified. Guest phones collected before OTP verification stay
-- unverified and receive no WhatsApp reminders.
UPDATE "campaign_subscriptions" s SET "phoneVerifiedAt" = u."phoneVerifiedAt"
FROM "users" u WHERE s."userId" = u.id AND s.phone = u.phone AND u."phoneVerifiedAt" IS NOT NULL;
