-- AlterEnum
ALTER TYPE "homepage_section_type" ADD VALUE 'MARQUEE';

-- DropForeignKey
ALTER TABLE "customization_configs" DROP CONSTRAINT "customization_configs_design_surface_image_id_fkey";

-- DropForeignKey
ALTER TABLE "product_models_3d" DROP CONSTRAINT "product_models_3d_product_id_fkey";

-- DropForeignKey
ALTER TABLE "product_models_3d" DROP CONSTRAINT "product_models_3d_variant_id_fkey";

-- DropIndex
DROP INDEX "customization_configs_design_surface_image_id_idx";

-- AddForeignKey
ALTER TABLE "product_models_3d" ADD CONSTRAINT "product_models_3d_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_models_3d" ADD CONSTRAINT "product_models_3d_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_configs" ADD CONSTRAINT "customization_configs_design_surface_image_id_fkey" FOREIGN KEY ("design_surface_image_id") REFERENCES "product_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;
