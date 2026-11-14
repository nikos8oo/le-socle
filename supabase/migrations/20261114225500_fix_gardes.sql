-- Correctif : dans une fonction « security definer », current_user est le propriétaire de la fonction.
-- On identifie donc l'appelant par son jeton (auth.uid / auth.role) : sans jeton = maintenance directe en base.
create or replace function private.guard_box_admin_columns() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and coalesce((select auth.role()), '') <> 'service_role' and not private.is_platform_admin()
     and (new.status is distinct from old.status or new.admin_notes is distinct from old.admin_notes) then
    raise exception 'Réservé à Drill''s & Skills';
  end if;
  if coalesce(trim(new.name), '') = '' then raise exception 'Le nom de la salle est obligatoire'; end if;
  new.name := trim(new.name);
  return new;
end $$;

create or replace function private.guard_stripe_columns() returns trigger
language plpgsql security definer set search_path = '' as $$
declare changed boolean := false;
begin
  if (select auth.uid()) is null or coalesce((select auth.role()), '') = 'service_role' then return new; end if;
  -- comparaison par table (un champ absent d'une table ferait échouer l'expression)
  if tg_table_name = 'boxes' then
    changed := (to_jsonb(new) -> 'stripe_account_id') is distinct from (to_jsonb(old) -> 'stripe_account_id')
            or (to_jsonb(new) -> 'stripe_charges_enabled') is distinct from (to_jsonb(old) -> 'stripe_charges_enabled')
            or (to_jsonb(new) -> 'stripe_details_submitted') is distinct from (to_jsonb(old) -> 'stripe_details_submitted');
  elsif tg_table_name = 'members' then
    changed := (to_jsonb(new) -> 'stripe_customer_id') is distinct from (to_jsonb(old) -> 'stripe_customer_id');
  elsif tg_table_name = 'subscriptions' then
    changed := (to_jsonb(new) -> 'stripe_subscription_id') is distinct from (to_jsonb(old) -> 'stripe_subscription_id')
            or (to_jsonb(new) -> 'stripe_session_id') is distinct from (to_jsonb(old) -> 'stripe_session_id')
            or (to_jsonb(new) -> 'stripe_customer_id') is distinct from (to_jsonb(old) -> 'stripe_customer_id');
  end if;
  if changed then raise exception 'Les réglages Stripe sont gérés automatiquement'; end if;
  return new;
end $$;
