-- ============ Formules et abonnements ============

-- Le catalogue de la salle
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references public.boxes(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('hebdo','illimite','carnet')),
  per_week int check (per_week between 1 and 14),          -- hebdo : séances par semaine
  sessions int check (sessions between 1 and 200),          -- carnet : nombre de séances
  validity_days int check (validity_days between 1 and 1095), -- carnet : durée de validité
  price_cents int not null default 0 check (price_cents >= 0),
  period text not null default 'mois' check (period in ('mois','trimestre','annee','unique')),
  commitment_months int not null default 0 check (commitment_months between 0 and 36),
  course_types text[],                                      -- null = tous les cours
  description text,
  for_sale boolean not null default true,                   -- visible dans la boutique adhérent
  active boolean not null default true,                     -- false = archivée
  sort int not null default 0,
  created_at timestamptz not null default now(),
  check ((kind = 'hebdo' and per_week is not null) or kind <> 'hebdo'),
  check ((kind = 'carnet' and sessions is not null) or kind <> 'carnet')
);
create index plans_box on public.plans(box_id);
alter table public.plans enable row level security;
create policy "formules : équipe lit" on public.plans for select to authenticated using (private.is_member(box_id));
create policy "formules : adhérents voient la boutique" on public.plans for select to authenticated using (private.is_athlete(box_id) and active and for_sale);
create policy "formules : owner écrit" on public.plans for insert to authenticated with check (private.is_owner(box_id));
create policy "formules : owner modifie" on public.plans for update to authenticated using (private.is_owner(box_id)) with check (private.is_owner(box_id));
create policy "formules : owner supprime" on public.plans for delete to authenticated using (private.is_owner(box_id));

