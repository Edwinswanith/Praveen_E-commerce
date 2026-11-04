-- AI images record the real photo they were generated from (CLAUDE.md rule 15).
ALTER TABLE "product_images" ADD COLUMN "sourceImageId" TEXT;

ALTER TABLE "product_images" ADD CONSTRAINT "product_images_sourceImageId_fkey" FOREIGN KEY ("sourceImageId") REFERENCES "product_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;
