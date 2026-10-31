create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'pending' check (role in ('pending', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  case_reference text not null unique check (length(btrim(case_reference)) between 1 and 64),
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 10000),
  incident_date timestamptz,
  status text not null default 'Open'
    check (status in ('Open', 'Under Review', 'Evidence Collected', 'Submitted to Police', 'Closed')),
  archived_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.generated_links (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  description text not null check (length(btrim(description)) between 1 and 240),
  is_active boolean not null default true,
  expires_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.generated_links(id) on delete restrict,
  case_id uuid not null references public.cases(id) on delete restrict,
  ip_address inet,
  browser text,
  operating_system text,
  device_category text,
  user_agent text check (user_agent is null or length(user_agent) <= 2048),
  estimated_country text,
  estimated_region text,
  estimated_city text,
  estimated_latitude double precision check (estimated_latitude is null or estimated_latitude between -90 and 90),
  estimated_longitude double precision check (estimated_longitude is null or estimated_longitude between -180 and 180),
  visited_at timestamptz not null default now(),
  check (link_id is not null and case_id is not null)
);

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete restrict,
  permission_type text not null
    check (permission_type in ('location', 'camera', 'microphone', 'written_statement')),
  consent_status text not null check (consent_status in ('granted', 'denied', 'revoked')),
  purpose text not null check (length(btrim(purpose)) between 1 and 500),
  consent_timestamp timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.location_sessions (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete restrict,
  consent_id uuid not null references public.consent_records(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((status = 'active' and ended_at is null) or (status = 'ended' and ended_at is not null))
);

create table if not exists public.location_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.location_sessions(id) on delete restrict,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy double precision not null check (accuracy >= 0 and accuracy <= 100000),
  recorded_at timestamptz not null default now()
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  visit_id uuid not null references public.visits(id) on delete restrict,
  consent_id uuid not null references public.consent_records(id) on delete restrict,
  evidence_type text not null
    check (evidence_type in ('image', 'audio', 'written_statement', 'document', 'visit_record', 'ip_intelligence', 'administrative_note', 'other')),
  storage_path text,
  storage_bucket text check (storage_bucket is null or storage_bucket in ('evidence-images', 'evidence-audio', 'evidence-documents')),
  mime_type text,
  file_size bigint check (file_size is null or file_size between 0 and 20971520),
  integrity_hash text check (integrity_hash is null or integrity_hash ~ '^[0-9a-f]{64}$'),
  statement_text text check (statement_text is null or length(statement_text) <= 5000),
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((storage_path is null and storage_bucket is null) or (storage_path is not null and storage_bucket is not null)),
  check (evidence_type <> 'written_statement' or statement_text is not null),
  unique (storage_bucket, storage_path)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null check (length(action) between 1 and 120),
  entity_type text not null check (length(entity_type) between 1 and 80),
  entity_id uuid,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.public_rate_limits (
  rate_key text primary key,
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);

create index if not exists cases_status_created_idx on public.cases(status, created_at desc);
create index if not exists cases_created_by_idx on public.cases(created_by);
create index if not exists generated_links_case_created_idx on public.generated_links(case_id, created_at desc);
create index if not exists generated_links_active_expiry_idx on public.generated_links(is_active, expires_at);
create index if not exists visits_case_visited_idx on public.visits(case_id, visited_at desc);
create index if not exists visits_link_visited_idx on public.visits(link_id, visited_at desc);
create index if not exists consent_records_visit_type_idx on public.consent_records(visit_id, permission_type, consent_timestamp desc);
create index if not exists location_sessions_visit_status_idx on public.location_sessions(visit_id, status);
create index if not exists location_records_session_recorded_idx on public.location_records(session_id, recorded_at);
create index if not exists evidence_case_collected_idx on public.evidence(case_id, collected_at desc);
create index if not exists evidence_visit_idx on public.evidence(visit_id);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists cases_set_updated_at on public.cases;
create trigger cases_set_updated_at before update on public.cases
  for each row execute function public.set_updated_at();

create or replace function public.audit_admin_mutations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_id uuid;
  record_type text := tg_table_name;
  record_action text := lower(tg_op);
  ref_value text;
  title_value text;
  status_value text;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    record_id := old.id;
  else
    record_id := new.id;
  end if;

  if tg_table_name = 'cases' then
    if tg_op = 'DELETE' then
      ref_value := old.case_reference;
      title_value := old.title;
      status_value := old.status;
    else
      ref_value := new.case_reference;
      title_value := new.title;
      status_value := new.status;
    end if;
  elsif tg_table_name = 'generated_links' then
    if tg_op = 'DELETE' then
      ref_value := old.description;
      status_value := case when old.is_active then 'active' else 'inactive' end;
    else
      ref_value := new.description;
      status_value := case when new.is_active then 'active' else 'inactive' end;
    end if;
  end if;

  insert into public.audit_logs(admin_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    record_action,
    record_type,
    record_id,
    jsonb_strip_nulls(jsonb_build_object('reference', ref_value, 'title', title_value, 'status', status_value))
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists cases_audit on public.cases;
create trigger cases_audit after insert or update or delete on public.cases
  for each row execute function public.audit_admin_mutations();
drop trigger if exists generated_links_audit on public.generated_links;
create trigger generated_links_audit after insert or update or delete on public.generated_links
  for each row execute function public.audit_admin_mutations();

create or replace function public.disable_links_when_case_archived()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    update public.generated_links
    set is_active = false
    where case_id = new.id and is_active;
  end if;
  return new;
end;
$$;

drop trigger if exists cases_disable_links_on_archive on public.cases;
create trigger cases_disable_links_on_archive after update of archived_at on public.cases
  for each row execute function public.disable_links_when_case_archived();

create or replace function public.audit_evidence_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs(admin_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'evidence_submitted',
    'evidence',
    new.id,
    jsonb_build_object('case_id', new.case_id, 'evidence_type', new.evidence_type)
  );
  return new;
end;
$$;

drop trigger if exists evidence_audit_insert on public.evidence;
create trigger evidence_audit_insert after insert on public.evidence
  for each row execute function public.audit_evidence_insert();

create or replace function public.audit_public_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_type text := tg_table_name;
  record_action text := case when tg_op = 'INSERT' then 'submitted' else 'updated' end;
  record_case_id uuid;
  record_visit_id uuid;
  record_session_id uuid;
  record_permission text;
  record_status text;
begin
  if tg_table_name = 'visits' then
    record_case_id := new.case_id;
    record_visit_id := new.id;
  elsif tg_table_name = 'consent_records' then
    record_visit_id := new.visit_id;
    record_permission := new.permission_type;
    record_status := new.consent_status;
  elsif tg_table_name = 'location_sessions' then
    record_visit_id := new.visit_id;
    record_session_id := new.id;
    record_status := new.status;
  elsif tg_table_name = 'location_records' then
    record_session_id := new.session_id;
    select ls.visit_id into record_visit_id
    from public.location_sessions ls where ls.id = new.session_id;
  end if;

  insert into public.audit_logs(admin_id, action, entity_type, entity_id, metadata)
  values (
    null,
    record_action,
    record_type,
    new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'case_id', record_case_id,
      'visit_id', record_visit_id,
      'session_id', record_session_id,
      'permission_type', record_permission,
      'status', record_status
    ))
  );
  return new;
end;
$$;

drop trigger if exists visits_audit on public.visits;
create trigger visits_audit after insert on public.visits
  for each row execute function public.audit_public_records();
drop trigger if exists consent_records_audit on public.consent_records;
create trigger consent_records_audit after insert or update on public.consent_records
  for each row execute function public.audit_public_records();
drop trigger if exists location_sessions_audit on public.location_sessions;
create trigger location_sessions_audit after insert or update on public.location_sessions
  for each row execute function public.audit_public_records();
drop trigger if exists location_records_audit on public.location_records;
create trigger location_records_audit after insert on public.location_records
  for each row execute function public.audit_public_records();

create or replace function public.consume_public_rate_limit(
  p_rate_key text,
  p_limit integer default 30,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_window timestamptz;
  request_total integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or length(p_rate_key) <> 64 then
    return false;
  end if;
  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );
  perform pg_advisory_xact_lock(hashtextextended(p_rate_key, 0));
  insert into public.public_rate_limits(rate_key, window_start, request_count)
  values (p_rate_key, current_window, 1)
  on conflict (rate_key) do update
  set window_start = excluded.window_start,
      request_count = case
        when public.public_rate_limits.window_start = excluded.window_start
          then public.public_rate_limits.request_count + 1
        else 1
      end,
      updated_at = clock_timestamp()
  returning request_count into request_total;
  return request_total <= p_limit;
end;
$$;

revoke all on function public.consume_public_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text, integer, integer) to service_role;

