-- PetriKlar: Repariert die selbstständige Kontolöschung und aktualisiert
-- anschließend den PostgREST-Schema-Cache.
-- Einmal vollständig im Supabase SQL Editor ausführen.

drop function if exists public.delete_own_account();

create function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- app_state besitzt zusätzlich ON DELETE CASCADE. Die explizite Löschung
  -- stellt sicher, dass die App-Daten bereits vor dem Auth-Konto verschwinden.
  delete from public.app_state where user_id = v_user_id;
  delete from auth.users where id = v_user_id;

  if not found then
    raise exception 'account_not_found';
  end if;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Deletes the authenticated PetriKlar user and their app_state row.';

notify pgrst, 'reload schema';

