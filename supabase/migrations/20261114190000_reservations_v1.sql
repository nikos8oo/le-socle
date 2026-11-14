-- ============ Étape 1 : réservations des adhérents ============

-- Rôle adhérent
alter table public.box_members drop constraint box_members_role_check;
alter table public.box_members add constraint box_members_role_check check (role in ('owner','coach','adherent'));

-- Lien d'inscription propre à chaque salle
alter table public.boxes add column join_code text unique default substr(replace(gen_random_uuid()::text,'-',''),1,10);
update public.boxes set join_code = substr(replace(gen_random_uuid()::text,'-',''),1,10) where join_code is null;
alter table public.boxes alter column join_code set not null;

-- Fiche adhérent reliée à un compte
alter table public.members add column user_id uuid references auth.users(id) on delete set null;
alter table public.members add column email text;
alter table public.members add column phone text;
alter table public.members add column active boolean not null default true;
create unique index members_box_user_uniq on public.members(box_id, user_id) where user_id is not null;
create index if not exists members_user_idx on public.members(user_id);

-- L'équipe (owner + coachs) : les adhérents n'en font pas partie
create or replace function private.is_member(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.box_members where box_id = b and user_id = (select auth.uid()) and role in ('owner','coach'))
         or private.is_platform_admin();
$$;

create or replace function private.is_athlete(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.box_members where box_id = b and user_id = (select auth.uid()) and role = 'adherent');
$$;

