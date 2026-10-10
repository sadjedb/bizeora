-- Data migration: the workshop's own photography, taken from its Instagram
-- page (@bizeora.co), replaces the demonstration content. No schema change.
--
-- Every statement is guarded so that it touches only rows that are still
-- exactly what the seed wrote. An empty database (CI, a fresh install) is left
-- alone and gets the same content from `prisma/seed.ts`; a row the owner has
-- since edited or replaced through the admin is left alone too. The image
-- files themselves ship in `public/assets`.

-- 1. The six demonstration gallery pieces become six real ones. Each row is
--    renamed in place, keeping its id, position and publication state, and
--    only while its picture is still the seed's placeholder.

WITH renamed AS (
    UPDATE "gallery_items"
    SET "slug" = 'logo-glacier-polo',
        "title" = 'Logo d’un glacier sur polo',
        "description" = 'Le logo de Casa Glace, glacier artisanal, brodé en couleurs sur la poitrine d’un polo piqué blanc.',
        "image_key" = 'gallery/logo-glacier-polo.jpg',
        "thumbnail_key" = NULL,
        "alt" = 'Polo blanc avec le logo rond et coloré d’un glacier brodé en poitrine',
        "product_type" = 'Polo',
        "embroidery_type" = 'Logo d’entreprise',
        "is_featured" = true,
        "translations" = NULL,
        "updated_at" = now()
    WHERE "slug" = 'logo-cabinet-architecture-polo' AND "image_key" = 'gallery/logo-cabinet-architecture-polo.jpg'
    RETURNING "id"
), untagged AS (
    DELETE FROM "gallery_tags"
    WHERE "gallery_item_id" IN (SELECT "id" FROM renamed)
      AND "tag_id" NOT IN (SELECT "id" FROM "tags" WHERE "slug" = 'polo')
)
INSERT INTO "gallery_tags" ("gallery_item_id", "tag_id")
SELECT renamed."id", "tags"."id" FROM renamed, "tags" WHERE "tags"."slug" = 'polo'
ON CONFLICT DO NOTHING;

WITH renamed AS (
    UPDATE "gallery_items"
    SET "slug" = 'obito-uchiha-sweat-blanc',
        "title" = 'Obito Uchiha sur un sweat blanc',
        "description" = 'Le personnage du manga Naruto, brodé en grand format et en plusieurs couleurs sur le devant d’un sweat à capuche blanc.',
        "image_key" = 'gallery/obito-uchiha-sweat-blanc.jpg',
        "thumbnail_key" = NULL,
        "alt" = 'Sweat blanc avec un grand portrait brodé d’Obito Uchiha',
        "product_type" = 'Sweat',
        "embroidery_type" = 'Motif',
        "is_featured" = true,
        "translations" = NULL,
        "updated_at" = now()
    WHERE "slug" = 'prenoms-sweats-equipe' AND "image_key" = 'gallery/prenoms-sweats-equipe.jpg'
    RETURNING "id"
), untagged AS (
    DELETE FROM "gallery_tags"
    WHERE "gallery_item_id" IN (SELECT "id" FROM renamed)
      AND "tag_id" NOT IN (SELECT "id" FROM "tags" WHERE "slug" = 'sweat')
)
INSERT INTO "gallery_tags" ("gallery_item_id", "tag_id")
SELECT renamed."id", "tags"."id" FROM renamed, "tags" WHERE "tags"."slug" = 'sweat'
ON CONFLICT DO NOTHING;

WITH renamed AS (
    UPDATE "gallery_items"
    SET "slug" = 'calligraphie-arabe-sweat-noir',
        "title" = 'Calligraphie arabe sur un sweat noir',
        "description" = 'Une calligraphie arabe sur mesure, brodée en fil blanc sur un sweat à capuche noir.',
        "image_key" = 'gallery/calligraphie-arabe-sweat-noir.jpg',
        "thumbnail_key" = NULL,
        "alt" = 'Sweat noir plié avec une calligraphie arabe brodée en blanc',
        "product_type" = 'Sweat',
        "embroidery_type" = 'Texte',
        "is_featured" = true,
        "translations" = NULL,
        "updated_at" = now()
    WHERE "slug" = 'casquettes-club-sportif' AND "image_key" = 'gallery/casquettes-club-sportif.jpg'
    RETURNING "id"
), untagged AS (
    DELETE FROM "gallery_tags"
    WHERE "gallery_item_id" IN (SELECT "id" FROM renamed)
      AND "tag_id" NOT IN (SELECT "id" FROM "tags" WHERE "slug" = 'sweat')
)
INSERT INTO "gallery_tags" ("gallery_item_id", "tag_id")
SELECT renamed."id", "tags"."id" FROM renamed, "tags" WHERE "tags"."slug" = 'sweat'
ON CONFLICT DO NOTHING;

