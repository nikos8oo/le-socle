-- Console admin : état du paiement en ligne de chaque salle
drop function public.admin_overview();
create or replace function public.admin_overview()
returns table(id uuid, name text, city text, status text, join_code text, created_at timestamptz, admin_notes text,
              owners text, coaches int, adherents int, active_subs int, mrr_cents int, bookings_30 int, presents_30 int,
              pending_invites int, last_activity timestamptz, stripe_account_id text, stripe_charges_enabled boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_platform_admin() then raise exception 'Réservé à l''administrateur Drill''s & Skills'; end if;
  return query
  select b.id, b.name, b.city, b.status, b.join_code, b.created_at, b.admin_notes,
    (select string_agg(u.email, ', ') from public.box_members m join auth.users u on u.id = m.user_id where m.box_id = b.id and m.role = 'owner'),
    (select count(*)::int from public.coaches c where c.box_id = b.id),
    (select count(*)::int from public.members mb where mb.box_id = b.id and mb.active),
    (select count(*)::int from public.subscriptions s where s.box_id = b.id and s.status = 'active'),
    (select coalesce(sum(case s.period when 'trimestre' then s.price_cents / 3 when 'annee' then s.price_cents / 12 else s.price_cents end), 0)::int
       from public.subscriptions s where s.box_id = b.id and s.status = 'active' and s.kind <> 'carnet' and s.period <> 'unique'),
    (select count(*)::int from public.bookings k where k.box_id = b.id and k.day between current_date - 30 and current_date and k.status in ('reserve','present','absent')),
    (select count(*)::int from public.bookings k where k.box_id = b.id and k.day between current_date - 30 and current_date and k.status = 'present'),
    (select count(*)::int from public.invitations i where i.box_id = b.id and i.accepted_at is null),
    greatest((select max(j.created_at) from public.journal j where j.box_id = b.id), (select max(k.updated_at) from public.bookings k where k.box_id = b.id)),
    b.stripe_account_id, b.stripe_charges_enabled
  from public.boxes b
  order by case b.status when 'active' then 0 when 'pilote' then 1 when 'suspendue' then 2 else 3 end, b.name;
end $$;

revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;