create or replace function private.my_member(b uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members where box_id = b and user_id = (select auth.uid()) limit 1;
$$;
grant execute on function private.is_athlete(uuid), private.my_member(uuid) to authenticated;

-- Ce que l'adhérent peut lire : sa salle, le planning, sa fiche
create policy "salle : adhérents lisent" on public.boxes for select to authenticated using (private.is_athlete(id));
create policy "types : adhérents lisent" on public.course_types for select to authenticated using (private.is_athlete(box_id));
create policy "cours : adhérents lisent" on public.courses for select to authenticated using (private.is_athlete(box_id));
create policy "adhérents : lire sa fiche" on public.members for select to authenticated using (user_id = (select auth.uid()));
create policy "adhérents : coachs lisent" on public.members for select to authenticated using (private.is_member(box_id));
create policy "membres : se voir" on public.box_members for select to authenticated using (user_id = (select auth.uid()));

-- Règles de réservation (modifiables par l'owner dans boxes.settings.booking)
-- open_days : jours d'ouverture à l'avance, cancel_hours : délai d'annulation sans pénalité
create or replace function private.booking_rules(b uuid, out open_days int, out cancel_hours int, out enabled boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce((settings->'booking'->>'open_days')::int, 7),
         coalesce((settings->'booking'->>'cancel_hours')::int, 2),
         coalesce((settings->'booking'->>'enabled')::boolean, true)
  from public.boxes where id = b;
$$;

-- ============ Réservations ============
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references public.boxes(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  day date not null,
  member_id uuid not null references public.members(id) on delete cascade,
  status text not null default 'reserve' check (status in ('reserve','attente','annule','annule_tard','present','absent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bookings_one_per_member on public.bookings(course_id, day, member_id);
create index bookings_box_day on public.bookings(box_id, day);
create index bookings_member on public.bookings(member_id);
alter table public.bookings enable row level security;

create policy "réservations : équipe lit" on public.bookings for select to authenticated using (private.is_member(box_id));
create policy "réservations : adhérent lit les siennes" on public.bookings for select to authenticated using (member_id = private.my_member(box_id));
create policy "réservations : owner supprime" on public.bookings for delete to authenticated using (private.is_owner(box_id));
-- toutes les écritures passent par les fonctions ci-dessous

create or replace function private.course_start(c public.courses, d date) returns timestamptz
language sql stable set search_path = '' as $$
  select (d + c.start_time) at time zone 'Europe/Paris';
$$;

-- Rejoindre une salle avec son lien d'inscription
create or replace function public.join_box(code text, full_name text default null, phone text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b uuid; uid uuid := (select auth.uid()); nm text;
begin
  if uid is null then raise exception 'Connexion requise'; end if;
  select id into b from public.boxes where join_code = code;
  if b is null then raise exception 'Lien d''inscription invalide'; end if;
  if exists(select 1 from public.box_members where box_id = b and user_id = uid) then return b; end if;
  nm := coalesce(nullif(trim(full_name),''), (select p.full_name from public.profiles p where p.id = uid), split_part((select auth.jwt()->>'email'),'@',1));
  insert into public.members(box_id, name, joined, user_id, email, phone)
    values (b, nm, current_date, uid, (select auth.jwt()->>'email'), nullif(trim(phone),''))
    on conflict (box_id, user_id) where user_id is not null do nothing;
  insert into public.box_members(box_id, user_id, role) values (b, uid, 'adherent');
  return b;
end $$;

-- Le planning de la semaine vu par un adhérent (ou par l'équipe) : places, attente, mon statut
create or replace function public.box_schedule(p_box uuid, p_from date, p_to date)
returns table(course_id uuid, day date, start_time time, type_name text, capacity int, booked int, waiting int, my_status text, my_booking uuid, my_rank int, starts_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare me uuid;
begin
  if not (private.is_member(p_box) or private.is_athlete(p_box)) then raise exception 'Accès refusé'; end if;
  me := private.my_member(p_box);
  return query
  with days as (select g::date d from generate_series(p_from, least(p_to, p_from + 31), interval '1 day') g),
  slots as (
    select c.*, dd.d from public.courses c join days dd on c.weekday = (extract(isodow from dd.d)::int - 1)
    where c.box_id = p_box
  )
  select s.id, s.d, s.start_time, s.type_name, s.capacity,
    (select count(*)::int from public.bookings k where k.course_id = s.id and k.day = s.d and k.status in ('reserve','present','absent')),
    (select count(*)::int from public.bookings k where k.course_id = s.id and k.day = s.d and k.status = 'attente'),
    mb.status, mb.id,
    case when mb.status = 'attente' then (select count(*)::int + 1 from public.bookings k where k.course_id = s.id and k.day = s.d and k.status = 'attente' and k.created_at < mb.created_at) end,
    ((s.d + s.start_time) at time zone 'Europe/Paris')
  from slots s
  left join public.bookings mb on mb.course_id = s.id and mb.day = s.d and mb.member_id = me
  order by s.d, s.start_time;
end $$;

-- Réserver une place (ou entrer en liste d'attente si c'est plein)
create or replace function public.book_course(p_course uuid, p_day date) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.courses; me uuid; r record; taken int; st text; act boolean; existing public.bookings;
begin
  select * into c from public.courses where id = p_course for update;
  if c.id is null then raise exception 'Cours introuvable'; end if;
  if not private.is_athlete(c.box_id) then raise exception 'Réservé aux adhérents de la salle'; end if;
  me := private.my_member(c.box_id);
  select active into act from public.members where id = me;
  if me is null or not act then raise exception 'Ton compte adhérent est suspendu : contacte la salle'; end if;
  select * into r from private.booking_rules(c.box_id);
  if not r.enabled then raise exception 'Les réservations sont fermées pour le moment'; end if;
  if c.weekday <> extract(isodow from p_day)::int - 1 then raise exception 'Ce cours n''a pas lieu ce jour-là'; end if;
  if private.course_start(c, p_day) <= now() then raise exception 'Ce cours a déjà commencé'; end if;
  if p_day > current_date + r.open_days then raise exception 'Les réservations ouvrent % jours avant le cours', r.open_days; end if;
  select count(*) into taken from public.bookings where course_id = c.id and day = p_day and status in ('reserve','present','absent');
  st := case when taken < c.capacity then 'reserve' else 'attente' end;
  select * into existing from public.bookings where course_id = c.id and day = p_day and member_id = me;
  if existing.id is not null then
    if existing.status in ('reserve','attente','present','absent') then return existing.status; end if;
    update public.bookings set status = st, created_at = now(), updated_at = now() where id = existing.id;
  else
    insert into public.bookings(box_id, course_id, day, member_id, status) values (c.box_id, c.id, p_day, me, st);
  end if;
  return st;
end $$;

-- Faire monter le premier de la liste d'attente
create or replace function private.promote_waitlist(p_course uuid, p_day date) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.courses; taken int; nxt uuid;
begin
  select * into c from public.courses where id = p_course;
  select count(*) into taken from public.bookings where course_id = p_course and day = p_day and status in ('reserve','present','absent');
  while taken < c.capacity loop
    select id into nxt from public.bookings where course_id = p_course and day = p_day and status = 'attente' order by created_at limit 1;
    exit when nxt is null;
    update public.bookings set status = 'reserve', updated_at = now() where id = nxt;
    taken := taken + 1;
  end loop;
end $$;

-- Annuler (par l'adhérent, ou par l'équipe)
create or replace function public.cancel_booking(p_booking uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare k public.bookings; c public.courses; r record; st text;
begin
  select * into k from public.bookings where id = p_booking for update;
  if k.id is null then raise exception 'Réservation introuvable'; end if;
  if not (k.member_id = private.my_member(k.box_id) or private.is_member(k.box_id)) then raise exception 'Accès refusé'; end if;
  if k.status not in ('reserve','attente') then raise exception 'Cette réservation ne peut plus être annulée'; end if;
  select * into c from public.courses where id = k.course_id for update;
  if private.course_start(c, k.day) <= now() and not private.is_member(k.box_id) then raise exception 'Le cours a déjà commencé'; end if;
  select * into r from private.booking_rules(k.box_id);
  st := case when k.status = 'reserve' and not private.is_member(k.box_id) and private.course_start(c, k.day) - make_interval(hours => r.cancel_hours) < now() then 'annule_tard' else 'annule' end;
  update public.bookings set status = st, updated_at = now() where id = k.id;
  perform private.promote_waitlist(k.course_id, k.day);
  return st;
end $$;

-- Fréquentation calculée automatiquement à partir de l'appel
create or replace function private.sync_attendance(p_course uuid, p_day date) returns void
language plpgsql security definer set search_path = '' as $$
declare n int; b uuid;
begin
  select box_id into b from public.courses where id = p_course;
  if exists(select 1 from public.bookings where course_id = p_course and day = p_day and status in ('present','absent')) then
    select count(*) into n from public.bookings where course_id = p_course and day = p_day and status = 'present';
    insert into public.attendance(course_id, box_id, day, present) values (p_course, b, p_day, n)
      on conflict (course_id, day) do update set present = excluded.present;
  end if;
end $$;

-- Faire l'appel : présent / absent / retour à « réservé »
create or replace function public.mark_presence(p_booking uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.bookings;
begin
  if p_status not in ('present','absent','reserve') then raise exception 'Statut invalide'; end if;
  select * into k from public.bookings where id = p_booking for update;
  if k.id is null or not private.is_member(k.box_id) then raise exception 'Accès refusé'; end if;
  update public.bookings set status = p_status, updated_at = now() where id = k.id;
  if p_status = 'present' then
    update public.members set last_visit = greatest(coalesce(last_visit, k.day), k.day) where id = k.member_id;
  end if;
  perform private.sync_attendance(k.course_id, k.day);
end $$;

-- Ajouter un adhérent venu sans réserver
create or replace function public.add_walkin(p_course uuid, p_day date, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.courses;
begin
  select * into c from public.courses where id = p_course;
  if c.id is null or not private.is_member(c.box_id) then raise exception 'Accès refusé'; end if;
  if not exists(select 1 from public.members where id = p_member and box_id = c.box_id) then raise exception 'Adhérent introuvable'; end if;
  insert into public.bookings(box_id, course_id, day, member_id, status) values (c.box_id, c.id, p_day, p_member, 'present')
    on conflict (course_id, day, member_id) do update set status = 'present', updated_at = now();
  update public.members set last_visit = greatest(coalesce(last_visit, p_day), p_day) where id = p_member;
  perform private.sync_attendance(c.id, p_day);
end $$;

-- Nouveau lien d'inscription (si l'ancien a trop circulé)
create or replace function public.reset_join_code(p_box uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare code text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
begin
  if not private.is_owner(p_box) then raise exception 'Réservé à l''owner'; end if;
  update public.boxes set join_code = code where id = p_box;
  return code;
end $$;

revoke execute on function public.join_box(text, text, text), public.box_schedule(uuid, date, date), public.book_course(uuid, date),
  public.cancel_booking(uuid), public.mark_presence(uuid, text), public.add_walkin(uuid, date, uuid), public.reset_join_code(uuid) from public, anon;
grant execute on function public.join_box(text, text, text), public.box_schedule(uuid, date, date), public.book_course(uuid, date),
  public.cancel_booking(uuid), public.mark_presence(uuid, text), public.add_walkin(uuid, date, uuid), public.reset_join_code(uuid) to authenticated;

-- Suivi en direct des réservations
alter publication supabase_realtime add table public.bookings;
