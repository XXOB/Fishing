-- PetriKlar Phase 1: persönlicher Cloud-State, RLS und selbstständige Kontolöschung.
-- Einmal im Supabase SQL Editor ausführen.

create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "app_state_select_own" on public.app_state;
drop policy if exists "app_state_insert_own" on public.app_state;
drop policy if exists "app_state_update_own" on public.app_state;
drop policy if exists "app_state_delete_own" on public.app_state;

create policy "app_state_select_own" on public.app_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "app_state_insert_own" on public.app_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "app_state_update_own" on public.app_state
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "app_state_delete_own" on public.app_state
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.app_state from anon;
grant select, insert, update, delete on table public.app_state to authenticated;

create or replace function public.delete_own_account()
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
  delete from public.app_state where user_id = v_user_id;
  delete from auth.users where id = v_user_id;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- Neue oder geänderte RPC-Funktionen unmittelbar für die Data API sichtbar machen.
notify pgrst, 'reload schema';
