-- =============================================================================
-- WF2 / Curated Luxury — Ocean Digital PostgreSQL clean schema + RPC bootstrap
-- Target: 157.245.84.14:5432/watchfacts  (the COPY — never touch live Supabase)
-- Auth:   wf_power (schema + data)
--
-- This file MERGES the three authoritative WF2 migrations into one clean,
-- plain-Postgres build. It drops all Supabase-specific RLS / service_role /
-- anon / authenticated references (those roles do not exist in vanilla PG).
--
-- Sources merged (in dependency order):
--   20260806090000_permanent_ingestion_pipeline.sql          (schemas + staging.listings + UI views)
--   20260810104500_self_contained_immutable_mariadb_raw_import.sql  (raw immutable + 2 RPCs)
--   20260811120000_mariadb_normalized_staging_import.sql      (staging checkpoints + 2 RPCs)
--   20260812010000_dated_fx_normalized_staging_transport.sql  (v2 batch + price correction)
--
-- Idempotent: safe to re-run. Adds missing columns via ADD COLUMN IF NOT EXISTS.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- SCHEMAS
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS jobs;
CREATE SCHEMA IF NOT EXISTS staging;

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'processing_status' AND typnamespace = 'jobs'::regnamespace) THEN
        CREATE TYPE jobs.processing_status AS ENUM (
            'received', 'queued', 'processing', 'extracted', 'normalized',
            'validated', 'approved', 'needs_review', 'duplicate',
            'incomplete', 'rejected', 'failed', 'ignored'
        );
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- RAW PAYLOADS (immutable source log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.payloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_platform VARCHAR(50) NOT NULL,
    source_group_id VARCHAR(100),
    source_group_name VARCHAR(255),
    source_message_id VARCHAR(100) NOT NULL,
    source_sender_id VARCHAR(100),
    source_sender_name VARCHAR(255),
    original_message_text TEXT NOT NULL,
    original_timestamp TIMESTAMPTZ NOT NULL,
    bring_metadata JSONB,
    attachment_metadata JSONB,
    original_image_references TEXT[],
    do_object_key TEXT,
    payload_checksum VARCHAR(64) NOT NULL,
    record_version VARCHAR(20) DEFAULT '1.0',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_source_message UNIQUE (source_platform, source_group_id, source_message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_payloads_checksum ON raw.payloads(payload_checksum);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_message_lookup ON raw.payloads(source_platform, source_group_id, source_message_id);

-- ---------------------------------------------------------------------------
-- JOBS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs.processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_payload_id UUID REFERENCES raw.payloads(id) ON DELETE CASCADE,
    status jobs.processing_status DEFAULT 'received',
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 5,
    last_attempt_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    error_code VARCHAR(100),
    error_details TEXT,
    worker_id VARCHAR(100),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    schema_version VARCHAR(20) DEFAULT '1.0',
    extraction_version VARCHAR(20) DEFAULT '1.0',
    normalization_version VARCHAR(20) DEFAULT '1.0',
    validation_version VARCHAR(20) DEFAULT '1.0',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs.processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_next_retry ON jobs.processing_jobs(next_retry_at) WHERE status = 'queued';

-- ---------------------------------------------------------------------------
-- STAGING.LISTINGS (canonical)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging.listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs.processing_jobs(id) ON DELETE SET NULL,
    parent_id UUID REFERENCES staging.listings(id) ON DELETE CASCADE,
    bundle_position INT,
    raw_message_text TEXT NOT NULL,
    category VARCHAR(30) DEFAULT 'WATCH',
    intent VARCHAR(20) DEFAULT 'WTS',
    listing_type VARCHAR(20) DEFAULT 'SINGLE',
    is_bundle BOOLEAN DEFAULT FALSE,
    brand_original VARCHAR(100),
    brand_normalized VARCHAR(100),
    model_original VARCHAR(100),
    model_normalized VARCHAR(100),
    reference_original VARCHAR(100),
    reference_normalized VARCHAR(100),
    dial_color_original VARCHAR(50),
    dial_color_normalized VARCHAR(50),
    dial_color_source VARCHAR(20) DEFAULT 'parsed',
    price_original NUMERIC(15, 2),
    currency_original VARCHAR(10),
    price_normalized NUMERIC(15, 2),
    currency_normalized VARCHAR(10),
    price_usd NUMERIC(15, 2),
    conversion_rate NUMERIC(15, 6),
    conversion_timestamp TIMESTAMPTZ,
    conversion_source TEXT,
    reserve_price NUMERIC(15, 2),
    price_min NUMERIC(15, 2),
    price_max NUMERIC(15, 2),
    price_avg NUMERIC(15, 2),
    price_split_required BOOLEAN DEFAULT FALSE,
    price_history JSONB,
    condition_original VARCHAR(50),
    condition_normalized VARCHAR(50),
    box_original VARCHAR(20),
    box_normalized VARCHAR(10),
    papers_original VARCHAR(20),
    papers_normalized VARCHAR(10),
    image_url TEXT,
    report_url TEXT,
    user_name VARCHAR(150),
    from_name VARCHAR(150),
    contact_number VARCHAR(50),
    from_number VARCHAR(50),
    phone_code VARCHAR(10),
    location VARCHAR(100),
    rating NUMERIC(5,2),
    dealer_rating NUMERIC(5,2),
    is_verified_user BOOLEAN DEFAULT FALSE,
    is_paid_user BOOLEAN DEFAULT FALSE,
    is_seller_approved BOOLEAN DEFAULT FALSE,
    company_id INT,
    contact_consent BOOLEAN DEFAULT FALSE,
    catalog_confirmed BOOLEAN DEFAULT FALSE,
    catalog_canonical_confirmed BOOLEAN DEFAULT FALSE,
    are_attributes_extracted BOOLEAN DEFAULT FALSE,
    identification_status VARCHAR(30),
    wf_inspection BOOLEAN DEFAULT FALSE,
    times_posted INT DEFAULT 1,
    first_posted_at TIMESTAMPTZ,
    reposted_at TIMESTAMPTZ,
    overall_confidence NUMERIC(5,2),
    provenance_metadata JSONB,
    confidence_metrics JSONB,
    validation_errors TEXT[],
    verdict VARCHAR(20) DEFAULT 'approved',
    normalization_status VARCHAR(30) DEFAULT 'normalized',
    trading_floor_status VARCHAR(40) DEFAULT 'published',
    price_research_status VARCHAR(40) DEFAULT 'eligible',
    -- 20260811120000 additions
    normalization_run_key TEXT,
    source_record_id TEXT,
    raw_message_version_id UUID REFERENCES public.raw_message_versions(id) ON DELETE RESTRICT,
    source_hash TEXT,
    source_candidate_hash TEXT,
    currency_evidence TEXT,
    source_posted_at_text TEXT,
    source_media_key TEXT,
    source_media_url_candidate TEXT,
    public_image_eligible BOOLEAN NOT NULL DEFAULT false,
    publication_review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staging_brand_ref ON staging.listings(brand_normalized, reference_normalized);
CREATE INDEX IF NOT EXISTS idx_staging_intent ON staging.listings(intent);
CREATE INDEX IF NOT EXISTS idx_staging_category ON staging.listings(category);
CREATE INDEX IF NOT EXISTS idx_staging_listing_type ON staging.listings(listing_type);
CREATE INDEX IF NOT EXISTS idx_staging_tf_status ON staging.listings(trading_floor_status);
CREATE INDEX IF NOT EXISTS idx_staging_pr_status ON staging.listings(price_research_status);
CREATE INDEX IF NOT EXISTS idx_staging_norm_status ON staging.listings(normalization_status);
CREATE INDEX IF NOT EXISTS idx_staging_contact ON staging.listings(contact_number);
CREATE INDEX IF NOT EXISTS idx_staging_job_id ON staging.listings(job_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staging_mariadb_run_source
  ON staging.listings (normalization_run_key, source_record_id)
  WHERE normalization_run_key IS NOT NULL AND source_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staging_mariadb_raw_version
  ON staging.listings (raw_message_version_id)
  WHERE raw_message_version_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RECONCILIATION LEDGER
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs.reconciliation_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_timestamp TIMESTAMPTZ DEFAULT NOW(),
    raw_parents_count INT DEFAULT 0,
    bundle_parents_count INT DEFAULT 0,
    child_listings_count INT DEFAULT 0,
    duplicates_count INT DEFAULT 0,
    failed_jobs_count INT DEFAULT 0,
    priced_count INT DEFAULT 0,
    no_price_count INT DEFAULT 0,
    watches_count INT DEFAULT 0,
    non_watches_count INT DEFAULT 0,
    pr_eligible_count INT DEFAULT 0,
    pr_provisional_count INT DEFAULT 0,
    pr_ineligible_count INT DEFAULT 0,
    reconciliation_details JSONB,
    completed_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- IMMUTABLE MARIADB RAW CAUPLETE (20260810104500, self-contained)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.raw_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_message_id TEXT,
  sender_phone TEXT,
  group_id TEXT,
  source_platform TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_text TEXT NOT NULL,
  raw_payload JSONB,
  media_count INTEGER NOT NULL DEFAULT 0,
  processing_status TEXT NOT NULL DEFAULT 'PENDING',
  parser_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_messages_external_identity
  ON public.raw_messages (source_platform, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.raw_message_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_message_id UUID NOT NULL REFERENCES public.raw_messages(id) ON DELETE RESTRICT,
  source_record_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_created_on TEXT,
  source_updated_on TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  raw_message_source TEXT,
  raw_text TEXT,
  raw_payload JSONB NOT NULL,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT raw_message_versions_identity UNIQUE (raw_message_id, source_hash)
);
CREATE INDEX IF NOT EXISTS idx_raw_message_versions_source_record
  ON public.raw_message_versions (source_record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mariadb_raw_import_checkpoints (
  run_key TEXT PRIMARY KEY,
  contract TEXT NOT NULL,
  last_created_on TEXT NOT NULL,
  last_source_id TEXT NOT NULL,
  input_rows BIGINT NOT NULL DEFAULT 0,
  envelope_rows_inserted BIGINT NOT NULL DEFAULT 0,
  version_rows_inserted BIGINT NOT NULL DEFAULT 0,
  version_rows_existing BIGINT NOT NULL DEFAULT 0,
  error_rows BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COPYING_RAW',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.mariadb_raw_import_batches (
  batch_token TEXT PRIMARY KEY CHECK (batch_token ~ '^[0-9a-f]{64}$'),
  run_key TEXT NOT NULL REFERENCES public.mariadb_raw_import_checkpoints(run_key) ON DELETE RESTRICT,
  first_source_id TEXT,
  last_source_id TEXT,
  source_rows INTEGER NOT NULL CHECK (source_rows >= 0),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- STAGING NORMALIZATION CHECKPOINTS (20260811120000)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging.mariadb_normalization_import_checkpoints (
  run_key TEXT PRIMARY KEY,
  normalization_contract TEXT NOT NULL,
  raw_import_run_key TEXT NOT NULL REFERENCES public.mariadb_raw_import_checkpoints(run_key) ON DELETE RESTRICT,
  input_fingerprint TEXT NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  input_rows BIGINT NOT NULL DEFAULT 0,
  staged_rows BIGINT NOT NULL DEFAULT 0,
  existing_rows BIGINT NOT NULL DEFAULT 0,
  deferred_rows BIGINT NOT NULL DEFAULT 0,
  error_rows BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'STAGING_NORMALIZATION',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (status IN ('STAGING_NORMALIZATION', 'NORMALIZATION_STAGED'))
);

CREATE TABLE IF NOT EXISTS staging.mariadb_normalization_import_batches (
  batch_token TEXT PRIMARY KEY CHECK (batch_token ~ '^[0-9a-f]{64}$'),
  run_key TEXT NOT NULL REFERENCES staging.mariadb_normalization_import_checkpoints(run_key) ON DELETE RESTRICT,
  first_source_record_id TEXT,
  last_source_record_id TEXT,
  source_rows INTEGER NOT NULL CHECK (source_rows >= 0),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staging.mariadb_price_policy_correction_batches (
  batch_token TEXT PRIMARY KEY CHECK (batch_token ~ '^[0-9a-f]{64}$'),
  run_key TEXT NOT NULL REFERENCES staging.mariadb_normalization_import_checkpoints(run_key) ON DELETE RESTRICT,
  source_rows INTEGER NOT NULL CHECK (source_rows BETWEEN 1 AND 500),
  corrected_rows INTEGER NOT NULL CHECK (corrected_rows >= 0),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staging.mariadb_price_policy_correction_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_token TEXT NOT NULL REFERENCES staging.mariadb_price_policy_correction_batches(batch_token) ON DELETE RESTRICT,
  listing_id UUID NOT NULL REFERENCES staging.listings(id) ON DELETE RESTRICT,
  run_key TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  previous_price JSONB NOT NULL,
  corrected_price JSONB NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_token, listing_id)
);

-- ---------------------------------------------------------------------------
-- RPC 1: ingest_mariadb_raw_batch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_mariadb_raw_batch(
  p_run_key TEXT,
  p_batch_token TEXT,
  p_contract TEXT,
  p_expected_last_created_on TEXT,
  p_expected_last_source_id TEXT,
  p_next_last_created_on TEXT,
  p_next_last_source_id TEXT,
  p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_record JSONB;
  v_raw_data JSONB;
  v_raw_message_id UUID;
  v_inserted_id UUID;
  v_existing_result JSONB;
  v_input_rows INTEGER := 0;
  v_envelopes_inserted INTEGER := 0;
  v_versions_inserted INTEGER := 0;
  v_versions_existing INTEGER := 0;
  v_result JSONB;
BEGIN
  IF p_run_key IS NULL OR btrim(p_run_key) = '' THEN
    RAISE EXCEPTION 'run_key is required';
  END IF;
  IF p_batch_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'batch_token must be a lowercase SHA-256 digest';
  END IF;
  IF p_contract <> 'wf-mariadb-auctions-raw-v1' THEN
    RAISE EXCEPTION 'unsupported raw import contract: %', p_contract;
  END IF;
  IF jsonb_typeof(p_records) <> 'array' THEN
    RAISE EXCEPTION 'records must be a JSON array';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('mariadb_raw_import:' || p_run_key));

  SELECT result INTO v_existing_result
  FROM public.mariadb_raw_import_batches
  WHERE batch_token = p_batch_token;
  IF FOUND THEN
    RETURN v_existing_result || jsonb_build_object('idempotent_replay', true);
  END IF;

  INSERT INTO public.mariadb_raw_import_checkpoints (
    run_key, contract, last_created_on, last_source_id
  ) VALUES (
    p_run_key, p_contract, p_expected_last_created_on, p_expected_last_source_id
  )
  ON CONFLICT (run_key) DO NOTHING;

  PERFORM 1
  FROM public.mariadb_raw_import_checkpoints
  WHERE run_key = p_run_key
    AND contract = p_contract
    AND last_created_on = p_expected_last_created_on
    AND last_source_id = p_expected_last_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or incompatible raw-import checkpoint for run %', p_run_key;
  END IF;

  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records)
  LOOP
    v_input_rows := v_input_rows + 1;
    IF v_record->>'contract' <> p_contract THEN
      RAISE EXCEPTION 'record % has an incompatible contract', v_input_rows;
    END IF;
    IF COALESCE(v_record->>'source_record_id', '') = '' THEN
      RAISE EXCEPTION 'record % is missing source_record_id', v_input_rows;
    END IF;
    IF COALESCE(v_record->>'raw_sha256', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'record % has an invalid raw_sha256', v_input_rows;
    END IF;

    v_raw_data := COALESCE(v_record->'raw_data', '{}'::jsonb);
    v_inserted_id := NULL;

    INSERT INTO public.raw_messages (
      external_message_id, sender_phone, group_id, source_platform, received_at,
      raw_text, raw_payload, media_count, processing_status, parser_version
    ) VALUES (
      v_record->>'source_record_id',
      v_raw_data->>'from_number',
      v_raw_data->>'region',
      'mariadb',
      COALESCE((v_record->>'observed_at')::timestamptz, now()),
      COALESCE(v_record->>'raw_message', ''),
      v_record,
      CASE WHEN NULLIF(v_raw_data->>'front_image', '') IS NULL THEN 0 ELSE 1 END,
      'COPIED_RAW',
      NULL
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NOT NULL THEN
      v_envelopes_inserted := v_envelopes_inserted + 1;
      v_raw_message_id := v_inserted_id;
    ELSE
      SELECT id INTO v_raw_message_id
      FROM public.raw_messages
      WHERE source_platform = 'mariadb'
        AND external_message_id = v_record->>'source_record_id';
    END IF;

    IF v_raw_message_id IS NULL THEN
      RAISE EXCEPTION 'record % could not resolve its immutable raw envelope', v_input_rows;
    END IF;

    v_inserted_id := NULL;
    INSERT INTO public.raw_message_versions (
      raw_message_id, source_record_id, source_hash, source_created_on,
      source_updated_on, observed_at, raw_message_source, raw_text, raw_payload, media
    ) VALUES (
      v_raw_message_id,
      v_record->>'source_record_id',
      v_record->>'raw_sha256',
      v_record->>'source_created_on',
      v_raw_data->>'updated_on',
      (v_record->>'observed_at')::timestamptz,
      v_record->>'raw_message_source',
      v_record->>'raw_message',
      v_record,
      CASE
        WHEN NULLIF(v_raw_data->>'front_image', '') IS NULL THEN '[]'::jsonb
        ELSE jsonb_build_array(jsonb_build_object(
          'source_key', v_raw_data->>'front_image',
          'relationship', 'source_record_media',
          'verified_for_child_listing', false
        ))
      END
    )
    ON CONFLICT (raw_message_id, source_hash) DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NULL THEN
      v_versions_existing := v_versions_existing + 1;
    ELSE
      v_versions_inserted := v_versions_inserted + 1;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'run_key', p_run_key,
    'batch_token', p_batch_token,
    'input_rows', v_input_rows,
    'envelope_rows_inserted', v_envelopes_inserted,
    'version_rows_inserted', v_versions_inserted,
    'version_rows_existing', v_versions_existing,
    'error_rows', 0,
    'last_created_on', p_next_last_created_on,
    'last_source_id', p_next_last_source_id,
    'watch_records_writes', 0,
    'normalization_writes', 0,
    'idempotent_replay', false
  );

  INSERT INTO public.mariadb_raw_import_batches (
    batch_token, run_key, first_source_id, last_source_id, source_rows, result
  ) VALUES (
    p_batch_token, p_run_key,
    p_records->0->>'source_record_id',
    p_next_last_source_id,
    v_input_rows,
    v_result
  );

  UPDATE public.mariadb_raw_import_checkpoints
  SET last_created_on = p_next_last_created_on,
      last_source_id = p_next_last_source_id,
      input_rows = input_rows + v_input_rows,
      envelope_rows_inserted = envelope_rows_inserted + v_envelopes_inserted,
      version_rows_inserted = version_rows_inserted + v_versions_inserted,
      version_rows_existing = version_rows_existing + v_versions_existing,
      updated_at = now()
  WHERE run_key = p_run_key;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC 2: complete_mariadb_raw_import
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_mariadb_raw_import(
  p_run_key TEXT,
  p_expected_rows BIGINT,
  p_expected_last_created_on TEXT,
  p_expected_last_source_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_checkpoint public.mariadb_raw_import_checkpoints%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mariadb_raw_import:' || p_run_key));
  SELECT * INTO v_checkpoint
  FROM public.mariadb_raw_import_checkpoints
  WHERE run_key = p_run_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'raw-import checkpoint does not exist for run %', p_run_key;
  END IF;
  IF v_checkpoint.input_rows <> p_expected_rows
    OR v_checkpoint.last_created_on <> p_expected_last_created_on
    OR v_checkpoint.last_source_id <> p_expected_last_source_id THEN
    RAISE EXCEPTION 'raw-import completion does not reconcile for run %', p_run_key;
  END IF;
  IF v_checkpoint.input_rows
      <> v_checkpoint.version_rows_inserted + v_checkpoint.version_rows_existing
    OR v_checkpoint.error_rows <> 0 THEN
    RAISE EXCEPTION 'raw-import version counts do not reconcile for run %', p_run_key;
  END IF;

  UPDATE public.mariadb_raw_import_checkpoints
  SET status = 'RAW_COPY_COMPLETE', completed_at = now(), updated_at = now()
  WHERE run_key = p_run_key
  RETURNING * INTO v_checkpoint;

  RETURN jsonb_build_object(
    'run_key', v_checkpoint.run_key,
    'status', v_checkpoint.status,
    'input_rows', v_checkpoint.input_rows,
    'envelope_rows_inserted', v_checkpoint.envelope_rows_inserted,
    'version_rows_inserted', v_checkpoint.version_rows_inserted,
    'version_rows_existing', v_checkpoint.version_rows_existing,
    'error_rows', v_checkpoint.error_rows,
    'last_created_on', v_checkpoint.last_created_on,
    'last_source_id', v_checkpoint.last_source_id,
    'watch_records_writes', 0,
    'normalization_writes', 0
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC 3: ingest_mariadb_normalization_batch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_mariadb_normalization_batch(
  p_run_key TEXT,
  p_raw_import_run_key TEXT,
  p_contract TEXT,
  p_input_fingerprint TEXT,
  p_batch_token TEXT,
  p_expected_input_rows BIGINT,
  p_next_input_rows BIGINT,
  p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_record JSONB;
  v_candidate JSONB;
  v_version public.raw_message_versions%ROWTYPE;
  v_existing_result JSONB;
  v_listing_id UUID;
  v_price_original NUMERIC;
  v_price_usd NUMERIC;
  v_currency TEXT;
  v_input_rows INTEGER := 0;
  v_staged_rows INTEGER := 0;
  v_existing_rows INTEGER := 0;
  v_deferred_rows INTEGER := 0;
  v_result JSONB;
BEGIN
  IF COALESCE(btrim(p_run_key), '') = '' OR COALESCE(btrim(p_raw_import_run_key), '') = '' THEN
    RAISE EXCEPTION 'run_key and raw_import_run_key are required';
  END IF;
  IF p_contract <> 'wf-mariadb-normalized-staging-v1' THEN
    RAISE EXCEPTION 'unsupported normalization staging contract';
  END IF;
  IF p_input_fingerprint !~ '^[0-9a-f]{64}$' OR p_batch_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid input fingerprint or batch token';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'p_records must contain between 1 and 500 records';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('mariadb_normalization_import:' || p_run_key));

  SELECT result INTO v_existing_result
  FROM staging.mariadb_normalization_import_batches
  WHERE batch_token = p_batch_token;
  IF FOUND THEN
    IF v_existing_result->>'run_key' IS DISTINCT FROM p_run_key THEN
      RAISE EXCEPTION 'batch token belongs to another normalization run';
    END IF;
    RETURN v_existing_result;
  END IF;

  PERFORM 1
  FROM public.mariadb_raw_import_checkpoints
  WHERE run_key = p_raw_import_run_key
    AND status = 'RAW_COPY_COMPLETE'
    AND error_rows = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'immutable raw import is not complete and reconciled';
  END IF;

  INSERT INTO staging.mariadb_normalization_import_checkpoints (
    run_key, normalization_contract, raw_import_run_key, input_fingerprint
  ) VALUES (
    p_run_key, p_contract, p_raw_import_run_key, p_input_fingerprint
  )
  ON CONFLICT (run_key) DO NOTHING;

  PERFORM 1
  FROM staging.mariadb_normalization_import_checkpoints
  WHERE run_key = p_run_key
    AND normalization_contract = p_contract
    AND raw_import_run_key = p_raw_import_run_key
    AND input_fingerprint = p_input_fingerprint
    AND input_rows = p_expected_input_rows
    AND status = 'STAGING_NORMALIZATION'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or incompatible normalization staging checkpoint';
  END IF;

  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records)
  LOOP
    v_input_rows := v_input_rows + 1;
    IF v_record ?| ARRAY['raw_message', 'raw_payload', 'seller_phone', 'phone', 'contact_number'] THEN
      RAISE EXCEPTION 'record % contains prohibited duplicated raw or private contact data', v_input_rows;
    END IF;
    IF COALESCE(v_record->>'source_record_id', '') = ''
      OR COALESCE(v_record->>'source_hash', '') !~ '^[0-9a-f]{64}$'
      OR COALESCE(v_record->>'source_candidate_hash', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'record % has invalid source lineage', v_input_rows;
    END IF;
    IF v_record->>'materialization' NOT IN ('SINGLE', 'DEFERRED') THEN
      RAISE EXCEPTION 'record % has invalid materialization', v_input_rows;
    END IF;

    SELECT version.* INTO v_version
    FROM public.raw_message_versions AS version
    WHERE version.source_record_id = v_record->>'source_record_id'
      AND version.source_hash = v_record->>'source_hash'
    ORDER BY version.created_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'record % cannot resolve exact immutable raw-version lineage', v_input_rows;
    END IF;

    IF v_record->>'materialization' = 'DEFERRED' THEN
      v_deferred_rows := v_deferred_rows + 1;
      CONTINUE;
    END IF;

    v_candidate := COALESCE(v_record->'candidate', '{}'::jsonb);
    IF COALESCE(v_candidate->>'listing_type', '') NOT IN ('WTS', 'WTB')
      OR COALESCE(v_record->>'category', '') NOT IN ('WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY') THEN
      RAISE EXCEPTION 'record % is not an eligible single public-category candidate', v_input_rows;
    END IF;
    IF COALESCE(v_record->>'bundle_status', '') <> 'SINGLE_CANDIDATE' THEN
      RAISE EXCEPTION 'record % attempts to materialize a bundle', v_input_rows;
    END IF;
    IF COALESCE((v_record->>'public_image_eligible')::boolean, false) THEN
      RAISE EXCEPTION 'record % attempts to auto-publish an unreviewed image', v_input_rows;
    END IF;

    v_price_original := CASE
      WHEN COALESCE(v_candidate#>>'{price,amount_original}', '') ~ '^\d+(\.\d+)?$'
      THEN (v_candidate#>>'{price,amount_original}')::numeric
      ELSE NULL
    END;
    v_currency := NULLIF(upper(btrim(v_candidate#>>'{price,currency_original}')), '');
    v_price_usd := CASE
      WHEN v_currency IN ('USD', 'USDT')
        AND COALESCE(v_candidate#>>'{price,amount_usd}', '') ~ '^\d+(\.\d+)?$'
      THEN (v_candidate#>>'{price,amount_usd}')::numeric
      ELSE NULL
    END;

    v_listing_id := NULL;
    INSERT INTO staging.listings (
      id, normalization_run_key, source_record_id, raw_message_version_id, source_hash,
      source_candidate_hash, raw_message_text, category, intent, listing_type, is_bundle,
      brand_original, brand_normalized, model_original, model_normalized,
      reference_original, reference_normalized, dial_color_original, dial_color_normalized,
      price_original, price_normalized, price_usd, currency_original, currency_normalized,
      currency_evidence, condition_original, condition_normalized, image_url,
      source_media_key, source_media_url_candidate, public_image_eligible,
      user_name, from_name, location, rating, dealer_rating, contact_consent,
      catalog_confirmed, catalog_canonical_confirmed, are_attributes_extracted,
      identification_status, verdict, normalization_status, trading_floor_status,
      price_research_status, overall_confidence, publication_review_status,
      source_posted_at_text, provenance_metadata
    ) VALUES (
      gen_random_uuid(), p_run_key, v_record->>'source_record_id', v_version.id,
      v_record->>'source_hash', v_record->>'source_candidate_hash', COALESCE(v_version.raw_text, ''),
      v_record->>'category', v_candidate->>'listing_type', v_candidate->>'listing_type', false,
      left(v_candidate->>'brand', 100), left(v_candidate->>'brand', 100),
      left(v_candidate->>'model', 100), left(v_candidate->>'model', 100),
      left(v_candidate->>'reference', 100), left(v_candidate->>'reference', 100),
      left(v_candidate->>'dial_color', 50), left(v_candidate->>'dial_color', 50),
      v_price_original, v_price_original, v_price_usd, v_currency, v_currency,
      v_candidate#>>'{price,currency_evidence}',
      left(v_candidate->>'condition', 50), left(v_candidate->>'condition', 50), NULL,
      v_record#>>'{media,source_media_key}', v_record#>>'{media,source_media_url_candidate}', false,
      left(v_record#>>'{seller_public,name}', 150), left(v_record#>>'{seller_public,name}', 150),
      left(v_record#>>'{seller_public,location}', 100), NULL, NULL, false,
      COALESCE((v_record->>'catalog_confirmed')::boolean, false),
      COALESCE((v_record->>'catalog_confirmed')::boolean, false), true,
      CASE WHEN v_record->>'category' = 'WATCH' THEN 'pending_verification' ELSE 'classified_non_watch' END,
      'pending',
      CASE WHEN v_record->>'review_disposition' = 'READY_FOR_HUMAN_APPROVAL' THEN 'normalized' ELSE 'needs_review' END,
      'published_pending_verification',
      CASE
        WHEN v_candidate->>'listing_type' = 'WTB' THEN 'demand_pending_human_approval'
        WHEN v_record->>'price_research_status' = 'SALE_PENDING_HUMAN_APPROVAL' THEN 'provisional_needs_review'
        ELSE lower(v_record->>'price_research_status')
      END,
      NULL, 'PENDING_REVIEW', v_record->>'source_created_on',
      jsonb_build_object(
        'contract', p_contract,
        'normalization_version', v_record->>'normalization_version',
        'review_disposition', v_record->>'review_disposition',
        'review_reasons', COALESCE(v_record->'review_reasons', '[]'::jsonb),
        'bundle_status', v_record->>'bundle_status',
        'exact_raw_version_lineage', true,
        'contact_publication_approved', false,
        'rating_publication_status', 'UNVERIFIED_SOURCE_FIELD',
        'source_field_overflow', jsonb_strip_nulls(jsonb_build_object(
          'brand', CASE WHEN length(v_candidate->>'brand') > 100 THEN v_candidate->>'brand' END,
          'model', CASE WHEN length(v_candidate->>'model') > 100 THEN v_candidate->>'model' END,
          'reference', CASE WHEN length(v_candidate->>'reference') > 100 THEN v_candidate->>'reference' END,
          'dial_color', CASE WHEN length(v_candidate->>'dial_color') > 50 THEN v_candidate->>'dial_color' END,
          'condition', CASE WHEN length(v_candidate->>'condition') > 50 THEN v_candidate->>'condition' END,
          'seller_name', CASE WHEN length(v_record#>>'{seller_public,name}') > 150 THEN v_record#>>'{seller_public,name}' END,
          'seller_location', CASE WHEN length(v_record#>>'{seller_public,location}') > 100 THEN v_record#>>'{seller_public,location}' END
        ))
      )
    )
    ON CONFLICT (normalization_run_key, source_record_id)
      WHERE normalization_run_key IS NOT NULL AND source_record_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_listing_id;

    IF v_listing_id IS NULL THEN
      PERFORM 1 FROM staging.listings
      WHERE normalization_run_key = p_run_key
        AND source_record_id = v_record->>'source_record_id'
        AND source_hash = v_record->>'source_hash'
        AND source_candidate_hash = v_record->>'source_candidate_hash'
        AND raw_message_version_id = v_version.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'record % conflicts with previously staged lineage', v_input_rows;
      END IF;
      v_existing_rows := v_existing_rows + 1;
    ELSE
      v_staged_rows := v_staged_rows + 1;
    END IF;
  END LOOP;

  IF p_next_input_rows <> p_expected_input_rows + v_input_rows THEN
    RAISE EXCEPTION 'next input row count does not reconcile';
  END IF;

  v_result := jsonb_build_object(
    'run_key', p_run_key,
    'input_rows', v_input_rows,
    'staged_rows', v_staged_rows,
    'existing_rows', v_existing_rows,
    'deferred_rows', v_deferred_rows,
    'error_rows', 0,
    'next_input_rows', p_next_input_rows,
    'first_source_record_id', p_records->0->>'source_record_id',
    'last_source_record_id', p_records->(jsonb_array_length(p_records) - 1)->>'source_record_id',
    'publication_writes', 0
  );

  INSERT INTO staging.mariadb_normalization_import_batches (
    batch_token, run_key, first_source_record_id, last_source_record_id, source_rows, result
  ) VALUES (
    p_batch_token, p_run_key, v_result->>'first_source_record_id',
    v_result->>'last_source_record_id', v_input_rows, v_result
  );

  UPDATE staging.mariadb_normalization_import_checkpoints
  SET input_rows = p_next_input_rows,
      staged_rows = staged_rows + v_staged_rows,
      existing_rows = existing_rows + v_existing_rows,
      deferred_rows = deferred_rows + v_deferred_rows,
      updated_at = now()
  WHERE run_key = p_run_key;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC 4: complete_mariadb_normalization_import
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_mariadb_normalization_import(
  p_run_key TEXT,
  p_expected_rows BIGINT,
  p_expected_staged_or_existing BIGINT,
  p_expected_deferred BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_checkpoint staging.mariadb_normalization_import_checkpoints%ROWTYPE;
  v_materialized BIGINT;
  v_result JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mariadb_normalization_import:' || p_run_key));
  SELECT * INTO v_checkpoint
  FROM staging.mariadb_normalization_import_checkpoints
  WHERE run_key = p_run_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'normalization staging checkpoint does not exist'; END IF;

  SELECT count(*) INTO v_materialized
  FROM staging.listings
  WHERE normalization_run_key = p_run_key;

  IF v_checkpoint.input_rows <> p_expected_rows
    OR v_checkpoint.error_rows <> 0
    OR v_checkpoint.staged_rows + v_checkpoint.existing_rows <> p_expected_staged_or_existing
    OR v_checkpoint.deferred_rows <> p_expected_deferred
    OR p_expected_staged_or_existing + p_expected_deferred <> p_expected_rows
    OR v_materialized <> p_expected_staged_or_existing THEN
    RAISE EXCEPTION 'normalization staging completion did not reconcile';
  END IF;

  UPDATE staging.mariadb_normalization_import_checkpoints
  SET status = 'NORMALIZATION_STAGED', completed_at = now(), updated_at = now()
  WHERE run_key = p_run_key;

  v_result := jsonb_build_object(
    'run_key', p_run_key,
    'status', 'NORMALIZATION_STAGED',
    'input_rows', p_expected_rows,
    'materialized_rows', v_materialized,
    'deferred_rows', p_expected_deferred,
    'error_rows', 0,
    'publication_writes', 0
  );
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC 3b: ingest_mariadb_normalization_batch_v2 (dated FX transport wrapper)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_mariadb_normalization_batch_v2(
  p_run_key TEXT,
  p_raw_import_run_key TEXT,
  p_contract TEXT,
  p_input_fingerprint TEXT,
  p_batch_token TEXT,
  p_expected_input_rows BIGINT,
  p_next_input_rows BIGINT,
  p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_result JSONB;
  v_invalid_count BIGINT;
  v_updated_count BIGINT;
BEGIN
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'p_records must contain between 1 and 500 records';
  END IF;

  WITH prices AS (
    SELECT
      record->>'materialization' AS materialization,
      upper(NULLIF(btrim(record#>>'{candidate,price,currency_original}'), '')) AS currency,
      NULLIF(record#>>'{candidate,price,amount_original}', '')::numeric AS amount_original,
      NULLIF(record#>>'{candidate,price,amount_usd}', '')::numeric AS amount_usd,
      NULLIF(record#>>'{candidate,price,conversion_rate}', '')::numeric AS conversion_rate,
      NULLIF(record#>>'{candidate,price,conversion_timestamp}', '')::timestamptz AS conversion_timestamp,
      NULLIF(btrim(record#>>'{candidate,price,conversion_source}'), '') AS conversion_source,
      NULLIF(btrim(record#>>'{candidate,price,currency_evidence}'), '') AS currency_evidence
    FROM jsonb_array_elements(p_records) AS record
    WHERE record->>'materialization' = 'SINGLE'
      AND record#>>'{candidate,price,amount_original}' IS NOT NULL
  )
  SELECT count(*) INTO v_invalid_count
  FROM prices
  WHERE amount_original IS NULL OR amount_original <= 0
    OR currency IS NULL
    OR (
      currency IN ('USD', 'USDT')
      AND (
        amount_usd IS NULL OR amount_usd <= 0
        OR conversion_rate IS DISTINCT FROM 1
        OR abs(amount_usd - amount_original) > 0.01
        OR conversion_source IS NULL
        OR (
          currency_evidence = 'usd_defaulted_by_policy'
          AND conversion_source <> 'USD_DEFAULTED_BY_POLICY'
        )
      )
    )
    OR (
      currency NOT IN ('USD', 'USDT')
      AND (
        amount_usd IS NULL OR amount_usd <= 0
        OR conversion_rate IS NULL OR conversion_rate <= 0
        OR conversion_timestamp IS NULL
        OR conversion_source IS NULL
        OR abs(amount_usd - round(amount_original * conversion_rate)) > 1.01
      )
    );
  IF v_invalid_count <> 0 THEN
    RAISE EXCEPTION 'batch contains % invalid or unproven price conversions', v_invalid_count;
  END IF;

  v_result := public.ingest_mariadb_normalization_batch(
    p_run_key,
    p_raw_import_run_key,
    p_contract,
    p_input_fingerprint,
    p_batch_token,
    p_expected_input_rows,
    p_next_input_rows,
    p_records
  );

  WITH transported AS (
    SELECT
      record->>'source_record_id' AS source_record_id,
      upper(NULLIF(btrim(record#>>'{candidate,price,currency_original}'), '')) AS currency,
      NULLIF(record#>>'{candidate,price,amount_usd}', '')::numeric AS amount_usd,
      NULLIF(record#>>'{candidate,price,conversion_rate}', '')::numeric AS conversion_rate,
      NULLIF(record#>>'{candidate,price,conversion_timestamp}', '')::timestamptz AS conversion_timestamp,
      NULLIF(btrim(record#>>'{candidate,price,conversion_source}'), '') AS conversion_source
    FROM jsonb_array_elements(p_records) AS record
    WHERE record->>'materialization' = 'SINGLE'
      AND record#>>'{candidate,price,amount_usd}' IS NOT NULL
  ), updated AS (
    UPDATE staging.listings AS listing
    SET price_usd = transported.amount_usd,
        conversion_rate = transported.conversion_rate,
        conversion_timestamp = CASE
          WHEN transported.currency IN ('USD', 'USDT') THEN NULL
          ELSE transported.conversion_timestamp
        END,
        conversion_source = transported.conversion_source,
        provenance_metadata = COALESCE(listing.provenance_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'conversion_source', transported.conversion_source,
            'conversion_timestamp', transported.conversion_timestamp,
            'conversion_rate', transported.conversion_rate
          )
    FROM transported
    WHERE listing.normalization_run_key = p_run_key
      AND listing.source_record_id = transported.source_record_id
    RETURNING listing.id
  )
  SELECT count(*) INTO v_updated_count FROM updated;

  IF v_updated_count > COALESCE((v_result->>'staged_rows')::bigint, 0)
      + COALESCE((v_result->>'existing_rows')::bigint, 0) THEN
    RAISE EXCEPTION 'FX transport updated more rows than the batch reconciled';
  END IF;

  RETURN v_result || jsonb_build_object('price_provenance_rows', v_updated_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- UI READ VIEWS (queried by /api/reviewed-market-inventory.js and price-research.js)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.reviewed_workbook_market_source_v2 AS
SELECT
    id, job_id, parent_id, bundle_position,
    raw_message_text,
    raw_message_text AS message_text,
    raw_message_text AS description,
    category, intent, listing_type, is_bundle,
    brand_normalized AS brand,
    model_normalized AS model,
    reference_normalized AS reference,
    dial_color_normalized AS dial_color,
    condition_normalized AS condition,
    box_normalized AS box,
    papers_normalized AS papers,
    price_usd AS price,
    price_usd,
    currency_normalized AS currency,
    CASE WHEN price_usd = 0 THEN 'Price not supplied' ELSE NULL END AS price_display_label,
    CASE WHEN parent_id IS NULL THEN image_url ELSE '' END AS image_url,
    COALESCE(from_name, user_name) AS seller_name,
    COALESCE(from_name, user_name) AS from_name,
    COALESCE(from_name, user_name) AS user_name,
    CASE WHEN contact_consent = TRUE THEN COALESCE(from_number, contact_number) ELSE NULL END AS seller_contact,
    CASE WHEN contact_consent = TRUE THEN COALESCE(from_number, contact_number) ELSE NULL END AS contact_number,
    location,
    COALESCE(dealer_rating, rating, 0.0) AS dealer_rating,
    COALESCE(dealer_rating, rating, 0.0) AS rating,
    created_at AS posted_at,
    created_at,
    contact_consent,
    verdict,
    normalization_status,
    trading_floor_status,
    price_research_status
FROM staging.listings
WHERE trading_floor_status IN ('published', 'published_pending_verification', 'bundle_pending_separation');

CREATE OR REPLACE VIEW public.price_research_verified_source AS
SELECT
    id, job_id, parent_id, bundle_position,
    raw_message_text,
    raw_message_text AS message_text,
    raw_message_text AS description,
    category, intent, listing_type, is_bundle,
    brand_normalized AS brand,
    model_normalized AS model,
    reference_normalized AS reference,
    dial_color_normalized AS dial_color,
    condition_normalized AS condition,
    box_normalized AS box,
    papers_normalized AS papers,
    price_usd AS price,
    price_usd,
    currency_normalized AS currency,
    CASE WHEN parent_id IS NULL THEN image_url ELSE '' END AS image_url,
    COALESCE(from_name, user_name) AS seller_name,
    COALESCE(from_name, user_name) AS from_name,
    CASE WHEN contact_consent = TRUE THEN COALESCE(from_number, contact_number) ELSE NULL END AS seller_contact,
    location,
    COALESCE(dealer_rating, rating, 0.0) AS dealer_rating,
    created_at AS line_date,
    created_at,
    overall_confidence,
    contact_consent,
    verdict,
    normalization_status,
    trading_floor_status,
    price_research_status
FROM staging.listings
WHERE price_research_status = 'eligible';

CREATE OR REPLACE VIEW public.trading_floor_view AS SELECT * FROM public.reviewed_workbook_market_source_v2;
CREATE OR REPLACE VIEW public.price_research_view AS SELECT * FROM public.price_research_verified_source;
CREATE OR REPLACE VIEW public.reviewed_workbook_view AS SELECT * FROM public.reviewed_workbook_market_source_v2;

-- ---------------------------------------------------------------------------
-- GRANTS — all to the app roles (no Supabase roles in vanilla PG)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public, raw, jobs, staging TO wf_app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, raw, jobs, staging TO wf_app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, raw, jobs, staging TO wf_app_rw;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO wf_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, raw, jobs, staging GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wf_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, raw, jobs, staging GRANT USAGE, SELECT ON SEQUENCES TO wf_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO wf_app_rw;

COMMIT;