-- L'abonnement d'un adhérent : copie des règles de la formule au moment de l'achat
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references public.boxes(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  name text not null,
  kind text not null check (kind in ('hebdo','illimite','carnet')),
  per_week int,
  sessions int,
  course_types text[],
  price_cents int not null default 0,
  period text not null default 'mois',
  start_date date not null default current_date,
  end_date date,                       -- null = sans fin (renouvellement mensuel)
  commitment_until date,
  status text not null default 'active' check (status in ('attente_paiement','active','suspendue','terminee')),
  source text not null default 'owner' check (source in ('owner','achat')),
  payment_method text,                 -- sur_place, virement, en_ligne…
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index subscriptions_box on public.subscriptions(box_id);
create index subscriptions_member on public.subscriptions(member_id);
create index subscriptions_plan on public.subscriptions(plan_id);
alter table public.subscriptions enable row level security;
create policy "abonnements : owner" on public.subscriptions for all to authenticated using (private.is_owner(box_id)) with check (private.is_owner(box_id));
create policy "abonnements : adhérent voit les siens" on public.subscriptions for select to authenticated using (member_id = private.my_member(box_id));

alter table public.bookings add column subscription_id uuid references public.subscriptions(id) on delete set null;
create index bookings_subscription on public.bookings(subscription_id);

-- Séances qui comptent dans un quota : réservées, en attente, faites, manquées, annulées trop tard
create or replace function private.counts(st text) returns boolean
language sql immutable set search_path = '' as $$ select st in ('reserve','attente','present','absent','annule_tard') $$;

-- Choisir la formule qui couvre ce cours ce jour-là (illimité d'abord, puis hebdo, puis carnet)
create or replace function private.pick_subscription(p_member uuid, p_type text, p_day date, p_ignore uuid default null, out sub uuid, out reason text)
language plpgsql stable security definer set search_path = '' as $$
declare s public.subscriptions; used int;
begin
  for s in
    select * from public.subscriptions
    where member_id = p_member and status = 'active' and start_date <= p_day and (end_date is null or end_date >= p_day)
      and (course_types is null or p_type = any(course_types))
    order by case kind when 'illimite' then 0 when 'hebdo' then 1 else 2 end, end_date nulls last, created_at
  loop
    if s.kind = 'illimite' then sub := s.id; return; end if;
    if s.kind = 'hebdo' then
      select count(*) into used from public.bookings
        where subscription_id = s.id and private.counts(status) and date_trunc('week', day) = date_trunc('week', p_day::timestamp)
          and (p_ignore is null or id <> p_ignore);
      if used < s.per_week then sub := s.id; return; end if;
      reason := 'Ta formule ' || s.name || ' est complète pour cette semaine (' || s.per_week || ' séance' || case when s.per_week > 1 then 's' else '' end || ').';
    else
      select count(*) into used from public.bookings where subscription_id = s.id and private.counts(status) and (p_ignore is null or id <> p_ignore);
      if used < s.sessions then sub := s.id; return; end if;
      reason := coalesce(reason, 'Ton ' || s.name || ' est épuisé : rachète un carnet dans la Boutique.');
    end if;
  end loop;
  if reason is null then
    if exists(select 1 from public.subscriptions where member_id = p_member and status = 'attente_paiement') then
      reason := 'Ta formule attend la validation du paiement par la salle.';
    elsif exists(select 1 from public.subscriptions where member_id = p_member and status = 'active' and start_date <= p_day and (end_date is null or end_date >= p_day)) then
      reason := 'Ta formule ne comprend pas ce type de cours.';
    else
      reason := 'Il te faut une formule active pour réserver ce jour-là : choisis-en une dans la Boutique.';
    end if;
  end if;
end $$;

-- Réserver : on vérifie maintenant la formule
create or replace function public.book_course(p_course uuid, p_day date) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.courses; me uuid; r record; taken int; st text; act boolean; existing public.bookings; ps record; need boolean;
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
  select * into existing from public.bookings where course_id = c.id and day = p_day and member_id = me;
  if existing.id is not null and existing.status in ('reserve','attente','present','absent') then return existing.status; end if;

  select * into ps from private.pick_subscription(me, c.type_name, p_day, existing.id);
  need := coalesce((select (settings->'booking'->>'require_plan')::boolean from public.boxes where id = c.box_id), true)
          and exists(select 1 from public.plans where box_id = c.box_id and active);
  if need and ps.sub is null then raise exception '%', ps.reason; end if;

  select count(*) into taken from public.bookings where course_id = c.id and day = p_day and status in ('reserve','present','absent');
  st := case when taken < c.capacity then 'reserve' else 'attente' end;
  if existing.id is not null then
    update public.bookings set status = st, subscription_id = ps.sub, created_at = now(), updated_at = now() where id = existing.id;
  else
    insert into public.bookings(box_id, course_id, day, member_id, status, subscription_id) values (c.box_id, c.id, p_day, me, st, ps.sub);
  end if;
  return st;
end $$;

-- Venu sans réserver : on rattache la séance à sa formule si possible (sans bloquer)
create or replace function public.add_walkin(p_course uuid, p_day date, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.courses; ps record;
begin
  select * into c from public.courses where id = p_course;
  if c.id is null or not private.is_member(c.box_id) then raise exception 'Accès refusé'; end if;
  if not exists(select 1 from public.members where id = p_member and box_id = c.box_id) then raise exception 'Adhérent introuvable'; end if;
  select * into ps from private.pick_subscription(p_member, c.type_name, p_day);
  insert into public.bookings(box_id, course_id, day, member_id, status, subscription_id) values (c.box_id, c.id, p_day, p_member, 'present', ps.sub)
    on conflict (course_id, day, member_id) do update set status = 'present', subscription_id = coalesce(public.bookings.subscription_id, excluded.subscription_id), updated_at = now();
  update public.members set last_visit = greatest(coalesce(last_visit, p_day), p_day) where id = p_member;
  perform private.sync_attendance(c.id, p_day);
end $$;

-- Créer l'abonnement à partir d'une formule (copie des règles)
create or replace function private.make_subscription(p_plan public.plans, p_member uuid, p_start date, p_status text, p_source text, p_method text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.subscriptions(box_id, member_id, plan_id, name, kind, per_week, sessions, course_types, price_cents, period, start_date, end_date, commitment_until, status, source, payment_method, paid_at)
  values (p_plan.box_id, p_member, p_plan.id, p_plan.name, p_plan.kind, p_plan.per_week, p_plan.sessions, p_plan.course_types, p_plan.price_cents, p_plan.period, p_start,
    case when p_plan.kind = 'carnet' and p_plan.validity_days is not null then p_start + p_plan.validity_days end,
    case when p_plan.commitment_months > 0 then (p_start + make_interval(months => p_plan.commitment_months))::date end,
    p_status, p_source, p_method, case when p_status = 'active' then now() end)
  returning subscriptions.id into v_id;
  return v_id;
end $$;

-- L'adhérent choisit une formule dans la boutique (paiement à la salle pour l'instant)
create or replace function public.request_plan(p_plan uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.plans; me uuid;
begin
  select * into p from public.plans where id = p_plan;
  if p.id is null or not p.active or not p.for_sale then raise exception 'Formule indisponible'; end if;
  if not private.is_athlete(p.box_id) then raise exception 'Réservé aux adhérents de la salle'; end if;
  me := private.my_member(p.box_id);
  if exists(select 1 from public.subscriptions where member_id = me and plan_id = p.id and status = 'attente_paiement') then
    raise exception 'Tu as déjà une demande en cours pour cette formule';
  end if;
  return private.make_subscription(p, me, current_date, 'attente_paiement', 'achat', null);
end $$;

-- L'owner attribue une formule à un adhérent
create or replace function public.assign_plan(p_member uuid, p_plan uuid, p_start date, p_method text default 'sur_place') returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.plans;
begin
  select * into p from public.plans where id = p_plan;
  if p.id is null or not private.is_owner(p.box_id) then raise exception 'Accès refusé'; end if;
  if not exists(select 1 from public.members where id = p_member and box_id = p.box_id) then raise exception 'Adhérent introuvable'; end if;
  return private.make_subscription(p, p_member, coalesce(p_start, current_date), 'active', 'owner', p_method);
end $$;

-- L'owner valide une demande (paiement reçu)
create or replace function public.activate_subscription(p_sub uuid, p_method text default 'sur_place', p_start date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions; p public.plans; st date;
begin
  select * into s from public.subscriptions where id = p_sub for update;
  if s.id is null or not private.is_owner(s.box_id) then raise exception 'Accès refusé'; end if;
  select * into p from public.plans where id = s.plan_id;
  st := coalesce(p_start, greatest(s.start_date, current_date));
  update public.subscriptions set status = 'active', paid_at = now(), payment_method = p_method, start_date = st,
    end_date = case when s.kind = 'carnet' and p.validity_days is not null then st + p.validity_days else s.end_date end,
    commitment_until = case when coalesce(p.commitment_months, 0) > 0 then (st + make_interval(months => p.commitment_months))::date else s.commitment_until end
  where id = s.id;
end $$;

-- Où en est chaque abonnement : séances utilisées (au total, et sur la semaine du jour donné)
create or replace function public.subscription_usage(p_box uuid, p_day date default current_date)
returns table(id uuid, member_id uuid, name text, kind text, per_week int, sessions int, status text, start_date date, end_date date,
              commitment_until date, price_cents int, period text, source text, payment_method text, used_total int, used_week int, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare me uuid;
begin
  if private.is_owner(p_box) then me := null;
  elsif private.is_athlete(p_box) then me := private.my_member(p_box);
  else raise exception 'Accès refusé'; end if;
  return query
  select s.id, s.member_id, s.name, s.kind, s.per_week, s.sessions, s.status, s.start_date, s.end_date, s.commitment_until, s.price_cents, s.period, s.source, s.payment_method,
    (select count(*)::int from public.bookings k where k.subscription_id = s.id and private.counts(k.status)),
    (select count(*)::int from public.bookings k where k.subscription_id = s.id and private.counts(k.status) and date_trunc('week', k.day) = date_trunc('week', p_day::timestamp)),
    s.created_at
  from public.subscriptions s
  where s.box_id = p_box and (me is null or s.member_id = me)
  order by case s.status when 'attente_paiement' then 0 when 'active' then 1 when 'suspendue' then 2 else 3 end, s.created_at desc;
end $$;

revoke execute on function public.request_plan(uuid), public.assign_plan(uuid, uuid, date, text), public.activate_subscription(uuid, text, date),
  public.subscription_usage(uuid, date) from public, anon;
grant execute on function public.request_plan(uuid), public.assign_plan(uuid, uuid, date, text), public.activate_subscription(uuid, text, date),
  public.subscription_usage(uuid, date) to authenticated;
