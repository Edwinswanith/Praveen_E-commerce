
-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiPrompt" TEXT;
