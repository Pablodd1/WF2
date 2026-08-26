-- Insert clearly-classified HANDBAG items (Birkin/Kelly) into staging.listings
-- from staging.nonwatch_enrichment. Keeps watches (majority of cat-24) out —
-- those belong to the watch pipeline and are already covered.
-- Uses same flat column mapping as the watch loader. contact_consent=false.

INSERT INTO staging.listings (
  id, normalization_run_key, source_record_id, source_hash, source_candidate_hash,
  raw_message_text, category, intent, listing_type, is_bundle,
  brand_original, brand_normalized, model_original, model_normalized,
  reference_original, reference_normalized, dial_color_original, dial_color_normalized,
  price_original, price_normalized, price_usd, currency_original, currency_normalized,
  currency_evidence, condition_original, condition_normalized, image_url,
  source_media_key, source_media_url_candidate, public_image_eligible,
  user_name, from_name, location, dealer_rating, rating, contact_consent,
  are_attributes_extracted, identification_status, verdict, normalization_status,
  trading_floor_status, price_research_status, overall_confidence, publication_review_status,
  source_posted_at_text, provenance_metadata
)
SELECT
  gen_random_uuid(),
  'wf2-oceandigital-2026-08-25',
  'mysql_auctions_' || id,
  md5(id),
  md5('handbag_' || id),
  COALESCE(NULLIF(title,''), description, id),
  'HANDBAG',
  CASE WHEN category_id = 12 THEN 'WTS' ELSE 'WTS' END,
  'WTS',
  false,
  'Hermès', 'Hermès',
  NULL, NULL, NULL, NULL, NULL, NULL,
  CASE WHEN price IS NOT NULL AND price < 100000000 THEN price ELSE NULL END,
  CASE WHEN price IS NOT NULL AND price < 100000000 THEN price ELSE NULL END,
  CASE WHEN price IS NOT NULL AND price < 100000000 THEN price ELSE NULL END,
  'USD', 'USD', 'SOURCE_EXPLICIT_USD_MATCH',
  NULL, NULL,
  CASE WHEN front_image IS NOT NULL THEN 'https://thecollective-prod.nyc3.digitaloceanspaces.com/' || front_image ELSE NULL END,
  front_image,
  CASE WHEN front_image IS NOT NULL THEN 'https://thecollective-prod.nyc3.digitaloceanspaces.com/' || front_image ELSE NULL END,
  false,
  from_name, from_name, region, dealer_rating, dealer_rating, false,
  true, 'pending_verification', 'pending', 'needs_review',
  'published_pending_verification', 'provisional_needs_review', NULL, 'PENDING_REVIEW',
  NULL,
  jsonb_build_object(
    'contract','wf-mariadb-normalized-staging-v1',
    'category','HANDBAG',
    'source','mariadb_nonwatch',
    'catalog_confirmed', false
  )
FROM staging.nonwatch_enrichment e
WHERE (UPPER(COALESCE(title,'')||' '||COALESCE(description,'')) ~ '\y(BIRKIN|KELLY|LINDY|PICOTIN|EVELYNE|CONSTANCE|KABALUOKA|FOURRE|BERKIN)\y')
ON CONFLICT (normalization_run_key, source_record_id)
  WHERE normalization_run_key IS NOT NULL AND source_record_id IS NOT NULL
DO NOTHING;
