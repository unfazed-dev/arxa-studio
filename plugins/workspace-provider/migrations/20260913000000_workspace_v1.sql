-- arxa-workspace Wire v1 workspace schema for a user's OWN Supabase project
-- (task 14 step 3). Applied by the disposable local harness
-- (scripts/workspace-provider-supabase-smoke.mjs) and the dedicated CI job;
-- never against any Arxa-owned project (project law: BYO database only).
--
-- The server contract the adapter codes against (plugins/workspace-provider/
-- lib/supabase.js is the client; selftest.supabase.mjs's protocol fake is its
-- executable spec):
--   row shapes stay server-side; callers see contract objects only
--   records.doc is TEXT on purpose — the document's bytes (and key order)
--     survive byte-exact; validity is enforced by the jsonb cast, the etag is
--     md5 of the document text
--   tenant isolation is ROW LEVEL SECURITY, not adapter discipline: the
--     adapter is untrusted client code
--   audit_log is append-only: insert+select policies only, update/delete
--     revoked from authenticated
--
-- Error contract (PostgREST maps these SQLSTATEs): 42501→403 forbidden,
-- 40001→409 conflict, P0002→404 not_found, 22P02/22023/23514→400 invalid.
--
-- Reversibility: `supabase migration down --last 1` resets the disposable
-- database to the pre-migration state (the harness proves this). The inverse
-- SQL, for an operator applying this by hand:
--   drop policy if exists "arxa workspace objects" on storage.objects;
--   drop table if exists audit_log, records, org_members, orgs;
--   drop function if exists make_creator_owner, is_org_member, is_owner_or_admin,
--     is_sole_owner, put_record, list_records, read_audit, add_member,
--     set_member_role, remove_member;
--   delete from storage.buckets where id = 'arxa-workspace';

-- ---------------------------------------------------------------- tables
create table if not exists public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default 'studio',
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  -- nullable on purpose: an INVITED member has no auth identity yet —
  -- identities are re-invited on migration, never copied (§6)
  user_id    uuid,
  email      text not null,
  role       text not null check (role in ('owner', 'admin', 'billing', 'member')),
  status     text not null default 'invited',
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

-- one generic table for the seven fixed Wire v1 collections: schema-on-write
-- is the app's job, the provider stores JSON documents (plan §1 records)
create table if not exists public.records (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  collection text not null check (collection in (
    'tickets', 'ticket_messages', 'chat_conversations', 'chat_messages',
    'feedback', 'requirements', 'user_prefs')),
  id         text not null,
  doc        text not null,          -- byte-exact JSON document text
  etag       text not null,          -- '"' || md5(doc) || '"'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, collection, id)
);

-- append-only: no update/delete policy will ever exist, and update/delete are
-- revoked outright below — immutability by shape at every layer
create table if not exists public.audit_log (
  id      bigint generated always as identity primary key,
  org_id  uuid not null references public.orgs (id) on delete cascade,
  at      timestamptz not null default now(),
  actor   text not null default (auth.uid()::text),
  payload jsonb not null
);

-- ------------------------------------------------------- helper functions
-- SECURITY DEFINER so policies can query org_members without recursing into
-- its own RLS; search_path pinned.
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_owner_or_admin(p_org uuid)
returns boolean language sql stable security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_sole_owner(p_member uuid)
returns boolean language sql stable security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1 from public.org_members m
    where m.id = p_member and m.role = 'owner'
      and (select count(*) from public.org_members o
           where o.org_id = m.org_id and o.role = 'owner') = 1
  );
$$;

-- creator becomes the owner (SECURITY DEFINER: the membership row must be
-- writable before any org policy can see it — the classic bootstrap)
create or replace function public.make_creator_owner()
returns trigger language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  insert into public.org_members (org_id, user_id, email, role, status)
  values (new.id, auth.uid(), coalesce(v_email, 'unknown@invalid'), 'owner', 'active');
  return new;
end;
$$;

drop trigger if exists org_creator_owner on public.orgs;
create trigger org_creator_owner
  after insert on public.orgs
  for each row execute function public.make_creator_owner();

-- ---------------------------------------------------------------- RLS
alter table public.orgs        enable row level security;
alter table public.org_members enable row level security;
alter table public.records     enable row level security;
alter table public.audit_log   enable row level security;

