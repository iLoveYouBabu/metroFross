-- Run once in the selected Supabase project's SQL Editor.
-- Only fromis_* objects are created; kkobak_* and other project objects are untouched.
begin;

create table if not exists public.fromis_courses (
  version text primary key,
  catalog_hash text not null,
  album_ids text[] not null,
  track_count integer not null check (track_count > 0),
  minimum_strokes integer not null check (minimum_strokes > 0),
  enabled boolean not null default true
);
create table if not exists public.fromis_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 16 and nickname !~ '[[:cntrl:]<>]'),
  updated_at timestamptz not null default now()
);
create table if not exists public.fromis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_version text not null references public.fromis_courses(version),
  album_ids text[] not null,
  device text not null check (device in ('pc', 'mobile')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  elapsed_ms bigint check (elapsed_ms > 0),
  correct_strokes integer,
  attempted_strokes integer,
  cpm numeric,
  accuracy numeric
);
create index if not exists fromis_runs_leaderboard_idx on public.fromis_runs(course_version, device, elapsed_ms, finished_at) where finished_at is not null;
create index if not exists fromis_runs_personal_idx on public.fromis_runs(user_id, course_version, device, finished_at desc) where finished_at is not null;

alter table public.fromis_courses enable row level security;
alter table public.fromis_profiles enable row level security;
alter table public.fromis_runs enable row level security;
revoke all on table public.fromis_courses, public.fromis_profiles, public.fromis_runs from public, anon, authenticated;

-- Immutable course registration. A changed catalog must use a new version.
insert into public.fromis_courses(version, catalog_hash, album_ids, track_count, minimum_strokes)
values (
  'fromis-full-v1-34b55b7a16952c88',
  '34b55b7a16952c88c15ec97000d0a0881d037c632a2e5a24c292fcd22563b7f5',
  array['to-heart','to-day','from-9','fun-factory','my-little-society','9-way-ticket','talk-and-talk','midnight-guest','from-our-memento-box','unlock-my-world','supersonic','from-our-20s','like-you-better-japanese','glow-me'],
  67, 654
) on conflict (version) do nothing;