alter table public.profiles enable row level security;
alter table public.cases enable row level security;
alter table public.generated_links enable row level security;
alter table public.visits enable row level security;
alter table public.consent_records enable row level security;
alter table public.location_sessions enable row level security;
alter table public.location_records enable row level security;
alter table public.evidence enable row level security;
alter table public.audit_logs enable row level security;
alter table public.public_rate_limits enable row level security;

drop policy if exists "Admins read profiles" on public.profiles;
create policy "Admins read profiles" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Admins read cases" on public.cases;
create policy "Admins read cases" on public.cases for select to authenticated
  using ((select public.is_admin()));
drop policy if exists "Admins create cases" on public.cases;
create policy "Admins create cases" on public.cases for insert to authenticated
  with check ((select public.is_admin()) and created_by = (select auth.uid()));
drop policy if exists "Admins update cases" on public.cases;
create policy "Admins update cases" on public.cases for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Admins delete cases" on public.cases;
create policy "Admins delete cases" on public.cases for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "Admins read links" on public.generated_links;
create policy "Admins read links" on public.generated_links for select to authenticated
  using ((select public.is_admin()));
drop policy if exists "Admins update links" on public.generated_links;
create policy "Admins update links" on public.generated_links for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admins read visits" on public.visits;
create policy "Admins read visits" on public.visits for select to authenticated
  using ((select public.is_admin()));
