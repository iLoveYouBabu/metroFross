-- Stop the retired personal-history lookup. Existing scores remain unchanged.
begin;
drop function if exists public.fromis_nickname_personal(text,text);
drop function if exists public.fromis_nickname_personal(text,text,text);
notify pgrst,'reload schema';
commit;
