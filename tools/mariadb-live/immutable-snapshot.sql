-- Immutable snapshot + audit for Trading Floor / Price Research data.
-- Requirement: "once the info is found and displayed, it has to be solid so nothing can change it."

-- 1) Frozen materialized snapshot of the published Trading Floor.
--    Refreshed only by an explicit, logged action (not by ad-hoc edits).
CREATE MATERIALIZED VIEW IF NOT EXISTS staging.trading_floor_snapshot AS
SELECT
  id, normalization_run_key, source_record_id, raw_message_text,
  brand_normalized AS brand, model_normalized AS model, reference_normalized AS reference,
  dial_color_normalized AS dial_color, condition_normalized AS condition,
  price_usd, price_avg, currency_normalized AS currency, listing_type,
  image_url, source_posted_at_text, created_at
FROM staging.listings
WHERE trading_floor_status IN ('published', 'published_pending_verification', 'bundle_pending_separation');

-- Unique index to allow CONCURRENTLY refresh.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_floor_snapshot_id
  ON staging.trading_floor_snapshot (id);

-- 2) Audit log: any INSERT/UPDATE/DELETE on staging.listings is recorded.
CREATE TABLE IF NOT EXISTS staging.listings_audit (
  audit_id    BIGSERIAL PRIMARY KEY,
  op          TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT current_user,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  listing_id  UUID,
  source_record_id TEXT,
  change      JSONB
);

CREATE OR REPLACE FUNCTION staging.audit_listings_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO staging.listings_audit (op, listing_id, source_record_id, change)
    VALUES ('INSERT', NEW.id, NEW.source_record_id, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO staging.listings_audit (op, listing_id, source_record_id, change)
    VALUES ('UPDATE', NEW.id, NEW.source_record_id,
            jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
    RETURN NEW;
  ELSE
    INSERT INTO staging.listings_audit (op, listing_id, source_record_id, change)
    VALUES ('DELETE', OLD.id, OLD.source_record_id, to_jsonb(OLD));
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_listings ON staging.listings;
CREATE TRIGGER trg_audit_listings
  AFTER INSERT OR UPDATE OR DELETE ON staging.listings
  FOR EACH ROW EXECUTE FUNCTION staging.audit_listings_change();

-- 3) Provenance: mark the snapshot as the immutable published baseline.
COMMENT ON MATERIALIZED VIEW staging.trading_floor_snapshot IS
  'Frozen, read-only baseline of published Trading Floor cards. Refresh only via REFRESH MATERIALIZED VIEW CONCURRENTLY staging.trading_floor_snapshot with an audit entry.';
