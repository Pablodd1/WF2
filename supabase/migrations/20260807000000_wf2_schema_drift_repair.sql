-- 20260819000000_wf2_schema_drift_repair.sql
SET statement_timeout = '0';

ALTER TABLE staging.listings
  ADD COLUMN IF NOT EXISTS review_count             integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS group_count              integer,
  ADD COLUMN IF NOT EXISTS front_image              text,
  ADD COLUMN IF NOT EXISTS mime_type                text,
  ADD COLUMN IF NOT EXISTS media_fingerprint        text,
  ADD COLUMN IF NOT EXISTS batch_id                 uuid,
  ADD COLUMN IF NOT EXISTS has_exact_source_image   boolean,
  ADD COLUMN IF NOT EXISTS source_image_preserved   boolean,
  ADD COLUMN IF NOT EXISTS image_url_resolvable     boolean,
  ADD COLUMN IF NOT EXISTS visually_verified        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_provenance         jsonb,
  ADD COLUMN IF NOT EXISTS attachment_keys          jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS storage_key              text,
  ADD COLUMN IF NOT EXISTS wts_post_count           integer,
  ADD COLUMN IF NOT EXISTS wtb_post_count           integer,
  ADD COLUMN IF NOT EXISTS transport_checksum       text,
  ADD COLUMN IF NOT EXISTS seller_item_signature    text,
  ADD COLUMN IF NOT EXISTS listing_event_signature  text;


-- Preemptively drop views that later migrations re-create with changed column types
-- (CREATE OR REPLACE VIEW cannot change a column's type; a clean drop lets the
--  later migration define it fresh. Runs before the first dependent migration.)
DROP VIEW IF EXISTS public.reviewed_workbook_market_source_v2 CASCADE;
DROP VIEW IF EXISTS public.qnsa_three_brand_trading_floor_fx_contract CASCADE;
DROP VIEW IF EXISTS public.qnsa_three_brand_price_research_fx_contract CASCADE;
