-- Module réservations : réservation adhérent, formules en boutique, paiement en ligne.
-- Désactivé par défaut pour les nouvelles salles (Le Socle se pose à côté de leur logiciel de réservation).
-- Seul Drill's & Skills (super admin) l'active ou le coupe, salle par salle.
alter table public.boxes add column booking_module boolean not null default false;
grant select (booking_module) on public.boxes to authenticated;

-- Les salles existantes l'utilisent déjà : on ne casse rien.
update public.boxes set booking_module = true;

-- Garde : colonne réservée au super admin (et une démo montre tout)
create or replace function private.guard_booking_module() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.is_demo then new.booking_module := true;
    elsif (select auth.uid()) is not null and coalesce((select auth.role()), '') <> 'service_role' and not private.is_platform_admin() then
      new.booking_module := false;
    end if;
  elsif new.booking_module is distinct from old.booking_module
     and (select auth.uid()) is not null and coalesce((select auth.role()), '') <> 'service_role' and not private.is_platform_admin() then
    raise exception 'Le module réservations est activé par Drill''s & Skills';
  end if;
  return new;
end $$;
create trigger boxes_booking_module before insert or update on public.boxes
  for each row execute function private.guard_booking_module();

-- Côté adhérent, tout passe par le module : inscription, réservation, achat de formule.
-- L'équipe de la salle (pointage, venu sans réserver, formule attribuée à la main) n'est pas bloquée.
create or replace function private.require_booking_module() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce((select auth.role()), '') = 'service_role' then return new; end if;
  if private.is_member(new.box_id) then return new; end if;
  if not exists(select 1 from public.boxes where id = new.box_id and booking_module) then
    raise exception 'Cette salle n''utilise pas la réservation dans Le Socle';
  end if;
  return new;
end $$;
create trigger bookings_module before insert on public.bookings for each row execute function private.require_booking_module();
create trigger subscriptions_module before insert on public.subscriptions for each row execute function private.require_booking_module();
create trigger box_members_module before insert on public.box_members for each row
  when (new.role = 'adherent') execute function private.require_booking_module();

-- Console : on expose l'état du module
drop function if exists public.admin_overview();
create function public.admin_overview()
returns table(id uuid, name text, city text, status text, join_code text, created_at timestamptz, admin_notes text,
              owners text, coaches int, adherents int, active_subs int, mrr_cents int, bookings_30 int, presents_30 int,
              pending_invites int, last_activity timestamptz, stripe_account_id text, stripe_charges_enabled boolean, is_demo boolean, booking_module boolean)
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
    b.stripe_account_id, b.stripe_charges_enabled, b.is_demo, b.booking_module
  from public.boxes b
  order by case b.status when 'active' then 0 when 'pilote' then 1 when 'suspendue' then 2 else 3 end, b.name;
end $$;

revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;
