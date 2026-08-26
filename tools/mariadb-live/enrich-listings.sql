-- Enrich staging.listings with seller identity, contact, dealer, region, image
-- sourced from the MariaDB `auctions` table (loaded into staging.auctions_enrichment).
--
-- Privacy: from_number/from_name are written to the raw columns, but
-- contact_consent stays FALSE and contact_publication_approved stays FALSE,
-- so the public views (which gate seller_contact behind contact_consent=true)
-- do NOT expose the phone number until explicitly approved.

UPDATE staging.listings l
SET
  from_name           = a.from_name,
  user_name           = a.from_name,
  from_number         = a.from_number,
  contact_number      = a.from_number,
  phone_code          = a.phone_code,
  location            = a.region,
  dealer_rating       = a.dealer_rating,
  rating              = a.dealer_rating,
  is_verified_user    = a.is_verified,
  is_paid_user        = a.is_paid,
  is_seller_approved  = a.is_seller_approved,
  contact_consent     = false,
  image_url           = CASE
                          WHEN l.image_url IS NULL AND a.front_image IS NOT NULL
                          THEN 'https://thecollective-prod.nyc3.digitaloceanspaces.com/' || a.front_image
                          ELSE l.image_url
                        END,
  source_media_url_candidate = CASE
                          WHEN l.source_media_url_candidate IS NULL AND a.front_image IS NOT NULL
                          THEN 'https://thecollective-prod.nyc3.digitaloceanspaces.com/' || a.front_image
                          ELSE l.source_media_url_candidate
                        END,
  source_media_key   = COALESCE(l.source_media_key, a.front_image),
  provenance_metadata = jsonb_set(
                          COALESCE(l.provenance_metadata, '{}'::jsonb),
                          '{seller_enrichment}',
                          jsonb_build_object(
                            'source', 'mariadb_auctions',
                            'enriched_at', now(),
                            'contact_publication_approved', false,
                            'rating_publication_status', CASE WHEN a.dealer_rating = 0 THEN 'UNVERIFIED_ZERO' ELSE 'VERIFIED_LEVEL' END
                          )
                        )
FROM staging.auctions_enrichment a
WHERE l.source_record_id = 'mysql_auctions_' || a.id;
