drop function public.subscription_usage(uuid, date);
create or replace function public.subscription_usage(p_box uuid, p_day date default current_date)
returns table(id uuid, member_id uuid, plan_id uuid, name text, kind text, per_week int, sessions int, status text, start_date date, end_date date,
              commitment_until date, price_cents int, period text, source text, payment_method text, used_total int, used_week int, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare me uuid;
begin
  if private.is_owner(p_box) then me := null;
  elsif private.is_athlete(p_box) then me := private.my_member(p_box);
  else raise exception 'Accès refusé'; end if;
  return query
  select s.id, s.member_id, s.plan_id, s.name, s.kind, s.per_week, s.sessions, s.status, s.start_date, s.end_date, s.commitment_until, s.price_cents, s.period, s.source, s.payment_method,
    (select count(*)::int from public.bookings k where k.subscription_id = s.id and private.counts(k.status)),
    (select count(*)::int from public.bookings k where k.subscription_id = s.id and private.counts(k.status) and date_trunc('week', k.day) = date_trunc('week', p_day::timestamp)),
    s.created_at
  from public.subscriptions s
  where s.box_id = p_box and (me is null or s.member_id = me)
  order by case s.status when 'attente_paiement' then 0 when 'active' then 1 when 'suspendue' then 2 else 3 end, s.created_at desc;
end $$;
revoke execute on function public.subscription_usage(uuid, date) from public, anon;
grant execute on function public.subscription_usage(uuid, date) to authenticated;
