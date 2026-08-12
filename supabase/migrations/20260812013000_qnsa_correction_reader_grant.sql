-- Allow the Supabase management-plane database role to reuse the bounded,
-- security-definer customer feed for the audited correction canary. Public
-- client roles remain explicitly denied.
REVOKE ALL ON FUNCTION public.qnsa_trading_floor_page_rows(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    GRANT EXECUTE ON FUNCTION public.qnsa_trading_floor_page_rows(TEXT, INTEGER, INTEGER)
      TO supabase_admin;
  END IF;
END;
$$;