create or replace function public.fromis_set_nickname(p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_nickname text := btrim(regexp_replace(normalize(p_nickname, NFC), '\s+', ' ', 'g'));
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_nickname is null or char_length(v_nickname) not between 2 and 16 or v_nickname ~ '[[:cntrl:]<>]' then raise exception 'INVALID_NICKNAME'; end if;
  insert into public.fromis_profiles(user_id, nickname) values (v_user, v_nickname)
    on conflict (user_id) do update set nickname = excluded.nickname, updated_at = clock_timestamp();
  return jsonb_build_object('nickname', v_nickname);
end;
$$;

create or replace function public.fromis_begin_run(p_course_version text, p_album_ids text[], p_device text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_course public.fromis_courses%rowtype;
  v_run public.fromis_runs%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_course from public.fromis_courses where version = p_course_version and enabled;
  if not found then raise exception 'COURSE_NOT_FOUND'; end if;
  if p_album_ids is distinct from v_course.album_ids then raise exception 'FULL_COURSE_REQUIRED'; end if;
  if p_device is null or p_device not in ('pc','mobile') then raise exception 'INVALID_RUN'; end if;
  if not exists (select 1 from public.fromis_profiles where user_id = v_user) then raise exception 'NICKNAME_REQUIRED'; end if;
  insert into public.fromis_runs(user_id, course_version, album_ids, device)
    values (v_user, p_course_version, v_course.album_ids, p_device) returning * into v_run;
  return jsonb_build_object('eligible', true, 'run_id', v_run.id, 'started_at', v_run.started_at, 'course_version', v_run.course_version, 'track_count', v_course.track_count, 'device', v_run.device);
end;
$$;

create or replace function public.fromis_finish_run(p_run_id uuid, p_completed_track_count integer, p_elapsed_ms bigint, p_correct_strokes integer, p_attempted_strokes integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_run public.fromis_runs%rowtype;
  v_course public.fromis_courses%rowtype;
  v_now timestamptz := clock_timestamp();
  v_wall_ms bigint;
  v_duplicate boolean := false;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_run from public.fromis_runs where id = p_run_id and user_id = v_user for update;
  if not found then raise exception 'INVALID_RUN'; end if;
  select * into v_course from public.fromis_courses where version = v_run.course_version and enabled;
  if not found then raise exception 'COURSE_NOT_FOUND'; end if;
  if v_run.album_ids is distinct from v_course.album_ids or p_completed_track_count is distinct from v_course.track_count then raise exception 'FULL_COURSE_REQUIRED'; end if;
  if v_run.finished_at is not null then
    v_duplicate := true;
  else
    v_wall_ms := floor(extract(epoch from (v_now - v_run.started_at)) * 1000);
    if v_wall_ms > 86400000 then raise exception 'RUN_EXPIRED'; end if;
    -- Active time preserves the game's pause behavior. The server wall clock
    -- bounds it; this is a sanity check, not a proof that a human typed each key.
    if p_elapsed_ms is null or p_elapsed_ms < ceil(v_course.minimum_strokes * 60000.0 / 3000) or p_elapsed_ms > 14400000 or p_elapsed_ms > v_wall_ms + 2000 then raise exception 'INVALID_STATS'; end if;
    if p_correct_strokes is null or p_attempted_strokes is null or p_correct_strokes < v_course.minimum_strokes or p_attempted_strokes < p_correct_strokes or p_attempted_strokes > 100000 then raise exception 'INVALID_STATS'; end if;
    if p_correct_strokes * 60000.0 / p_elapsed_ms > 3000 then raise exception 'INVALID_STATS'; end if;
    update public.fromis_runs set finished_at = v_now, elapsed_ms = p_elapsed_ms,
      correct_strokes = p_correct_strokes, attempted_strokes = p_attempted_strokes,
      cpm = round(p_correct_strokes * 60000.0 / p_elapsed_ms, 2),
      accuracy = round(p_correct_strokes * 100.0 / p_attempted_strokes, 2)
      where id = v_run.id returning * into v_run;
  end if;
  return jsonb_build_object('eligible', true, 'duplicate', v_duplicate, 'record', jsonb_build_object('run_id', v_run.id, 'elapsed_ms', v_run.elapsed_ms, 'cpm', v_run.cpm, 'accuracy', v_run.accuracy, 'finished_at', v_run.finished_at, 'device', v_run.device));
end;
$$;

create or replace function public.fromis_leaderboard(p_course_version text, p_period text default 'week', p_device text default 'pc', p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_period is null or p_period not in ('week','all') or p_device is null or p_device not in ('pc','mobile') then raise exception 'INVALID_RUN'; end if;
  if not exists (select 1 from public.fromis_courses where version = p_course_version and enabled) then raise exception 'COURSE_NOT_FOUND'; end if;
  with eligible as (
    select r.*, row_number() over (partition by r.user_id order by r.elapsed_ms, r.accuracy desc, r.finished_at, r.id) as own_rank
    from public.fromis_runs r
    where r.course_version = p_course_version and r.device = p_device and r.finished_at is not null
      and (p_period = 'all' or r.finished_at >= now() - interval '7 days')
  ), best as (
    select row_number() over (order by e.elapsed_ms, e.accuracy desc, e.finished_at, e.id) as rank,
      p.nickname, e.elapsed_ms, e.cpm, e.accuracy, e.finished_at, (e.user_id = auth.uid()) is true as is_me
    from eligible e join public.fromis_profiles p on p.user_id = e.user_id where e.own_rank = 1
  ), limited as (select * from best order by rank limit greatest(1, least(coalesce(p_limit,10),50)))
  select coalesce(jsonb_agg(to_jsonb(limited) order by rank), '[]'::jsonb) into v_result from limited;
  return v_result;
end;
$$;

create or replace function public.fromis_personal_records(p_course_version text, p_device text default 'pc')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_nickname text;
  v_best jsonb;
  v_week jsonb;
  v_recent jsonb;
  v_count bigint;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_device is null or p_device not in ('pc','mobile') then raise exception 'INVALID_RUN'; end if;
  if not exists (select 1 from public.fromis_courses where version = p_course_version and enabled) then raise exception 'COURSE_NOT_FOUND'; end if;
  select nickname into v_nickname from public.fromis_profiles where user_id = v_user;
  select jsonb_build_object('run_id',r.id,'elapsed_ms',r.elapsed_ms,'cpm',r.cpm,'accuracy',r.accuracy,'finished_at',r.finished_at,'device',r.device)
    into v_best from public.fromis_runs r where user_id = v_user and course_version = p_course_version and device = p_device and finished_at is not null order by elapsed_ms, accuracy desc, finished_at, id limit 1;
  select jsonb_build_object('run_id',r.id,'elapsed_ms',r.elapsed_ms,'cpm',r.cpm,'accuracy',r.accuracy,'finished_at',r.finished_at,'device',r.device)
    into v_week from public.fromis_runs r where user_id = v_user and course_version = p_course_version and device = p_device and finished_at >= now() - interval '7 days' order by elapsed_ms, accuracy desc, finished_at, id limit 1;
  select count(*) into v_count from public.fromis_runs where user_id = v_user and course_version = p_course_version and device = p_device and finished_at is not null;
  select coalesce(jsonb_agg(to_jsonb(recent) order by recent.finished_at desc), '[]'::jsonb) into v_recent from (
    select id as run_id, elapsed_ms, cpm, accuracy, finished_at, device from public.fromis_runs where user_id = v_user and course_version = p_course_version and device = p_device and finished_at is not null order by finished_at desc, id limit 5
  ) recent;
  return jsonb_build_object('nickname',v_nickname,'best',v_best,'weekBest',v_week,'completedRuns',v_count,'recent',v_recent);
end;
$$;

revoke all on function public.fromis_set_nickname(text), public.fromis_begin_run(text,text[],text), public.fromis_finish_run(uuid,integer,bigint,integer,integer), public.fromis_leaderboard(text,text,text,integer), public.fromis_personal_records(text,text) from public, anon, authenticated;
grant execute on function public.fromis_leaderboard(text,text,text,integer) to anon, authenticated;
grant execute on function public.fromis_set_nickname(text), public.fromis_begin_run(text,text[],text), public.fromis_finish_run(uuid,integer,bigint,integer,integer), public.fromis_personal_records(text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