WITH renamed AS (
    UPDATE "gallery_items"
    SET "slug" = 'cadeau-couple-chiffres-romains',
        "title" = 'Un cadeau pour un couple',
        "description" = 'Une date en chiffres romains et un symbole de l’infini, brodés en noir sur un sweat à capuche blanc offert en cadeau.',
        "image_key" = 'gallery/cadeau-couple-chiffres-romains.jpg',
        "thumbnail_key" = NULL,
        "alt" = 'Sweat blanc portant une date en chiffres romains et un symbole de l’infini brodés en noir',
        "product_type" = 'Sweat',
        "embroidery_type" = 'Date',
        "is_featured" = true,
        "translations" = NULL,
        "updated_at" = now()
    WHERE "slug" = 'tote-bags-librairie' AND "image_key" = 'gallery/tote-bags-librairie.jpg'
    RETURNING "id"
), untagged AS (
    DELETE FROM "gallery_tags"
    WHERE "gallery_item_id" IN (SELECT "id" FROM renamed)
      AND "tag_id" NOT IN (SELECT "id" FROM "tags" WHERE "slug" = 'sweat')
)
INSERT INTO "gallery_tags" ("gallery_item_id", "tag_id")
SELECT renamed."id", "tags"."id" FROM renamed, "tags" WHERE "tags"."slug" = 'sweat'
ON CONFLICT DO NOTHING;

WITH renamed AS (
    UPDATE "gallery_items"
    SET "slug" = 'logos-kiffan-pub-t-shirts',
        "title" = 'Le logo d’une entreprise sur des t-shirts',
        "description" = 'Le logo et les coordonnées de Kiffan Pub, brodés sur une série de t-shirts bleus et noirs.',
        "image_key" = 'gallery/logos-kiffan-pub-t-shirts.jpg',
        "thumbnail_key" = NULL,
        "alt" = 'T-shirts bleus et noirs posés à plat, avec le logo Kiffan Pub brodé',
        "product_type" = 'T-shirt',
        "embroidery_type" = 'Logo d’entreprise',
        "is_featured" = false,
        "translations" = NULL,
        "updated_at" = now()
    WHERE "slug" = 'tabliers-restaurant' AND "image_key" = 'gallery/tabliers-restaurant.jpg'
    RETURNING "id"
), untagged AS (
    DELETE FROM "gallery_tags"
    WHERE "gallery_item_id" IN (SELECT "id" FROM renamed)
      AND "tag_id" NOT IN (SELECT "id" FROM "tags" WHERE "slug" = 't-shirt')
)
INSERT INTO "gallery_tags" ("gallery_item_id", "tag_id")
SELECT renamed."id", "tags"."id" FROM renamed, "tags" WHERE "tags"."slug" = 't-shirt'
ON CONFLICT DO NOTHING;

WITH renamed AS (
    UPDATE "gallery_items"
    SET "slug" = 'iowa-sweat-noir',
        "title" = 'IOWA en grandes lettres',
        "description" = 'Le mot IOWA brodé en lettres blanches sur tout le dos d’un sweat à capuche noir.',
        "image_key" = 'gallery/iowa-sweat-noir.jpg',
        "thumbnail_key" = NULL,
        "alt" = 'Dos d’un sweat noir avec IOWA brodé en grandes lettres blanches',
        "product_type" = 'Sweat',
        "embroidery_type" = 'Texte',
        "is_featured" = false,
        "translations" = NULL,
        "updated_at" = now()
    WHERE "slug" = 't-shirts-anniversaire-famille' AND "image_key" = 'gallery/t-shirts-anniversaire-famille.jpg'
    RETURNING "id"
), untagged AS (
    DELETE FROM "gallery_tags"
    WHERE "gallery_item_id" IN (SELECT "id" FROM renamed)
      AND "tag_id" NOT IN (SELECT "id" FROM "tags" WHERE "slug" = 'sweat')
)
INSERT INTO "gallery_tags" ("gallery_item_id", "tag_id")
SELECT renamed."id", "tags"."id" FROM renamed, "tags" WHERE "tags"."slug" = 'sweat'
ON CONFLICT DO NOTHING;

