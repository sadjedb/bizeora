-- ---------------------------------------------------------------------------
-- Visual placement — the customer puts the design where they want it.
--
-- Until now a placement was a name off a list ("Poitrine gauche") and a size
-- was one of three presets. The customer chose two words and hoped; the
-- workshop read two words and guessed. This replaces both with a picture: the
-- artwork is dragged onto a photograph of the blank, resized against a real
-- millimetre readout, and what the customer approves is what gets stitched.
--
-- ## The one idea worth understanding
--
-- A placement is stored as **percentages of the surface it sits on** — never
-- pixels, never millimetres. That is what lets one number serve two renderers:
-- over a photograph the transform is a CSS box; inside a 3D model it is where
-- the artwork is composited into the UV texture wrapped round the mesh. A
-- garment that has only a photograph today and gains a `.glb` tomorrow keeps
-- every configuration ever saved against it, because nothing was ever stored
-- in that photograph's pixels. See ADR-035.
--
-- Millimetres come from one measurement the admin takes once per surface —
-- `surface_width_mm`, how wide the garment really is across the full width of
-- the picture. Everything real follows from it, which is why an unmeasured
-- surface can be looked at but not ordered from.
-- ---------------------------------------------------------------------------

CREATE TYPE "design_surface" AS ENUM ('FRONT', 'BACK', 'LEFT', 'RIGHT', 'TOP', 'WRAP');

-- ---------------------------------------------------------------------------
-- Blanks: which face a photograph shows, and how wide the garment is in it.
--
-- Both nullable, and that is the upgrade path rather than an oversight. Every
-- existing product image keeps NULL and stays exactly what it was — a picture
-- that sells the product. A picture only becomes a placeable surface when the
-- owner says which face it is and measures it.
-- ---------------------------------------------------------------------------

ALTER TABLE "product_images" ADD COLUMN "surface" "design_surface";
ALTER TABLE "product_images" ADD COLUMN "surface_width_mm" INTEGER;

ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_surface_width_positive"
  CHECK ("surface_width_mm" IS NULL OR "surface_width_mm" > 0);

-- The builder's own read: "the placeable faces of this blank".
CREATE INDEX "product_images_product_id_surface_idx"
  ON "product_images" ("product_id", "surface");

-- ---------------------------------------------------------------------------
-- The 3D half.
--
-- Optional everywhere. A blank with a photograph and no model gets the flat
-- editor; a blank with both gets the one that spins. `material_name` is the
-- mesh's printable material — a model has several (fabric, stitching, a metal
-- eyelet) and only one of them is the thing you embroider.
-- ---------------------------------------------------------------------------

CREATE TABLE "product_models_3d" (
  "id"               UUID PRIMARY KEY DEFAULT uuidv7(),
  "product_id"       UUID NOT NULL REFERENCES "products" ("id") ON DELETE CASCADE,
  "variant_id"       UUID REFERENCES "product_variants" ("id") ON DELETE SET NULL,
  "storage_key"      TEXT NOT NULL,
  "byte_size"        INTEGER NOT NULL,
  "material_name"    TEXT NOT NULL,
  "surface_width_mm" INTEGER,
  "poster_key"       TEXT,
  "label"            TEXT,
  "is_active"        BOOLEAN NOT NULL DEFAULT true,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "product_models_3d_byte_size_positive" CHECK ("byte_size" > 0),
  CONSTRAINT "product_models_3d_surface_width_positive"
    CHECK ("surface_width_mm" IS NULL OR "surface_width_mm" > 0)
);

CREATE INDEX "product_models_3d_product_id_is_active_idx"
  ON "product_models_3d" ("product_id", "is_active");

-- ---------------------------------------------------------------------------
-- Where the customer put it.
--
-- `x` and `y` are the design's **centre**, not its corner: the centre is the
-- point rotation turns about and the point a resize keeps still, so storing a
-- corner would make both operations move the design for no reason anybody
-- asked for.
--
-- The height is deliberately **not** stored. It follows from the artwork's own
-- pixel dimensions, which `design_files` already records, and a stored height
-- is a second source of truth that can contradict the picture.
--
-- Decimal(6,3) rather than a float: a percentage with three decimals resolves
-- to a thousandth of a garment — a twentieth of a millimetre on a hoodie — and
-- binary floating point has no business anywhere near a figure the customer is
-- shown and the workshop stitches to.
-- ---------------------------------------------------------------------------

ALTER TABLE "customization_configs"
  ADD COLUMN "design_surface"          "design_surface",
  ADD COLUMN "design_surface_image_id" UUID,
  ADD COLUMN "design_x_percent"        DECIMAL(6, 3),
  ADD COLUMN "design_y_percent"        DECIMAL(6, 3),
  ADD COLUMN "design_width_percent"    DECIMAL(6, 3),
  ADD COLUMN "design_rotation_deg"     DECIMAL(6, 2) DEFAULT 0,
  -- "Devant · 85 × 43 mm", frozen with the rest of the display snapshots so a
  -- quote sent six months ago still reads correctly after the blank's
  -- photograph has been replaced (ADR-016).
  ADD COLUMN "design_surface_label"    TEXT;

-- The ranges the domain enforces, enforced again where they cannot be argued
-- with. A transform outside these is not a placement anybody could have
-- dragged, and it would render as a design hanging off the garment.
ALTER TABLE "customization_configs"
  ADD CONSTRAINT "customization_configs_design_x_range"
    CHECK ("design_x_percent" IS NULL OR "design_x_percent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "customization_configs_design_y_range"
    CHECK ("design_y_percent" IS NULL OR "design_y_percent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "customization_configs_design_width_range"
    CHECK ("design_width_percent" IS NULL
           OR "design_width_percent" > 0 AND "design_width_percent" <= 100),
  ADD CONSTRAINT "customization_configs_design_rotation_range"
    CHECK ("design_rotation_deg" IS NULL
           OR "design_rotation_deg" BETWEEN -180 AND 180);

-- A placement is all four numbers or none of them. Half a transform is a
-- design at an unknown position, which renders somewhere plausible and wrong.
ALTER TABLE "customization_configs"
  ADD CONSTRAINT "customization_configs_design_transform_complete"
    CHECK (
      num_nulls("design_x_percent", "design_y_percent", "design_width_percent") IN (0, 3)
    );

-- Named so it reads in an error message: the surface picture must be a picture
-- of this configuration's own product, which the application checks and this
-- makes true.
ALTER TABLE "customization_configs"
  ADD CONSTRAINT "customization_configs_design_surface_image_id_fkey"
  FOREIGN KEY ("design_surface_image_id") REFERENCES "product_images" ("id")
  ON DELETE SET NULL;

CREATE INDEX "customization_configs_design_surface_image_id_idx"
  ON "customization_configs" ("design_surface_image_id");
