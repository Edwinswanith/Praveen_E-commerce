-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'COD_CONFIRM');

-- CreateEnum
CREATE TYPE "CodConfirmation" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('RETURN', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "FitFeedback" AS ENUM ('RUNS_SMALL', 'TRUE_TO_SIZE', 'RUNS_LARGE');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'RTO';


-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "reminderSentAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "codConfirmation" "CodConfirmation" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "codConfirmedAt" TIMESTAMPTZ(3),
ADD COLUMN     "exchangeForOrderId" TEXT,
ADD COLUMN     "prepaidDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rtoAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "return_items" ADD COLUMN     "exchangeVariantId" TEXT;

-- AlterTable
ALTER TABLE "return_requests" ADD COLUMN     "replacementOrderId" TEXT,
ADD COLUMN     "type" "ReturnType" NOT NULL DEFAULT 'RETURN';

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "fit" "FitFeedback",
ADD COLUMN     "sizePurchased" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phoneVerifiedAt" TIMESTAMPTZ(3),
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "orderId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_risk" (
    "phone" TEXT NOT NULL,
    "rtoCount" INTEGER NOT NULL DEFAULT 0,
    "codBlocked" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "lastRtoAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cod_risk_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "cod_blocked_pincodes" (
    "pincode" CHAR(6) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cod_blocked_pincodes_pkey" PRIMARY KEY ("pincode")
);

-- CreateTable
CREATE TABLE "review_images" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_codes_phone_purpose_createdAt_idx" ON "otp_codes"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "review_images_reviewId_idx" ON "review_images"("reviewId");

-- AddForeignKey
ALTER TABLE "review_images" ADD CONSTRAINT "review_images_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
