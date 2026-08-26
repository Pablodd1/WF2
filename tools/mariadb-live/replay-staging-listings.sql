-- Pure-SQL replay: staging.mysql_normalization_proposals -> staging.listings
-- Mirrors supabase/migrations/20260811120000_mariadb_normalized_staging_import.sql
-- but reads directly from proposals (already normalized) joined to raw_message_versions.
-- Idempotent: ON CONFLICT (normalization_run_key, source_record_id) DO NOTHING.

INSERT INTO staging.listings (
  id, normalization_run_key, source_record_id, raw_message_version_id, source_hash,
  source_candidate_hash, raw_message_text, category, intent, listing_type, is_bundle,
  brand_original, brand_normalized, model_original, model_normalized,
  reference_original, reference_normalized, dial_color_original, dial_color_normalized,
  price_original, price_normalized, price_usd, currency_original, currency_normalized,
  currency_evidence, condition_original, condition_normalized, image_url,
  source_media_key, source_media_url_candidate, public_image_eligible,
  user_name, from_name, location, catalog_confirmed, catalog_canonical_confirmed,
  are_attributes_extracted, identification_status, verdict, normalization_status,
  trading_floor_status, price_research_status, overall_confidence,
  publication_review_status, source_posted_at_text, provenance_metadata
)
SELECT
  gen_random_uuid(),
  'wf2-oceandigital-2026-08-25',
  p.source_record_id,
  v.id,
  p.source_hash,
  encode(digest(concat(
    COALESCE(cand->>'brand',''),
    COALESCE(cand->>'reference',''),
    COALESCE(cand->>'listing_type',''),
    COALESCE(primary_price->>'currency_original',''),
    COALESCE(primary_price->>'amount_usd','')
  )::text, 'sha256'), 'hex'),
  v.raw_text,
  'WATCH',
  cand->>'listing_type',
  cand->>'listing_type',
  false,
  left(cand->>'brand', 100), left(cand->>'brand', 100),
  left(cand->>'model', 100), left(cand->>'model', 100),
  left(cand->>'reference', 100), left(cand->>'reference', 100),
  left(cand->>'dial_color', 50), left(cand->>'dial_color', 50),
  CASE WHEN (primary_price->>'amount_original') ~ '^\d+(\.\d+)?$'
        AND (primary_price->>'amount_original')::numeric < 100000000
       THEN (primary_price->>'amount_original')::numeric ELSE NULL END,
  CASE WHEN (primary_price->>'amount_original') ~ '^\d+(\.\d+)?$'
        AND (primary_price->>'amount_original')::numeric < 100000000
       THEN (primary_price->>'amount_original')::numeric ELSE NULL END,
  CASE
    WHEN upper(btrim(primary_price->>'currency_original')) IN ('USD','USDT')
     AND (primary_price->>'amount_usd') ~ '^\d+(\.\d+)?$'
     AND (primary_price->>'amount_usd')::numeric < 100000000
    THEN (primary_price->>'amount_usd')::numeric
    ELSE NULL
  END,
  NULLIF(upper(btrim(primary_price->>'currency_original')), ''),
  NULLIF(upper(btrim(primary_price->>'currency_original')), ''),
  primary_price->>'currency_evidence',
  left(cand->>'condition', 50), left(cand->>'condition', 50),
  CASE WHEN p.media_key IS NOT NULL THEN 'https://thecollective-prod.nyc3.digitaloceanspaces.com/' || p.media_key ELSE NULL END,
  p.media_key,
  CASE WHEN p.media_key IS NOT NULL THEN 'https://thecollective-prod.nyc3.digitaloceanspaces.com/' || p.media_key ELSE NULL END,
  false,
  NULL, NULL, NULL,
  COALESCE((p.proposal->>'catalog_confirmed')::boolean, false),
  COALESCE((p.proposal->>'catalog_confirmed')::boolean, false),
  true,
  'pending_verification',
  'pending',
  CASE WHEN p.review_disposition = 'READY_FOR_HUMAN_APPROVAL' THEN 'normalized' ELSE 'needs_review' END,
  'published_pending_verification',
  CASE
    WHEN cand->>'listing_type' = 'WTB' THEN 'demand_pending_human_approval'
    WHEN p.review_disposition = 'HUMAN_REVIEW' THEN 'provisional_needs_review'
    ELSE 'eligible'
  END,
  NULL,
  'PENDING_REVIEW',
  p.source_created_on,
  jsonb_build_object(
    'contract', 'wf-mariadb-normalized-staging-v1',
    'normalization_version', (p.proposal->'normalization'->>'normalization_version'),
    'review_disposition', p.review_disposition,
    'review_reasons', COALESCE(p.review_reasons, '[]'::jsonb),
    'bundle_status', p.bundle_status,
    'exact_raw_version_lineage', true
  )
FROM staging.mysql_normalization_proposals p
JOIN public.raw_message_versions v
  ON v.source_record_id = p.source_record_id AND v.source_hash = p.source_hash
CROSS JOIN LATERAL (
  SELECT (p.proposal->'normalization'->'proposed_candidates'->0) AS cand
) c
CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN jsonb_array_length(COALESCE(cand->'prices','[]'::jsonb)) > 0
      THEN
        COALESCE(
          (SELECT x FROM jsonb_array_elements(cand->'prices') x WHERE (x->>'is_primary')::boolean LIMIT 1),
          cand->'prices'->0
        )
      ELSE NULL
    END AS primary_price
) pp
WHERE p.bundle_status = 'SINGLE_CANDIDATE'
  AND (cand->>'listing_type') IN ('WTS', 'WTB')
  AND jsonb_array_length(COALESCE(cand->'prices','[]'::jsonb)) > 0
ON CONFLICT (normalization_run_key, source_record_id)
  WHERE normalization_run_key IS NOT NULL AND source_record_id IS NOT NULL
DO NOTHING;
