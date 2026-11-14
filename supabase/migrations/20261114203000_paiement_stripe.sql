-- ============ Paiement en ligne (Stripe Connect) ============
-- Chaque salle a son propre compte Stripe (Express). Les paiements des adhérents arrivent directement dessus.

alter table public.boxes add column stripe_account_id text;
alter table public.boxes add column stripe_charges_enabled boolean not null default false;
alter table public.boxes add column stripe_details_submitted boolean not null default false;

alter table public.members add column stripe_customer_id text;

alter table public.subscriptions add column stripe_subscription_id text unique;
alter table public.subscriptions add column stripe_session_id text unique;
alter table public.subscriptions add column stripe_customer_id text;
alter table public.subscriptions add column current_period_end date;
alter table public.subscriptions add column payment_issue text;  -- dernier problème de paiement (carte refusée…)

-- Les colonnes Stripe ne sont modifiables que par le serveur
create or replace function private.guard_stripe_columns() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.role()), '') = 'service_role' or current_user in ('postgres', 'supabase_admin') then return new; end if;
  if tg_table_name = 'boxes' and (new.stripe_account_id is distinct from old.stripe_account_id
      or new.stripe_charges_enabled is distinct from old.stripe_charges_enabled
      or new.stripe_details_submitted is distinct from old.stripe_details_submitted) then
    raise exception 'Les réglages Stripe sont gérés automatiquement';
  end if;
  if tg_table_name = 'members' and new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'Les réglages Stripe sont gérés automatiquement';
  end if;
  if tg_table_name = 'subscriptions' and (new.stripe_subscription_id is distinct from old.stripe_subscription_id
      or new.stripe_session_id is distinct from old.stripe_session_id or new.stripe_customer_id is distinct from old.stripe_customer_id) then
    raise exception 'Les réglages Stripe sont gérés automatiquement';
  end if;
  return new;
end $$;
create trigger guard_stripe_boxes before update on public.boxes for each row execute function private.guard_stripe_columns();
create trigger guard_stripe_members before update on public.members for each row execute function private.guard_stripe_columns();
create trigger guard_stripe_subs before update on public.subscriptions for each row execute function private.guard_stripe_columns();

-- Secrets de la plateforme (clé Stripe, secret du webhook) : chiffrés dans le coffre Supabase,
-- lisibles uniquement par le serveur (service_role)
create or replace function public.platform_secret(secret_name text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$$;
revoke execute on function public.platform_secret(text) from public, anon, authenticated;
grant execute on function public.platform_secret(text) to service_role;

create or replace function public.platform_set_secret(secret_name text, secret_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = secret_name;
  if sid is null then perform vault.create_secret(secret_value, secret_name);
  else perform vault.update_secret(sid, secret_value); end if;
end $$;
revoke execute on function public.platform_set_secret(text, text) from public, anon, authenticated;
grant execute on function public.platform_set_secret(text, text) to service_role;
