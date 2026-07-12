-- Trading Floor performance indexes
-- Apply in Supabase SQL Editor during a quiet period. These statements are safe
-- to run repeatedly, but CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Verify the live table has the listed columns before applying.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_created_at_desc
  ON public.watch_records (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_listing_type_created_at_desc
  ON public.watch_records (listing_type, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_brand_trgm
  ON public.watch_records USING GIN (brand gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_reference_trgm
  ON public.watch_records USING GIN (reference gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_raw_message_trgm
  ON public.watch_records USING GIN (raw_message gin_trgm_ops);

ANALYZE public.watch_records;
