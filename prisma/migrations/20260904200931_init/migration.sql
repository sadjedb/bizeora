-- CreateExtension
-- citext backs users.email and coupons.code (DATABASE.md sections 4, 12).
-- Prisma emits the CITEXT column type but not the extension that provides it.
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "stock_policy" AS ENUM ('TRACK', 'DONT_TRACK', 'MADE_TO_ORDER');

-- CreateEnum
CREATE TYPE "cart_status" AS ENUM ('ACTIVE', 'CONVERTED', 'ABANDONED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "cart_kind" AS ENUM ('STANDARD', 'QUOTE_BOUND');

-- CreateEnum
CREATE TYPE "line_kind" AS ENUM ('STOCK', 'CUSTOM', 'FEE');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('AWAITING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'DESIGN_REVIEW', 'IN_PRODUCTION', 'READY', 'SHIPPED', 'DELIVERED', 'ON_HOLD', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('UNPAID', 'DEPOSIT_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('COD', 'BANK_TRANSFER', 'CCP', 'ONLINE');

-- CreateEnum
CREATE TYPE "payment_tx_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('DEPOSIT', 'BALANCE', 'FULL', 'REFUND');

-- CreateEnum
CREATE TYPE "delivery_type" AS ENUM ('HOME', 'DESK');

-- CreateEnum
CREATE TYPE "request_status" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO', 'QUOTED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "request_source" AS ENUM ('BUILDER', 'PRODUCT_PAGE', 'CONTACT_FORM', 'ADMIN');

-- CreateEnum
CREATE TYPE "request_event_type" AS ENUM ('STATUS_CHANGE', 'MESSAGE', 'FILE_ADDED', 'QUOTE_SENT', 'INTERNAL_NOTE');

-- CreateEnum
CREATE TYPE "pricing_mode" AS ENUM ('FIXED', 'QUOTE');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "quote_line_kind" AS ENUM ('PRODUCT', 'EMBROIDERY', 'SETUP_FEE', 'DIGITIZING', 'RUSH_FEE', 'SHIPPING', 'DISCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "design_file_status" AS ENUM ('PENDING', 'READY', 'REJECTED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "design_file_role" AS ENUM ('PRIMARY', 'REFERENCE');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "coupon_type" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "coupon_scope" AS ENUM ('ALL', 'PRODUCTS', 'CATEGORIES', 'COLLECTIONS');

-- CreateEnum
CREATE TYPE "coupon_target_type" AS ENUM ('PRODUCT', 'CATEGORY', 'COLLECTION');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'WHATSAPP', 'SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('CUSTOMER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "homepage_section_type" AS ENUM ('HERO', 'CATEGORY_GRID', 'HOW_IT_WORKS', 'CUSTOM_CTA', 'FEATURED_PRODUCTS', 'GALLERY', 'WHY_US', 'REVIEWS', 'SOCIAL', 'BANNER', 'FINAL_CTA');

-- CreateEnum
CREATE TYPE "setting_type" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'MONEY');

-- CreateEnum
CREATE TYPE "verification_token_type" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "order_address_type" AS ENUM ('SHIPPING', 'BILLING');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" CITEXT,
    "email_verified_at" TIMESTAMPTZ(6),
    "phone" TEXT,
    "phone_verified_at" TIMESTAMPTZ(6),
    "password_hash" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'CUSTOMER',
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "type" "verification_token_type" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "scope" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wilayas" (
    "code" INTEGER NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "wilayas_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "communes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "wilaya_code" INTEGER NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "communes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "label" TEXT,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "wilaya_code" INTEGER NOT NULL,
    "commune_id" UUID,
    "commune_name" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "postal_code" TEXT,
    "notes" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_key" TEXT,
    "parent_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_key" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_collections" (
    "product_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_collections_pkey" PRIMARY KEY ("product_id","collection_id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "status" "product_status" NOT NULL DEFAULT 'DRAFT',
    "base_price" INTEGER NOT NULL,
    "compare_at_price" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "stock_policy" "stock_policy" NOT NULL DEFAULT 'TRACK',
    "material" TEXT,
    "care_instructions" TEXT,
    "embroidery_details" TEXT,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_best_seller" BOOLEAN NOT NULL DEFAULT false,
    "is_new_arrival" BOOLEAN NOT NULL DEFAULT false,
    "is_customizable" BOOLEAN NOT NULL DEFAULT false,
    "customization_profile_id" UUID,
    "rating_average" INTEGER,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "og_image_key" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "option_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "hex_color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "price_override" INTEGER,
    "compare_at_price_override" INTEGER,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER,
    "weight_grams" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_option_values" (
    "variant_id" UUID NOT NULL,
    "option_value_id" UUID NOT NULL,

    CONSTRAINT "product_variant_option_values_pkey" PRIMARY KEY ("variant_id","option_value_id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "storage_key" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "blur_data_url" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image_placement_anchors" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "product_image_id" UUID NOT NULL,
    "placement_id" UUID NOT NULL,
    "x_percent" DECIMAL(5,2) NOT NULL,
    "y_percent" DECIMAL(5,2) NOT NULL,
    "width_percent" DECIMAL(5,2) NOT NULL,
    "rotation_deg" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_image_placement_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tags" (
    "product_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("product_id","tag_id")
);

-- CreateTable
CREATE TABLE "product_redirects" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "from_slug" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "diagram_image_key" TEXT,
    "max_width_mm" INTEGER,
    "max_height_mm" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embroidery_sizes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "max_width_mm" INTEGER,
    "max_height_mm" INTEGER,
    "base_price" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "embroidery_sizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_colors" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex_color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "thread_colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embroidery_fonts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "preview_image_key" TEXT,
    "css_font_family" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "embroidery_fonts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customization_profiles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "customization_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_placements" (
    "profile_id" UUID NOT NULL,
    "placement_id" UUID NOT NULL,
    "price_modifier" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "profile_placements_pkey" PRIMARY KEY ("profile_id","placement_id")
);

-- CreateTable
CREATE TABLE "profile_embroidery_sizes" (
    "profile_id" UUID NOT NULL,
    "embroidery_size_id" UUID NOT NULL,
    "price_modifier" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "profile_embroidery_sizes_pkey" PRIMARY KEY ("profile_id","embroidery_size_id")
);

-- CreateTable
CREATE TABLE "profile_product_types" (
    "profile_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "profile_product_types_pkey" PRIMARY KEY ("profile_id","category_id")
);

-- CreateTable
CREATE TABLE "customization_configs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_user_id" UUID,
    "product_id" UUID,
    "variant_id" UUID,
    "freeform_product_type" TEXT,
    "placement_id" UUID,
    "custom_placement_note" TEXT,
    "embroidery_size_id" UUID,
    "embroidery_width_mm" INTEGER,
    "embroidery_height_mm" INTEGER,
    "embroidery_text" TEXT,
    "embroidery_font_id" UUID,
    "thread_color_count" INTEGER NOT NULL DEFAULT 1,
    "instructions" TEXT,
    "pricing_mode" "pricing_mode" NOT NULL,
    "pricing_mode_reason" TEXT,
    "estimate_min" INTEGER,
    "estimate_max" INTEGER,
    "is_template" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "frozen_at" TIMESTAMPTZ(6),
    "cloned_from_config_id" UUID,
    "product_name_snapshot" TEXT,
    "placement_label" TEXT,
    "embroidery_size_label" TEXT,
    "thread_color_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "font_label" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customization_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customization_thread_colors" (
    "config_id" UUID NOT NULL,
    "thread_color_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customization_thread_colors_pkey" PRIMARY KEY ("config_id","thread_color_id")
);

-- CreateTable
CREATE TABLE "customization_files" (
    "config_id" UUID NOT NULL,
    "design_file_id" UUID NOT NULL,
    "role" "design_file_role" NOT NULL DEFAULT 'PRIMARY',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customization_files_pkey" PRIMARY KEY ("config_id","design_file_id")
);

-- CreateTable
CREATE TABLE "design_files" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_user_id" UUID,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "page_count" INTEGER,
    "status" "design_file_status" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "preview_key" TEXT,
    "label" TEXT,
    "saved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "design_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" "cart_kind" NOT NULL DEFAULT 'STANDARD',
    "user_id" UUID,
    "anonymous_token" TEXT,
    "status" "cart_status" NOT NULL DEFAULT 'ACTIVE',
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "quote_id" UUID,
    "quote_valid_until" TIMESTAMPTZ(6),
    "coupon_id" UUID,
    "coupon_code" TEXT,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "converted_order_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "cart_id" UUID NOT NULL,
    "kind" "line_kind" NOT NULL,
    "product_id" UUID,
    "variant_id" UUID,
    "customization_config_id" UUID,
    "quote_item_id" UUID,
    "name_snapshot" TEXT,
    "locked_unit_price" INTEGER,
    "quantity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_number" TEXT NOT NULL,
    "user_id" UUID,
    "guest_token" TEXT,
    "status" "order_status" NOT NULL,
    "payment_status" "payment_status" NOT NULL DEFAULT 'UNPAID',
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discount_total" INTEGER NOT NULL DEFAULT 0,
    "shipping_total" INTEGER NOT NULL DEFAULT 0,
    "tax_total" INTEGER NOT NULL DEFAULT 0,
    "grand_total" INTEGER NOT NULL,
    "amount_paid" INTEGER NOT NULL DEFAULT 0,
    "deposit_required" INTEGER NOT NULL DEFAULT 0,
    "coupon_id" UUID,
    "coupon_code_snapshot" TEXT,
    "payment_method" "payment_method" NOT NULL,
    "request_id" UUID,
    "quote_id" UUID,
    "delivery_type" "delivery_type" NOT NULL,
    "shipping_rate_id" UUID,
    "shipping_rate_label" TEXT,
    "carrier_name" TEXT,
    "tracking_number" TEXT,
    "tracking_url" TEXT,
    "estimated_delivery_from" DATE,
    "estimated_delivery_to" DATE,
    "customer_note" TEXT,
    "internal_notes" TEXT,
    "cancellation_reason" TEXT,
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "production_started_at" TIMESTAMPTZ(6),
    "ready_at" TIMESTAMPTZ(6),
    "shipped_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "kind" "line_kind" NOT NULL,
    "fee_kind" "quote_line_kind",
    "product_id" UUID,
    "variant_id" UUID,
    "customization_config_id" UUID,
    "quote_item_id" UUID,
    "name_snapshot" TEXT NOT NULL,
    "variant_label_snapshot" TEXT,
    "sku_snapshot" TEXT,
    "image_key_snapshot" TEXT,
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_discount" INTEGER NOT NULL DEFAULT 0,
    "line_total" INTEGER NOT NULL,
    "requires_production" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_addresses" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "type" "order_address_type" NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "wilaya_code" INTEGER NOT NULL,
    "wilaya_name_snapshot" TEXT NOT NULL,
    "commune_name" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "postal_code" TEXT,
    "notes" TEXT,

    CONSTRAINT "order_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "is_customer_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "method" "payment_method" NOT NULL,
    "kind" "payment_kind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "status" "payment_tx_status" NOT NULL DEFAULT 'PENDING',
    "provider_reference" TEXT,
    "idempotency_key" TEXT,
    "raw_payload" JSONB,
    "captured_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by_user_id" UUID,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "request_number" TEXT NOT NULL,
    "user_id" UUID,
    "draft_token" TEXT,
    "status" "request_status" NOT NULL DEFAULT 'DRAFT',
    "source" "request_source" NOT NULL,
    "pricing_mode" "pricing_mode" NOT NULL,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "preferred_channel" "notification_channel",
    "estimate_min" INTEGER,
    "estimate_max" INTEGER,
    "customer_note" TEXT,
    "internal_notes" TEXT,
    "needs_info_reason" TEXT,
    "assigned_to_user_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "quoted_at" TIMESTAMPTZ(6),
    "responded_at" TIMESTAMPTZ(6),
    "converted_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "converted_order_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_request_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "request_id" UUID NOT NULL,
    "customization_config_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "estimate_min" INTEGER,
    "estimate_max" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "custom_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_request_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "request_id" UUID NOT NULL,
    "type" "request_event_type" NOT NULL,
    "from_status" "request_status",
    "to_status" "request_status",
    "actor_type" "actor_type" NOT NULL,
    "actor_user_id" UUID,
    "message" TEXT,
    "is_customer_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "quote_number" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_quote_id" UUID,
    "status" "quote_status" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "subtotal" INTEGER NOT NULL,
    "discount_total" INTEGER NOT NULL DEFAULT 0,
    "shipping_total" INTEGER NOT NULL DEFAULT 0,
    "tax_total" INTEGER NOT NULL DEFAULT 0,
    "grand_total" INTEGER NOT NULL,
    "deposit_required" INTEGER NOT NULL DEFAULT 0,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "customer_message" TEXT,
    "internal_notes" TEXT,
    "rejection_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "viewed_at" TIMESTAMPTZ(6),
    "responded_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "acceptance_valid_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "quote_id" UUID NOT NULL,
    "request_item_id" UUID,
    "kind" "quote_line_kind" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" INTEGER NOT NULL,
    "line_total" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "product_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "order_item_id" UUID,
    "rating" SMALLINT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" "review_status" NOT NULL DEFAULT 'PENDING',
    "is_verified_purchase" BOOLEAN NOT NULL DEFAULT false,
    "admin_response" TEXT,
    "moderated_by_user_id" UUID,
    "moderated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_tiers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "min_quantity" INTEGER NOT NULL,
    "max_quantity" INTEGER,
    "discount_basis_points" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "discount_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" CITEXT NOT NULL,
    "description" TEXT,
    "type" "coupon_type" NOT NULL,
    "value" INTEGER NOT NULL,
    "minimum_order_total" INTEGER,
    "maximum_discount" INTEGER,
    "scope" "coupon_scope" NOT NULL DEFAULT 'ALL',
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6),
    "usage_limit_total" INTEGER,
    "usage_limit_per_customer" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "applies_to_custom_orders" BOOLEAN NOT NULL DEFAULT false,
    "applies_to_sale_items" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_restrictions" (
    "coupon_id" UUID NOT NULL,
    "target_type" "coupon_target_type" NOT NULL,
    "target_id" UUID NOT NULL,

    CONSTRAINT "coupon_restrictions_pkey" PRIMARY KEY ("coupon_id","target_type","target_id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "coupon_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID,
    "amount_discounted" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image_key" TEXT NOT NULL,
    "thumbnail_key" TEXT,
    "alt" TEXT NOT NULL,
    "product_type" TEXT,
    "embroidery_type" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "source_order_id" UUID,
    "source_design_file_id" UUID,
    "customer_consent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "gallery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_tags" (
    "gallery_item_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "gallery_tags_pkey" PRIMARY KEY ("gallery_item_id","tag_id")
);

-- CreateTable
CREATE TABLE "homepage_sections" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" "homepage_section_type" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "subtitle" TEXT,
    "body" TEXT,
    "cta_label" TEXT,
    "cta_href" TEXT,
    "image_key" TEXT,
    "config" JSONB,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "homepage_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "message" TEXT NOT NULL,
    "href" TEXT,
    "variant" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_links" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "handle" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "social_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" "setting_type" NOT NULL,
    "group" TEXT NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by_user_id" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zone_wilayas" (
    "zone_id" UUID NOT NULL,
    "wilaya_code" INTEGER NOT NULL,

    CONSTRAINT "shipping_zone_wilayas_pkey" PRIMARY KEY ("zone_id","wilaya_code")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "zone_id" UUID NOT NULL,
    "delivery_type" "delivery_type" NOT NULL,
    "price" INTEGER NOT NULL,
    "free_over_amount" INTEGER,
    "estimated_min_days" INTEGER NOT NULL,
    "estimated_max_days" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID,
    "channel" "notification_channel" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB,
    "recipient" TEXT,
    "related_order_id" UUID,
    "related_quote_id" UUID,
    "related_request_id" UUID,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_user_id" UUID,
    "actor_type" "actor_type" NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" UUID,
    "properties" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("user_id","product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_idx" ON "verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_id_provider_account_id_key" ON "accounts"("provider_id", "provider_account_id");

-- CreateIndex
CREATE INDEX "communes_wilaya_code_idx" ON "communes"("wilaya_code");

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- CreateIndex
CREATE INDEX "categories_parent_id_position_idx" ON "categories"("parent_id", "position");

-- CreateIndex
CREATE INDEX "categories_is_active_idx" ON "categories"("is_active");

-- CreateIndex
CREATE INDEX "products_status_published_at_idx" ON "products"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "products_category_id_status_idx" ON "products"("category_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_product_id_name_key" ON "product_options"("product_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_values_option_id_value_key" ON "product_option_values"("option_id", "value");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE INDEX "product_image_placement_anchors_product_image_id_idx" ON "product_image_placement_anchors"("product_image_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_image_placement_anchors_product_image_id_placement__key" ON "product_image_placement_anchors"("product_image_id", "placement_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "product_redirects_from_slug_key" ON "product_redirects"("from_slug");

-- CreateIndex
CREATE UNIQUE INDEX "placements_code_key" ON "placements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "embroidery_sizes_code_key" ON "embroidery_sizes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "thread_colors_code_key" ON "thread_colors"("code");

-- CreateIndex
CREATE INDEX "customization_configs_owner_user_id_created_at_idx" ON "customization_configs"("owner_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "customization_configs_product_id_idx" ON "customization_configs"("product_id");

-- CreateIndex
CREATE INDEX "customization_configs_cloned_from_config_id_idx" ON "customization_configs"("cloned_from_config_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_files_storage_key_key" ON "design_files"("storage_key");

-- CreateIndex
CREATE INDEX "design_files_owner_user_id_created_at_idx" ON "design_files"("owner_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "design_files_checksum_sha256_idx" ON "design_files"("checksum_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "carts_anonymous_token_key" ON "carts"("anonymous_token");

-- CreateIndex
CREATE UNIQUE INDEX "carts_quote_id_key" ON "carts"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_converted_order_id_key" ON "carts"("converted_order_id");

-- CreateIndex
CREATE INDEX "carts_status_last_activity_at_idx" ON "carts"("status", "last_activity_at");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_position_idx" ON "cart_items"("cart_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_guest_token_key" ON "orders"("guest_token");

-- CreateIndex
CREATE UNIQUE INDEX "orders_quote_id_key" ON "orders"("quote_id");

-- CreateIndex
CREATE INDEX "orders_user_id_placed_at_idx" ON "orders"("user_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");

-- CreateIndex
CREATE INDEX "orders_placed_at_idx" ON "orders"("placed_at" DESC);

-- CreateIndex
CREATE INDEX "orders_contact_phone_idx" ON "orders"("contact_phone");

-- CreateIndex
CREATE INDEX "order_items_order_id_position_idx" ON "order_items"("order_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "order_addresses_order_id_type_key" ON "order_addresses"("order_id", "type");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_order_id_created_at_idx" ON "payments"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_provider_reference_idx" ON "payments"("provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "custom_requests_request_number_key" ON "custom_requests"("request_number");

-- CreateIndex
CREATE UNIQUE INDEX "custom_requests_draft_token_key" ON "custom_requests"("draft_token");

-- CreateIndex
CREATE INDEX "custom_requests_user_id_created_at_idx" ON "custom_requests"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "custom_requests_assigned_to_user_id_idx" ON "custom_requests"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "custom_request_items_request_id_position_idx" ON "custom_request_items"("request_id", "position");

-- CreateIndex
CREATE INDEX "custom_request_events_request_id_created_at_idx" ON "custom_request_events"("request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_quote_number_key" ON "quotes"("quote_number");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_supersedes_quote_id_key" ON "quotes"("supersedes_quote_id");

-- CreateIndex
CREATE INDEX "quotes_user_id_created_at_idx" ON "quotes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_request_id_version_key" ON "quotes"("request_id", "version");

-- CreateIndex
CREATE INDEX "quote_items_quote_id_position_idx" ON "quote_items"("quote_id", "position");

-- CreateIndex
CREATE INDEX "reviews_product_id_status_created_at_idx" ON "reviews"("product_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "discount_tiers_min_quantity_idx" ON "discount_tiers"("min_quantity");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_order_id_key" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_coupon_id_order_id_key" ON "coupon_redemptions"("coupon_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "gallery_items_slug_key" ON "gallery_items"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "pages_slug_key" ON "pages"("slug");

-- CreateIndex
CREATE INDEX "settings_group_idx" ON "settings"("group");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_zone_wilayas_wilaya_code_key" ON "shipping_zone_wilayas"("wilaya_code");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_rates_zone_id_delivery_type_key" ON "shipping_rates"("zone_id", "delivery_type");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "analytics_events_name_occurred_at_idx" ON "analytics_events"("name", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communes" ADD CONSTRAINT "communes_wilaya_code_fkey" FOREIGN KEY ("wilaya_code") REFERENCES "wilayas"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_wilaya_code_fkey" FOREIGN KEY ("wilaya_code") REFERENCES "wilayas"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_customization_profile_id_fkey" FOREIGN KEY ("customization_profile_id") REFERENCES "customization_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "product_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "product_option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image_placement_anchors" ADD CONSTRAINT "product_image_placement_anchors_product_image_id_fkey" FOREIGN KEY ("product_image_id") REFERENCES "product_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image_placement_anchors" ADD CONSTRAINT "product_image_placement_anchors_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "placements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_redirects" ADD CONSTRAINT "product_redirects_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_placements" ADD CONSTRAINT "profile_placements_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "customization_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_placements" ADD CONSTRAINT "profile_placements_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "placements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_embroidery_sizes" ADD CONSTRAINT "profile_embroidery_sizes_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "customization_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_embroidery_sizes" ADD CONSTRAINT "profile_embroidery_sizes_embroidery_size_id_fkey" FOREIGN KEY ("embroidery_size_id") REFERENCES "embroidery_sizes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_product_types" ADD CONSTRAINT "profile_product_types_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "customization_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_product_types" ADD CONSTRAINT "profile_product_types_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_configs" ADD CONSTRAINT "customization_configs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_configs" ADD CONSTRAINT "customization_configs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_configs" ADD CONSTRAINT "customization_configs_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_configs" ADD CONSTRAINT "customization_configs_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "placements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_configs" ADD CONSTRAINT "customization_configs_embroidery_size_id_fkey" FOREIGN KEY ("embroidery_size_id") REFERENCES "embroidery_sizes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_configs" ADD CONSTRAINT "customization_configs_embroidery_font_id_fkey" FOREIGN KEY ("embroidery_font_id") REFERENCES "embroidery_fonts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_configs" ADD CONSTRAINT "customization_configs_cloned_from_config_id_fkey" FOREIGN KEY ("cloned_from_config_id") REFERENCES "customization_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_thread_colors" ADD CONSTRAINT "customization_thread_colors_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "customization_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_thread_colors" ADD CONSTRAINT "customization_thread_colors_thread_color_id_fkey" FOREIGN KEY ("thread_color_id") REFERENCES "thread_colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_files" ADD CONSTRAINT "customization_files_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "customization_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_files" ADD CONSTRAINT "customization_files_design_file_id_fkey" FOREIGN KEY ("design_file_id") REFERENCES "design_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_files" ADD CONSTRAINT "design_files_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_converted_order_id_fkey" FOREIGN KEY ("converted_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_customization_config_id_fkey" FOREIGN KEY ("customization_config_id") REFERENCES "customization_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quote_item_id_fkey" FOREIGN KEY ("quote_item_id") REFERENCES "quote_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "custom_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_rate_id_fkey" FOREIGN KEY ("shipping_rate_id") REFERENCES "shipping_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_customization_config_id_fkey" FOREIGN KEY ("customization_config_id") REFERENCES "customization_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quote_item_id_fkey" FOREIGN KEY ("quote_item_id") REFERENCES "quote_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_wilaya_code_fkey" FOREIGN KEY ("wilaya_code") REFERENCES "wilayas"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_converted_order_id_fkey" FOREIGN KEY ("converted_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_request_items" ADD CONSTRAINT "custom_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "custom_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_request_items" ADD CONSTRAINT "custom_request_items_customization_config_id_fkey" FOREIGN KEY ("customization_config_id") REFERENCES "customization_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_request_events" ADD CONSTRAINT "custom_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "custom_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_request_events" ADD CONSTRAINT "custom_request_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "custom_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_supersedes_quote_id_fkey" FOREIGN KEY ("supersedes_quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_request_item_id_fkey" FOREIGN KEY ("request_item_id") REFERENCES "custom_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_user_id_fkey" FOREIGN KEY ("moderated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_restrictions" ADD CONSTRAINT "coupon_restrictions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_source_order_id_fkey" FOREIGN KEY ("source_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_source_design_file_id_fkey" FOREIGN KEY ("source_design_file_id") REFERENCES "design_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_tags" ADD CONSTRAINT "gallery_tags_gallery_item_id_fkey" FOREIGN KEY ("gallery_item_id") REFERENCES "gallery_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_tags" ADD CONSTRAINT "gallery_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_wilayas" ADD CONSTRAINT "shipping_zone_wilayas_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_wilayas" ADD CONSTRAINT "shipping_zone_wilayas_wilaya_code_fkey" FOREIGN KEY ("wilaya_code") REFERENCES "wilayas"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_order_id_fkey" FOREIGN KEY ("related_order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_quote_id_fkey" FOREIGN KEY ("related_quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_request_id_fkey" FOREIGN KEY ("related_request_id") REFERENCES "custom_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- STITCH — constraints and partial indexes
--
-- Prisma cannot express CHECK constraints or partial (WHERE) indexes in
-- schema.prisma. Everything DATABASE.md requires that Prisma cannot generate
-- lives here and is appended verbatim to the initial migration.
--
-- This file is the maintained source; prisma/migrations/*/migration.sql
-- carries a copy so migrations stay self-contained and reproducible.
--
-- Every statement names the DATABASE.md section it implements.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Extensions. `citext` backs users.email and coupons.code (section 4, 12).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS citext;


-- ---------------------------------------------------------------------------
-- Soft-delete-aware unique indexes (section 1: "`deletedAt IS NULL` is part of
-- the relevant unique indexes").
-- ---------------------------------------------------------------------------

-- users.email — section 4
DROP INDEX IF EXISTS "users_email_key";
CREATE UNIQUE INDEX "users_email_active_key"
  ON "users" ("email") WHERE "deleted_at" IS NULL;

-- categories.slug — section 5
CREATE UNIQUE INDEX "categories_slug_active_key"
  ON "categories" ("slug") WHERE "deleted_at" IS NULL;

-- products.slug — section 5
CREATE UNIQUE INDEX "products_slug_active_key"
  ON "products" ("slug") WHERE "deleted_at" IS NULL;

-- collections.slug — section 5 (V1.5)
CREATE UNIQUE INDEX "collections_slug_active_key"
  ON "collections" ("slug") WHERE "deleted_at" IS NULL;

-- reviews: one review per customer per product — section 11, constraint 11
CREATE UNIQUE INDEX "reviews_user_product_active_key"
  ON "reviews" ("user_id", "product_id") WHERE "deleted_at" IS NULL;


-- ---------------------------------------------------------------------------
-- Other partial unique indexes (section 18)
-- ---------------------------------------------------------------------------

-- One default address per user — constraint 9
CREATE UNIQUE INDEX "addresses_one_default_per_user"
  ON "addresses" ("user_id") WHERE "is_default";

-- One primary image per product — section 5
CREATE UNIQUE INDEX "product_images_one_primary_per_product"
  ON "product_images" ("product_id") WHERE "is_primary";

-- One active standard cart per user — constraint 7
CREATE UNIQUE INDEX "carts_one_active_standard_per_user"
  ON "carts" ("user_id")
  WHERE "kind" = 'STANDARD' AND "status" = 'ACTIVE' AND "user_id" IS NOT NULL;

-- Adding the same variant twice increments rather than duplicates — section 7
CREATE UNIQUE INDEX "cart_items_one_stock_line_per_variant"
  ON "cart_items" ("cart_id", "variant_id") WHERE "kind" = 'STOCK';

-- One active tier per lower bound — section 12
CREATE UNIQUE INDEX "discount_tiers_active_min_quantity_key"
  ON "discount_tiers" ("min_quantity") WHERE "is_active";


-- ---------------------------------------------------------------------------
-- Partial and expression indexes that carry query load (section 17)
-- ---------------------------------------------------------------------------

-- Staff lookup — section 4
CREATE INDEX "users_staff_idx" ON "users" ("role") WHERE "role" <> 'CUSTOMER';

-- Featured and new-arrival merchandising — section 5
CREATE INDEX "products_featured_active_idx"
  ON "products" ("published_at" DESC)
  WHERE "is_featured" AND "status" = 'ACTIVE';

CREATE INDEX "products_new_arrival_active_idx"
  ON "products" ("published_at" DESC)
  WHERE "is_new_arrival" AND "status" = 'ACTIVE';

-- Full-text search over the catalogue — section 5, section 17
CREATE INDEX "products_search_idx" ON "products"
  USING GIN (
    to_tsvector(
      'simple',
      coalesce("name", '') || ' ' || coalesce("subtitle", '') || ' ' || coalesce("description", '')
    )
  );

-- The admin's primary queue, oldest first — section 9
CREATE INDEX "custom_requests_queue_idx"
  ON "custom_requests" ("submitted_at" ASC)
  WHERE "status" IN ('SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO');

-- Quote send-expiry job — section 10
CREATE INDEX "quotes_send_expiry_idx"
  ON "quotes" ("valid_until")
  WHERE "status" IN ('SENT', 'VIEWED');

-- Quote acceptance-expiry job — section 10
CREATE INDEX "quotes_acceptance_expiry_idx"
  ON "quotes" ("acceptance_valid_until")
  WHERE "status" = 'ACCEPTED';

-- Quote-bound cart invalidation job — section 7
CREATE INDEX "carts_quote_expiry_idx"
  ON "carts" ("quote_valid_until")
  WHERE "kind" = 'QUOTE_BOUND' AND "status" = 'ACTIVE';

-- Review moderation queue — section 11
CREATE INDEX "reviews_pending_idx" ON "reviews" ("created_at")
  WHERE "status" = 'PENDING';

-- Orphaned upload cleanup — section 6
CREATE INDEX "design_files_pending_idx" ON "design_files" ("created_at")
  WHERE "status" = 'PENDING';

-- Outbox dispatch — section 14
CREATE INDEX "notifications_dispatch_idx"
  ON "notifications" ("scheduled_for")
  WHERE "status" = 'PENDING';


-- ---------------------------------------------------------------------------
-- CHECK constraints (section 18)
-- ---------------------------------------------------------------------------

-- 5. Stock is never negative
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_stock_non_negative"
  CHECK ("stock_quantity" >= 0 AND "reserved_quantity" >= 0);

-- 6. Ratings are 1..5
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- 1. Order totals reconcile
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_totals_reconcile"
  CHECK ("grand_total" = "subtotal" - "discount_total" + "shipping_total" + "tax_total");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amount_paid_non_negative" CHECK ("amount_paid" >= 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_deposit_within_total"
  CHECK ("deposit_required" >= 0 AND "deposit_required" <= "grand_total");

-- 2. Order line totals reconcile
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_line_total_reconciles"
  CHECK ("line_total" = "unit_price" * "quantity" - "line_discount");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);

-- 13. A line is STOCK with a variant, CUSTOM with a configuration, or FEE with
--     a name, a quantity of 1 and no references.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_kind_shape" CHECK (
    ("kind" = 'STOCK'  AND "variant_id" IS NOT NULL AND "fee_kind" IS NULL)
    OR
    ("kind" = 'CUSTOM' AND "customization_config_id" IS NOT NULL AND "fee_kind" IS NULL)
    OR
    ("kind" = 'FEE'    AND "fee_kind" IS NOT NULL
                       AND "quantity" = 1
                       AND "requires_production" = false
                       AND "product_id" IS NULL
                       AND "variant_id" IS NULL
                       AND "customization_config_id" IS NULL)
  );

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_range"
  CHECK ("quantity" > 0 AND "quantity" <= 999);

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_kind_shape" CHECK (
    ("kind" = 'STOCK'  AND "variant_id" IS NOT NULL)
    OR
    ("kind" = 'CUSTOM' AND "customization_config_id" IS NOT NULL)
    OR
    ("kind" = 'FEE'    AND "name_snapshot" IS NOT NULL
                       AND "quantity" = 1
                       AND "variant_id" IS NULL
                       AND "customization_config_id" IS NULL)
  );

-- A locked price only exists on a quote-derived line — section 7
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_locked_price_requires_quote_item"
  CHECK ("locked_unit_price" IS NULL OR "quote_item_id" IS NOT NULL);

-- Cart shape — section 7
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_owner_exactly_one"
  CHECK (("user_id" IS NULL) <> ("anonymous_token" IS NULL));

ALTER TABLE "carts"
  ADD CONSTRAINT "carts_kind_shape" CHECK (
    ("kind" = 'QUOTE_BOUND' AND "quote_id" IS NOT NULL
                            AND "user_id" IS NOT NULL
                            AND "coupon_id" IS NULL)
    OR
    ("kind" = 'STANDARD'    AND "quote_id" IS NULL)
  );

-- 4. Quote totals reconcile
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_totals_reconcile"
  CHECK ("grand_total" = "subtotal" - "discount_total" + "shipping_total" + "tax_total");

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_valid_until_after_creation"
  CHECK ("valid_until" > "created_at");

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_acceptance_validity_requires_acceptance"
  CHECK ("acceptance_valid_until" IS NULL OR "accepted_at" IS NOT NULL);

ALTER TABLE "quote_items"
  ADD CONSTRAINT "quote_items_line_total_reconciles"
  CHECK ("line_total" = "unit_price" * "quantity");

-- 14. A customisation names either a catalogue product or a free-text type
ALTER TABLE "customization_configs"
  ADD CONSTRAINT "customization_configs_names_a_product"
  CHECK ("product_id" IS NOT NULL OR "freeform_product_type" IS NOT NULL);

-- 16. A frozen customisation carries its display snapshots
ALTER TABLE "customization_configs"
  ADD CONSTRAINT "customization_configs_frozen_has_snapshots"
  CHECK (
    "frozen_at" IS NULL
    OR "placement_id" IS NULL
    OR "placement_label" IS NOT NULL
  );

ALTER TABLE "customization_configs"
  ADD CONSTRAINT "customization_configs_thread_color_count_positive"
  CHECK ("thread_color_count" >= 1);

ALTER TABLE "custom_request_items"
  ADD CONSTRAINT "custom_request_items_quantity_positive" CHECK ("quantity" > 0);

-- 17. Discount tiers — ADR-017
ALTER TABLE "discount_tiers"
  ADD CONSTRAINT "discount_tiers_min_quantity_positive" CHECK ("min_quantity" >= 1);

ALTER TABLE "discount_tiers"
  ADD CONSTRAINT "discount_tiers_max_after_min"
  CHECK ("max_quantity" IS NULL OR "max_quantity" >= "min_quantity");

ALTER TABLE "discount_tiers"
  ADD CONSTRAINT "discount_tiers_basis_points_range"
  CHECK ("discount_basis_points" BETWEEN 0 AND 10000);

-- ADR-018: percentage settings are basis points. Coupon percentages are bounded
-- at the same range; FIXED_AMOUNT values are minor units and are only bounded
-- below.
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_value_range" CHECK (
    ("type" = 'PERCENTAGE' AND "value" BETWEEN 0 AND 10000)
    OR ("type" <> 'PERCENTAGE' AND "value" >= 0)
  );

-- Money is never negative where a negative value has no meaning
ALTER TABLE "products"
  ADD CONSTRAINT "products_base_price_non_negative" CHECK ("base_price" >= 0);

ALTER TABLE "shipping_rates"
  ADD CONSTRAINT "shipping_rates_price_non_negative" CHECK ("price" >= 0);

ALTER TABLE "shipping_rates"
  ADD CONSTRAINT "shipping_rates_estimate_order"
  CHECK ("estimated_max_days" >= "estimated_min_days" AND "estimated_min_days" >= 0);


-- ---------------------------------------------------------------------------
-- NOT enforced here, deliberately:
--
--   * `orders.subtotal = sum(order_items.line_total)` (DATABASE.md constraint 3)
--     A CHECK cannot reference other rows or tables, so this is not expressible
--     as a database constraint. It is a service-layer invariant, asserted by
--     test at order placement. See the Phase 2 report.
--
--   * discount tier non-overlap and full coverage (DATABASE.md section 12)
--     Explicitly documented as a service-layer invariant validated over the
--     active set on write, with a Postgres exclusion constraint recorded as a
--     future option.
-- ---------------------------------------------------------------------------