-- orgs: any signed-in user may CREATE an org (the trigger binds it to them);
-- everything else requires membership
drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs for select to authenticated
  using (public.is_org_member(id));
drop policy if exists orgs_insert on public.orgs;
create policy orgs_insert on public.orgs for insert to authenticated
  with check (true);
drop policy if exists orgs_update on public.orgs;
create policy orgs_update on public.orgs for update to authenticated
  using (public.is_org_member(id));
drop policy if exists orgs_delete on public.orgs;
create policy orgs_delete on public.orgs for delete to authenticated
  using (public.is_org_member(id));

drop policy if exists members_select on public.org_members;
create policy members_select on public.org_members for select to authenticated
  using (public.is_org_member(org_id));
drop policy if exists members_insert on public.org_members;
create policy members_insert on public.org_members for insert to authenticated
  with check (public.is_owner_or_admin(org_id));
drop policy if exists members_update on public.org_members;
create policy members_update on public.org_members for update to authenticated
  using (public.is_owner_or_admin(org_id))
  with check (public.is_owner_or_admin(org_id)
              and not (public.is_sole_owner(id) and role <> 'owner'));
drop policy if exists members_delete on public.org_members;
create policy members_delete on public.org_members for delete to authenticated
  using (public.is_owner_or_admin(org_id) and not public.is_sole_owner(id));

drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (public.is_org_member(org_id));
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (public.is_org_member(org_id));
drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (public.is_org_member(org_id));
drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete to authenticated
  using (public.is_org_member(org_id));

-- audit: insert + read ONLY. No update/delete policy exists on purpose.
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated
  with check (public.is_org_member(org_id));
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_org_member(org_id));

-- ------------------------------------------------------------- the RPCs
-- SECURITY INVOKER on purpose: RLS stays enforced inside them (the adapter is
-- untrusted client code; the fence is here, not there).

create or replace function public.put_record(
  p_org uuid, p_collection text, p_id text, p_doc text, p_expected_etag text default null
) returns jsonb language plpgsql security invoker
set search_path = public
as $$
declare
  v_etag text := '"' || md5(p_doc) || '"';
begin
  perform p_doc::jsonb; -- invalid JSON dies here (22P02 → 400 invalid_request)
  if p_collection not in ('tickets', 'ticket_messages', 'chat_conversations',
                          'chat_messages', 'feedback', 'requirements', 'user_prefs')
  then raise exception 'collection is not part of the fixed Wire v1 collection list'
       using errcode = '22023'; end if;

  update public.records
     set doc = p_doc, etag = v_etag, updated_at = now()
   where org_id = p_org and collection = p_collection and id = p_id
     and (p_expected_etag is null or public.records.etag = p_expected_etag);
  if found then return jsonb_build_object('id', p_id, 'etag', v_etag); end if;

  if exists (select 1 from public.records
             where org_id = p_org and collection = p_collection and id = p_id) then
    raise exception 'conflict: etag mismatch' using errcode = '40001';
  end if;
  if p_expected_etag is not null then
    raise exception 'conflict: record does not exist' using errcode = '40001';
  end if;

  insert into public.records (org_id, collection, id, doc, etag)
  values (p_org, p_collection, p_id, p_doc, v_etag);
  if not found then -- the RLS insert policy refused: caller is not a member
    raise exception 'not a member of this org' using errcode = '42501';
  end if;
  return jsonb_build_object('id', p_id, 'etag', v_etag);
end;
$$;

create or replace function public.list_records(
  p_org uuid, p_collection text, p_offset int default 0, p_limit int default 100
) returns jsonb language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
  v_more boolean;
begin
  -- the list REFUSES non-members instead of silently returning empty: a
  -- conforming backend must reject foreign org list calls (kit §cross-org)
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(t.row order by t.row->>'id'), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object('id', r.id, 'etag', r.etag, 'doc', r.doc) as row
        from public.records r
       where r.org_id = p_org and r.collection = p_collection
       order by r.id
       offset greatest(p_offset, 0)
       limit least(greatest(p_limit, 1), 500)
    ) t;
  select exists (
    select 1 from public.records r
     where r.org_id = p_org and r.collection = p_collection
     order by r.id offset (greatest(p_offset, 0) + least(greatest(p_limit, 1), 500)) limit 1
  ) into v_more;
  return jsonb_build_object('rows', v_rows, 'more', v_more);
