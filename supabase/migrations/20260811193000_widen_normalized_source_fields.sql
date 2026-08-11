-- Preserve source-supplied normalized values without truncation.
--
-- The legacy staging contract used presentation-sized varchar limits. The
-- reconciled MariaDB archive contains legitimate luxury-item titles longer
-- than those limits. These columns are private staging evidence, so retain the
-- complete source value and let publication views control presentation.

BEGIN;

ALTER TABLE staging.listings
  ALTER COLUMN brand_original TYPE TEXT,
  ALTER COLUMN brand_normalized TYPE TEXT,
  ALTER COLUMN model_original TYPE TEXT,
  ALTER COLUMN model_normalized TYPE TEXT,
  ALTER COLUMN reference_original TYPE TEXT,
  ALTER COLUMN reference_normalized TYPE TEXT,
  ALTER COLUMN dial_color_original TYPE TEXT,
  ALTER COLUMN dial_color_normalized TYPE TEXT,
  ALTER COLUMN condition_original TYPE TEXT,
  ALTER COLUMN condition_normalized TYPE TEXT,
  ALTER COLUMN user_name TYPE TEXT,
  ALTER COLUMN from_name TYPE TEXT,
  ALTER COLUMN location TYPE TEXT;

COMMIT;
