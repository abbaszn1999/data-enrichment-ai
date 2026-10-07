-- Supabase advisor 0011: pin search_path on remaining functions.
ALTER FUNCTION public.gs_interval_to_minutes(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_store_domain(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.security_audit_logs_deny_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_visualizer_sessions_updated_at() SET search_path = public, pg_temp;