end;
$$;

create or replace function public.read_audit(p_org uuid)
returns jsonb language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this org' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(
           jsonb_build_object('at', a.at, 'actor', a.actor) || a.payload order by a.id
         ), '[]'::jsonb) into v_rows
    from public.audit_log a
   where a.org_id = p_org;
  return v_rows;
end;
$$;

create or replace function public.add_member(p_org uuid, p_email text, p_role text)
returns public.org_members language plpgsql security invoker
set search_path = public
as $$
declare
  v_member public.org_members%rowtype;
begin
  select * into v_member from public.org_members
   where org_id = p_org and email = p_email;
  if found then -- idempotent: same email + same role returns the SAME row
    if v_member.role <> p_role then
      raise exception 'member already exists with a different role' using errcode = '40001';
    end if;
    return v_member;
  end if;
  insert into public.org_members (org_id, user_id, email, role)
  values (p_org, null, p_email, p_role)
  returning * into v_member;
  if not found then -- policy refused: caller is not owner/admin of this org
    raise exception 'only owner or admin manages members' using errcode = '42501';
  end if;
  return v_member;
end;
$$;

create or replace function public.set_member_role(p_member uuid, p_role text)
returns public.org_members language plpgsql security invoker
set search_path = public
as $$
declare
  v_member public.org_members%rowtype;
begin
  select * into v_member from public.org_members where id = p_member;
  if not found then raise exception 'member not found' using errcode = 'P0002'; end if;
  if v_member.role = 'owner' and p_role <> 'owner'
     and (select count(*) from public.org_members o
          where o.org_id = v_member.org_id and o.role = 'owner') = 1 then
    raise exception 'the last owner cannot be demoted' using errcode = '42501';
  end if;
  update public.org_members set role = p_role where id = p_member
  returning * into v_member;
  if not found then
    raise exception 'only owner or admin manages members' using errcode = '42501';
  end if;
  return v_member;
end;
$$;

create or replace function public.remove_member(p_member uuid)
returns public.org_members language plpgsql security invoker
set search_path = public
as $$
declare
  v_member public.org_members%rowtype;
begin
  select * into v_member from public.org_members where id = p_member;
  if not found then raise exception 'member not found' using errcode = 'P0002'; end if;
  if v_member.role = 'owner'
     and (select count(*) from public.org_members o
          where o.org_id = v_member.org_id and o.role = 'owner') = 1 then
    raise exception 'the last owner cannot be removed' using errcode = '42501';
  end if;
  delete from public.org_members where id = p_member
  returning * into v_member;
  if not found then
    raise exception 'only owner or admin manages members' using errcode = '42501';
  end if;
  return v_member;
end;
$$;

-- --------------------------------------------------------------- storage
insert into storage.buckets (id, name, public)
values ('arxa-workspace', 'arxa-workspace', false)
on conflict (id) do nothing;

-- org-scoped bucket: objects live at org/<org_id>/… — membership is checked
-- against the path's SECOND folder segment (1-indexed: [1]='org', [2]=org id)
drop policy if exists "arxa workspace objects" on storage.objects;
create policy "arxa workspace objects" on storage.objects
  for all to authenticated
  using (bucket_id = 'arxa-workspace'
         and public.is_org_member((storage.foldername(name))[2]::uuid))
  with check (bucket_id = 'arxa-workspace'
              and public.is_org_member((storage.foldername(name))[2]::uuid));

-- --------------------------------------------------------------- grants
-- new tables grant nothing to authenticated by default; the adapter's role
-- needs exactly this surface (audit: insert+select ONLY)
grant select, insert, update, delete on public.orgs, public.org_members, public.records to authenticated;
grant select, insert on public.audit_log to authenticated;
revoke update, delete on public.audit_log from authenticated;
grant execute on function
  public.put_record, public.list_records, public.read_audit,
  public.add_member, public.set_member_role, public.remove_member,
  public.is_org_member, public.is_owner_or_admin, public.is_sole_owner
to authenticated;