drop policy if exists "Admins read consent records" on public.consent_records;
create policy "Admins read consent records" on public.consent_records for select to authenticated
  using ((select public.is_admin()));
drop policy if exists "Admins read location sessions" on public.location_sessions;
create policy "Admins read location sessions" on public.location_sessions for select to authenticated
  using ((select public.is_admin()));
drop policy if exists "Admins read location records" on public.location_records;
create policy "Admins read location records" on public.location_records for select to authenticated
  using ((select public.is_admin()));
drop policy if exists "Admins read evidence" on public.evidence;
create policy "Admins read evidence" on public.evidence for select to authenticated
  using ((select public.is_admin()));
drop policy if exists "Admins read audit log" on public.audit_logs;
create policy "Admins read audit log" on public.audit_logs for select to authenticated
  using ((select public.is_admin()));

grant usage on schema public to authenticated;
grant select on public.profiles, public.cases, public.generated_links, public.visits,
  public.consent_records, public.location_sessions, public.location_records,
  public.evidence, public.audit_logs to authenticated;
grant insert, update, delete on public.cases to authenticated;
grant update on public.generated_links to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('evidence-images', 'evidence-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('evidence-audio', 'evidence-audio', false, 20971520, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins read private evidence objects" on storage.objects;
create policy "Admins read private evidence objects" on storage.objects for select to authenticated
  using (
    bucket_id in ('evidence-images', 'evidence-audio', 'evidence-documents')
    and (select public.is_admin())
  );

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('evidence-documents', 'evidence-documents', false, 20971520, array['application/pdf', 'text/plain'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cases'
    ) then
      alter publication supabase_realtime add table public.cases;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'generated_links'
    ) then
      alter publication supabase_realtime add table public.generated_links;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'visits'
    ) then
      alter publication supabase_realtime add table public.visits;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'consent_records'
    ) then
      alter publication supabase_realtime add table public.consent_records;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'location_sessions'
    ) then
      alter publication supabase_realtime add table public.location_sessions;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'location_records'
    ) then
      alter publication supabase_realtime add table public.location_records;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'evidence'
    ) then
      alter publication supabase_realtime add table public.evidence;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_logs'
    ) then
      alter publication supabase_realtime add table public.audit_logs;
    end if;
  end if;
end;
$$;