-- 2. Workshop photographs after the T-shirt's and the hoodie's blank-garment
--    shots. Those blanks (1.jpg, 2.jpg) stay first: they are the placement
--    surfaces (ADR-035). Added only to a product still carrying the seed's
--    pictures and none the owner uploaded, like the seed itself does.

INSERT INTO "product_images" ("product_id", "storage_key", "alt", "position", "width", "height", "is_primary")
SELECT p."id", 'products/t-shirt-brode-classique/3.jpg', 'Deux t-shirts brodés, l’un bleu nuit, l’autre noir',
       (SELECT COALESCE(MAX(i."position") + 1, 0) FROM "product_images" i WHERE i."product_id" = p."id"),
       1200, 1500, false
FROM "products" p
WHERE p."slug" = 't-shirt-brode-classique'
  AND EXISTS (SELECT 1 FROM "product_images" i WHERE i."product_id" = p."id" AND i."storage_key" = 'products/t-shirt-brode-classique/1.jpg')
  AND NOT EXISTS (SELECT 1 FROM "product_images" i WHERE i."product_id" = p."id" AND (i."storage_key" = 'products/t-shirt-brode-classique/3.jpg' OR i."storage_key" LIKE 'media/%'));

INSERT INTO "product_images" ("product_id", "storage_key", "alt", "position", "width", "height", "is_primary")
SELECT p."id", 'products/t-shirt-brode-classique/4.jpg', 'T-shirt blanc brodé de logos de sport automobile',
       (SELECT COALESCE(MAX(i."position") + 1, 0) FROM "product_images" i WHERE i."product_id" = p."id"),
       1200, 1500, false
FROM "products" p
WHERE p."slug" = 't-shirt-brode-classique'
  AND EXISTS (SELECT 1 FROM "product_images" i WHERE i."product_id" = p."id" AND i."storage_key" = 'products/t-shirt-brode-classique/1.jpg')
  AND NOT EXISTS (SELECT 1 FROM "product_images" i WHERE i."product_id" = p."id" AND (i."storage_key" = 'products/t-shirt-brode-classique/4.jpg' OR i."storage_key" LIKE 'media/%'));

INSERT INTO "product_images" ("product_id", "storage_key", "alt", "position", "width", "height", "is_primary")
SELECT p."id", 'products/sweat-capuche-brode/3.jpg', 'Sweat à capuche écru avec un logo brodé en poitrine',
       (SELECT COALESCE(MAX(i."position") + 1, 0) FROM "product_images" i WHERE i."product_id" = p."id"),
       1200, 1500, false
FROM "products" p
WHERE p."slug" = 'sweat-capuche-brode'
  AND EXISTS (SELECT 1 FROM "product_images" i WHERE i."product_id" = p."id" AND i."storage_key" = 'products/sweat-capuche-brode/1.jpg')
  AND NOT EXISTS (SELECT 1 FROM "product_images" i WHERE i."product_id" = p."id" AND (i."storage_key" = 'products/sweat-capuche-brode/3.jpg' OR i."storage_key" LIKE 'media/%'));

INSERT INTO "product_images" ("product_id", "storage_key", "alt", "position", "width", "height", "is_primary")
SELECT p."id", 'products/sweat-capuche-brode/4.jpg', 'Dos d’un sweat à capuche noir avec une dague brodée',
       (SELECT COALESCE(MAX(i."position") + 1, 0) FROM "product_images" i WHERE i."product_id" = p."id"),
       1200, 1500, false
FROM "products" p
WHERE p."slug" = 'sweat-capuche-brode'
  AND EXISTS (SELECT 1 FROM "product_images" i WHERE i."product_id" = p."id" AND i."storage_key" = 'products/sweat-capuche-brode/1.jpg')
  AND NOT EXISTS (SELECT 1 FROM "product_images" i WHERE i."product_id" = p."id" AND (i."storage_key" = 'products/sweat-capuche-brode/4.jpg' OR i."storage_key" LIKE 'media/%'));

-- 3. The polo's photograph is now the workshop's white piqué polo.
UPDATE "product_images"
SET "alt" = 'Polo piqué blanc avec le logo d’un glacier brodé en poitrine'
WHERE "storage_key" = 'products/polo-pique-brode/1.jpg'
  AND "alt" = 'Polo piqué bleu nuit avec broderie poitrine';
