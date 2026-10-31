grant usage on schema public to service_role;

grant select on public.profiles, public.cases to service_role;
grant select, insert, update on public.generated_links, public.visits,
  public.consent_records, public.location_sessions to service_role;
grant select, insert on public.location_records, public.evidence to service_role;
grant insert on public.audit_logs to service_role;
