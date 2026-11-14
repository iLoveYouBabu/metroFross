-- One ranking table. Run this whole file for a new installation or an upgrade.
-- Existing completed and unfinished runs are retained. No kkobak_* object changes.
-- Course changes require updating the server constants below and the client config.
begin;

create table if not exists public.fromis_nickname_runs (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  course_version text not null,
  device text not null check (device in ('pc','mobile')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  elapsed_ms bigint check (elapsed_ms > 0),
  cpm numeric,
  accuracy numeric
);

-- Detach only the known current/legacy game foreign keys, preserving their rows.
-- A different dependency makes the later RESTRICT drop abort this transaction.
do $migration$
declare v_constraint record;
begin
  for v_constraint in
    select c.conrelid::regclass as relation, c.conname
    from pg_catalog.pg_constraint c
    where c.contype='f'
      and c.conrelid in (to_regclass('public.fromis_nickname_runs'),to_regclass('public.fromis_runs'))
      and c.confrelid in (to_regclass('public.fromis_nickname_profiles'),to_regclass('public.fromis_courses'))
  loop
    execute format('alter table %s drop constraint %I',v_constraint.relation,v_constraint.conname);
  end loop;
end;
$migration$;

alter table public.fromis_nickname_runs
  drop column if exists album_ids,
  drop column if exists finish_token,
  drop column if exists correct_strokes,
  drop column if exists attempted_strokes;

-- Historical names remain readable. Every inserted or updated row uses the new rule.
alter table public.fromis_nickname_runs
  drop constraint if exists fromis_nickname_runs_nickname_format_check;
alter table public.fromis_nickname_runs
  add constraint fromis_nickname_runs_nickname_format_check
  check ((nickname collate "C") ~ $pattern$^[ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎᄀ-ᄒ\x21-\x40\x5b-\x60\x7b-\x7e]{1,6}$$pattern$) not valid;

-- Do not cascade into unrelated or historical data.
drop table if exists public.fromis_nickname_profiles restrict;
drop table if exists public.fromis_courses restrict;

create index if not exists fromis_nickname_runs_leaderboard_idx on public.fromis_nickname_runs(course_version,device,elapsed_ms,finished_at) where finished_at is not null;
create index if not exists fromis_nickname_runs_personal_idx on public.fromis_nickname_runs(nickname,course_version,device,finished_at desc) where finished_at is not null;
alter table public.fromis_nickname_runs enable row level security;
revoke all on table public.fromis_nickname_runs from public,anon,authenticated;

-- Compatibility for cached clients: validate a name without registering a profile.
create or replace function public.fromis_nickname_set(p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_nickname text:=btrim(regexp_replace(normalize(p_nickname,NFC),'\s+',' ','g'));
begin
  if v_nickname is null or (v_nickname collate "C") !~ $pattern$^[ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎᄀ-ᄒ\x21-\x40\x5b-\x60\x7b-\x7e]{1,6}$$pattern$ then raise exception 'INVALID_NICKNAME'; end if;
  return jsonb_build_object('nickname',v_nickname);
end;
$function$;

create or replace function public.fromis_nickname_begin(p_course_version text,p_album_ids text[],p_device text,p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_course_version constant text:='fromis-full-nickname-v1-34b55b7a16952c88';
  v_album_ids constant text[]:=array['to-heart','to-day','from-9','fun-factory','my-little-society','9-way-ticket','talk-and-talk','midnight-guest','from-our-memento-box','unlock-my-world','supersonic','from-our-20s','like-you-better-japanese','glow-me'];
  v_nickname text:=btrim(regexp_replace(normalize(p_nickname,NFC),'\s+',' ','g'));
  v_run public.fromis_nickname_runs%rowtype;
begin
  if v_nickname is null or (v_nickname collate "C") !~ $pattern$^[ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎᄀ-ᄒ\x21-\x40\x5b-\x60\x7b-\x7e]{1,6}$$pattern$ then raise exception 'INVALID_NICKNAME'; end if;
  if p_course_version is distinct from v_course_version then raise exception 'COURSE_NOT_FOUND'; end if;
  if p_album_ids is distinct from v_album_ids then raise exception 'FULL_COURSE_REQUIRED'; end if;
  if p_device is null or p_device not in ('pc','mobile') then raise exception 'INVALID_RUN'; end if;
  insert into public.fromis_nickname_runs(nickname,course_version,device)
    values(v_nickname,v_course_version,p_device) returning * into v_run;
  -- An unfinished run ID is a private write capability. No read RPC exposes it.
  -- run_token is a response-only alias for cached clients; no token column exists.
  return jsonb_build_object('eligible',true,'run_id',v_run.id,'run_token',v_run.id,'started_at',v_run.started_at,'course_version',v_run.course_version,'track_count',67,'device',v_run.device);
end;
$function$;

create or replace function public.fromis_nickname_finish(p_run_id uuid,p_completed_track_count integer,p_elapsed_ms bigint,p_correct_strokes integer,p_attempted_strokes integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_course_version constant text:='fromis-full-nickname-v1-34b55b7a16952c88';
  v_track_count constant integer:=67;
  v_minimum_strokes constant integer:=654;
  v_run public.fromis_nickname_runs%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_wall_ms bigint;
  v_duplicate boolean:=false;
begin
  select * into v_run from public.fromis_nickname_runs where id=p_run_id for update;
  if not found then raise exception 'INVALID_RUN'; end if;
  if v_run.finished_at is not null then
    -- Completed IDs may be public: their records are immutable, including on retry.
    v_duplicate:=true;
  else
    if v_run.course_version is distinct from v_course_version then raise exception 'COURSE_NOT_FOUND'; end if;
    if p_completed_track_count is distinct from v_track_count then raise exception 'FULL_COURSE_REQUIRED'; end if;
    v_wall_ms:=floor(extract(epoch from (v_now-v_run.started_at))*1000);
    if v_wall_ms>86400000 then raise exception 'RUN_EXPIRED'; end if;
    if v_wall_ms<0 or p_elapsed_ms is null or p_elapsed_ms<ceil(v_minimum_strokes*60000.0/3000) or p_elapsed_ms>14400000 or p_elapsed_ms>v_wall_ms+2000 then raise exception 'INVALID_STATS'; end if;
    if p_correct_strokes is null or p_attempted_strokes is null or p_correct_strokes<v_minimum_strokes or p_attempted_strokes<p_correct_strokes or p_attempted_strokes>100000 then raise exception 'INVALID_STATS'; end if;
    if p_correct_strokes*60000.0/p_elapsed_ms>3000 then raise exception 'INVALID_STATS'; end if;
    update public.fromis_nickname_runs set finished_at=v_now,elapsed_ms=p_elapsed_ms,
      cpm=round(p_correct_strokes*60000.0/p_elapsed_ms,2),accuracy=round(p_correct_strokes*100.0/p_attempted_strokes,2)
      where id=v_run.id returning * into v_run;
  end if;
  return jsonb_build_object('eligible',true,'duplicate',v_duplicate,'record',jsonb_build_object('run_id',v_run.id,'nickname',v_run.nickname,'elapsed_ms',v_run.elapsed_ms,'cpm',v_run.cpm,'accuracy',v_run.accuracy,'finished_at',v_run.finished_at,'device',v_run.device));
end;
$function$;

-- Cached clients and already-started runs can still use the former signature.
create or replace function public.fromis_nickname_finish(p_run_id uuid,p_run_token uuid,p_completed_track_count integer,p_elapsed_ms bigint,p_correct_strokes integer,p_attempted_strokes integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  return public.fromis_nickname_finish(p_run_id,p_completed_track_count,p_elapsed_ms,p_correct_strokes,p_attempted_strokes);
end;
$function$;

create or replace function public.fromis_nickname_leaderboard(p_course_version text,p_period text default 'week',p_device text default 'pc',p_limit integer default 10,p_nickname text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_course_version constant text:='fromis-full-nickname-v1-34b55b7a16952c88';
  v_result jsonb;
  v_nickname text:=btrim(regexp_replace(normalize(p_nickname,NFC),'\s+',' ','g'));
begin
  if p_period is null or p_period not in ('week','all') or p_device is null or p_device not in ('pc','mobile') then raise exception 'INVALID_RUN'; end if;
  if p_course_version is distinct from v_course_version then raise exception 'COURSE_NOT_FOUND'; end if;
  with eligible as (
    select r.*,row_number() over(partition by r.nickname order by r.elapsed_ms,r.accuracy desc,r.finished_at,r.id) as own_rank
    from public.fromis_nickname_runs r where r.course_version=p_course_version and r.device=p_device and r.finished_at is not null
      and(p_period='all' or r.finished_at>=now()-interval '7 days')
  ),best as (
    select row_number() over(order by e.elapsed_ms,e.accuracy desc,e.finished_at,e.id) as rank,
      e.nickname,e.elapsed_ms,e.cpm,e.accuracy,e.finished_at,(e.nickname=v_nickname) is true as is_me
    from eligible e where e.own_rank=1
  ),limited as(select * from best order by rank limit greatest(1,least(coalesce(p_limit,10),50)))
  select coalesce(jsonb_agg(to_jsonb(limited) order by rank),'[]'::jsonb) into v_result from limited;
  return v_result;
end;
$function$;

create or replace function public.fromis_nickname_personal(p_course_version text,p_device text default 'pc',p_nickname text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_course_version constant text:='fromis-full-nickname-v1-34b55b7a16952c88';
  v_nickname text:=btrim(regexp_replace(normalize(p_nickname,NFC),'\s+',' ','g'));
  v_best jsonb;
  v_week jsonb;
  v_recent jsonb;
  v_count bigint;
begin
  if v_nickname is null or (v_nickname collate "C") !~ $pattern$^[ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎᄀ-ᄒ\x21-\x40\x5b-\x60\x7b-\x7e]{1,6}$$pattern$ then raise exception 'INVALID_NICKNAME'; end if;
  if p_device is null or p_device not in ('pc','mobile') then raise exception 'INVALID_RUN'; end if;
  if p_course_version is distinct from v_course_version then raise exception 'COURSE_NOT_FOUND'; end if;
  select jsonb_build_object('run_id',r.id,'nickname',r.nickname,'elapsed_ms',r.elapsed_ms,'cpm',r.cpm,'accuracy',r.accuracy,'finished_at',r.finished_at,'device',r.device)
    into v_best from public.fromis_nickname_runs r where r.nickname=v_nickname and r.course_version=p_course_version and r.device=p_device and r.finished_at is not null order by r.elapsed_ms,r.accuracy desc,r.finished_at,r.id limit 1;
  select jsonb_build_object('run_id',r.id,'nickname',r.nickname,'elapsed_ms',r.elapsed_ms,'cpm',r.cpm,'accuracy',r.accuracy,'finished_at',r.finished_at,'device',r.device)
    into v_week from public.fromis_nickname_runs r where r.nickname=v_nickname and r.course_version=p_course_version and r.device=p_device and r.finished_at is not null and r.finished_at>=now()-interval '7 days' order by r.elapsed_ms,r.accuracy desc,r.finished_at,r.id limit 1;
  select count(*) into v_count from public.fromis_nickname_runs r where r.nickname=v_nickname and r.course_version=p_course_version and r.device=p_device and r.finished_at is not null;
  select coalesce(jsonb_agg(to_jsonb(recent) order by recent.finished_at desc),'[]'::jsonb) into v_recent from(
    select r.id as run_id,r.nickname,r.elapsed_ms,r.cpm,r.accuracy,r.finished_at,r.device from public.fromis_nickname_runs r where r.nickname=v_nickname and r.course_version=p_course_version and r.device=p_device and r.finished_at is not null order by r.finished_at desc,r.id limit 5
  )recent;
  return jsonb_build_object('nickname',v_nickname,'best',v_best,'weekBest',v_week,'completedRuns',v_count,'recent',v_recent);
end;
$function$;

revoke all on function public.fromis_nickname_set(text),public.fromis_nickname_begin(text,text[],text,text),public.fromis_nickname_finish(uuid,integer,bigint,integer,integer),public.fromis_nickname_finish(uuid,uuid,integer,bigint,integer,integer),public.fromis_nickname_leaderboard(text,text,text,integer,text),public.fromis_nickname_personal(text,text,text) from public,anon,authenticated;
grant execute on function public.fromis_nickname_set(text),public.fromis_nickname_begin(text,text[],text,text),public.fromis_nickname_finish(uuid,integer,bigint,integer,integer),public.fromis_nickname_finish(uuid,uuid,integer,bigint,integer,integer),public.fromis_nickname_leaderboard(text,text,text,integer,text),public.fromis_nickname_personal(text,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
