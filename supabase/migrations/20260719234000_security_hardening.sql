-- Explicit privilege boundaries for internal media and queue infrastructure.

REVOKE ALL ON public.media_manifest FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.media_manifest TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_normalization_shadow_work() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_normalization_shadow_work() TO service_role;

NOTIFY pgrst, 'reload schema';
