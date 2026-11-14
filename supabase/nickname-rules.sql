-- Existing nickname-ranking projects only: paste this whole file into SQL Editor.
-- For a new installation, run schema.sql instead.
-- Keeps every existing profile/run and all kkobak_* objects unchanged.
begin;

-- New writes use 1..6 initials, digits or ASCII symbols. NOT VALID avoids
-- rejecting legacy rows; it does not exempt new or updated profile rows.
alter table public.fromis_nickname_profiles
  drop constraint if exists fromis_nickname_profiles_nickname_check;
alter table public.fromis_nickname_profiles
  drop constraint if exists fromis_nickname_profiles_nickname_format_check;
alter table public.fromis_nickname_profiles
  add constraint fromis_nickname_profiles_nickname_format_check
  check ((nickname collate "C") ~ $pattern$^[ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎᄀ-ᄒ\x21-\x40\x5b-\x60\x7b-\x7e]{1,6}$$pattern$) not valid;

-- CREATE OR REPLACE preserves the existing function grants and signatures.
create or replace function public.fromis_nickname_set(p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_nickname text := btrim(regexp_replace(normalize(p_nickname,NFC),'\s+',' ','g'));
begin
  if v_nickname is null or (v_nickname collate "C") !~ $pattern$^[ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎᄀ-ᄒ\x21-\x40\x5b-\x60\x7b-\x7e]{1,6}$$pattern$ then raise exception 'INVALID_NICKNAME'; end if;
  insert into public.fromis_nickname_profiles(nickname) values (v_nickname)
    on conflict (nickname) do update set updated_at=clock_timestamp();
  return jsonb_build_object('nickname',v_nickname);
end;
$function$;

create or replace function public.fromis_nickname_begin(p_course_version text,p_album_ids text[],p_device text,p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_nickname text := btrim(regexp_replace(normalize(p_nickname,NFC),'\s+',' ','g'));
  v_course public.fromis_courses%rowtype;
  v_run public.fromis_nickname_runs%rowtype;
begin
  if v_nickname is null or (v_nickname collate "C") !~ $pattern$^[ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎᄀ-ᄒ\x21-\x40\x5b-\x60\x7b-\x7e]{1,6}$$pattern$ then raise exception 'INVALID_NICKNAME'; end if;
  select * into v_course from public.fromis_courses where version=p_course_version and enabled;
  if not found then raise exception 'COURSE_NOT_FOUND'; end if;
  if p_album_ids is distinct from v_course.album_ids then raise exception 'FULL_COURSE_REQUIRED'; end if;
  if p_device is null or p_device not in ('pc','mobile') then raise exception 'INVALID_RUN'; end if;
  insert into public.fromis_nickname_profiles(nickname) values (v_nickname) on conflict (nickname) do nothing;
  insert into public.fromis_nickname_runs(nickname,course_version,album_ids,device)
    values (v_nickname,p_course_version,v_course.album_ids,p_device) returning * into v_run;
  -- The finish token is returned only here, never through public record queries.
  return jsonb_build_object('eligible',true,'run_id',v_run.id,'run_token',v_run.finish_token,'started_at',v_run.started_at,'course_version',v_run.course_version,'track_count',v_course.track_count,'device',v_run.device);
end;
$function$;

create or replace function public.fromis_nickname_personal(p_course_version text,p_device text default 'pc',p_nickname text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_nickname text:=btrim(regexp_replace(normalize(p_nickname,NFC),'\s+',' ','g'));
  v_best jsonb;
  v_week jsonb;
  v_recent jsonb;
  v_count bigint;
begin
  if v_nickname is null or (v_nickname collate "C") !~ $pattern$^[ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎᄀ-ᄒ\x21-\x40\x5b-\x60\x7b-\x7e]{1,6}$$pattern$ then raise exception 'INVALID_NICKNAME'; end if;
  if p_device is null or p_device not in ('pc','mobile') then raise exception 'INVALID_RUN'; end if;
  if not exists(select 1 from public.fromis_courses where version=p_course_version and enabled) then raise exception 'COURSE_NOT_FOUND'; end if;
  select jsonb_build_object('run_id',r.id,'nickname',r.nickname,'elapsed_ms',r.elapsed_ms,'cpm',r.cpm,'accuracy',r.accuracy,'finished_at',r.finished_at,'device',r.device)
    into v_best from public.fromis_nickname_runs r where nickname=v_nickname and course_version=p_course_version and device=p_device and finished_at is not null order by elapsed_ms,accuracy desc,finished_at,id limit 1;
  select jsonb_build_object('run_id',r.id,'nickname',r.nickname,'elapsed_ms',r.elapsed_ms,'cpm',r.cpm,'accuracy',r.accuracy,'finished_at',r.finished_at,'device',r.device)
    into v_week from public.fromis_nickname_runs r where nickname=v_nickname and course_version=p_course_version and device=p_device and finished_at>=now()-interval '7 days' order by elapsed_ms,accuracy desc,finished_at,id limit 1;
  select count(*) into v_count from public.fromis_nickname_runs where nickname=v_nickname and course_version=p_course_version and device=p_device and finished_at is not null;
  select coalesce(jsonb_agg(to_jsonb(recent) order by recent.finished_at desc),'[]'::jsonb) into v_recent from(
    select id as run_id,nickname,elapsed_ms,cpm,accuracy,finished_at,device from public.fromis_nickname_runs where nickname=v_nickname and course_version=p_course_version and device=p_device and finished_at is not null order by finished_at desc,id limit 5
  )recent;
  return jsonb_build_object('nickname',v_nickname,'best',v_best,'weekBest',v_week,'completedRuns',v_count,'recent',v_recent);
end;
$function$;

notify pgrst,'reload schema';
commit;
