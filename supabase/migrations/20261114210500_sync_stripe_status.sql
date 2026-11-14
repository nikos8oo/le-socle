-- Vérifie auprès de Stripe si le compte d'une salle peut encaisser (comptes Accounts v2)
create or replace function public.refresh_stripe_status(p_box uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare acct text; enabled boolean; r extensions.http_response; card text;
begin
  if not (private.is_member(p_box) or private.is_athlete(p_box)) then raise exception 'Accès refusé'; end if;
  select stripe_account_id, stripe_charges_enabled into acct, enabled from public.boxes where id = p_box;
  if acct is null then return false; end if;
  if enabled then return true; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
  select * into r from extensions.http(('GET', 'https://api.stripe.com/v2/core/accounts/' || acct || '?include=configuration.merchant',
    array[extensions.http_header('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'stripe_secret_key')),
          extensions.http_header('Stripe-Version', '2026-10-28.endive')], null, null)::extensions.http_request);
  if r.status <> 200 then return false; end if;
  card := r.content::jsonb #>> '{configuration,merchant,capabilities,card_payments,status}';
  update public.boxes set stripe_charges_enabled = (card = 'active'), stripe_details_submitted = card in ('active','pending') where id = p_box;
  return card = 'active';
end $$;
revoke execute on function public.refresh_stripe_status(uuid) from public, anon;
grant execute on function public.refresh_stripe_status(uuid) to authenticated;
