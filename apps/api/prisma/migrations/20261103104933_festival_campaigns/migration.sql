-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscountSource" AS ENUM ('CAMPAIGN_PRICE', 'PROMOTION', 'COUPON', 'PREPAID');


-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "autoApply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "combinableWithPromotions" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "campaignId" TEXT;

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "edition" TEXT,
    "festival" TEXT,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "teaserStartsAt" TIMESTAMPTZ(3),
    "earlyAccessStartsAt" TIMESTAMPTZ(3),
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "originalEndsAt" TIMESTAMPTZ(3),
    "budget" DECIMAL(12,2),
    "bannerTitle" TEXT,
    "bannerSubtitle" TEXT,
    "bannerImageUrl" TEXT,
    "themeColor" CHAR(7),
    "publishedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_prices" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "salePrice" DECIMAL(12,2) NOT NULL,
    "stockCap" INTEGER,
    "soldCount" INTEGER NOT NULL DEFAULT 0,
    "perCustomerLimit" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "percentOff" DECIMAL(5,2) NOT NULL,
    "maxDiscount" DECIMAL(12,2),
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_discounts" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "source" "DiscountSource" NOT NULL,
    "sourceId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_subscriptions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notified" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "mrp" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_slug_key" ON "campaigns"("slug");

-- CreateIndex
CREATE INDEX "campaigns_status_startsAt_endsAt_idx" ON "campaigns"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "campaign_prices_variantId_idx" ON "campaign_prices"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_prices_campaignId_variantId_key" ON "campaign_prices"("campaignId", "variantId");

-- CreateIndex
CREATE INDEX "promotions_campaignId_idx" ON "promotions"("campaignId");

-- CreateIndex
CREATE INDEX "order_discounts_orderId_idx" ON "order_discounts"("orderId");

-- CreateIndex
CREATE INDEX "order_discounts_source_sourceId_idx" ON "order_discounts"("source", "sourceId");

-- CreateIndex
CREATE INDEX "campaign_subscriptions_campaignId_idx" ON "campaign_subscriptions"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_subscriptions_campaignId_userId_key" ON "campaign_subscriptions"("campaignId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_subscriptions_campaignId_phone_key" ON "campaign_subscriptions"("campaignId", "phone");

-- CreateIndex
CREATE INDEX "price_history_variantId_effectiveFrom_idx" ON "price_history"("variantId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "campaign_prices" ADD CONSTRAINT "campaign_prices_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_prices" ADD CONSTRAINT "campaign_prices_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_subscriptions" ADD CONSTRAINT "campaign_subscriptions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Campaign integrity rules Prisma can't express.
ALTER TABLE "campaigns" ADD CONSTRAINT "campaign_window_valid" CHECK ("endsAt" > "startsAt"
  AND ("earlyAccessStartsAt" IS NULL OR "earlyAccessStartsAt" < "startsAt")
  AND ("teaserStartsAt" IS NULL OR "teaserStartsAt" < coalesce("earlyAccessStartsAt", "startsAt")));
ALTER TABLE "campaign_prices" ADD CONSTRAINT "campaign_price_nonneg" CHECK ("salePrice" >= 0);
-- A capped deal can never oversell its cap.
ALTER TABLE "campaign_prices" ADD CONSTRAINT "campaign_price_cap" CHECK ("soldCount" >= 0 AND ("stockCap" IS NULL OR "soldCount" <= "stockCap"));
ALTER TABLE "promotions" ADD CONSTRAINT "promotion_valid" CHECK ("minQuantity" >= 1 AND "percentOff" > 0 AND "percentOff" <= 90);
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discount_nonneg" CHECK ("amount" >= 0);
