-- ============ Un coach par cours (et remplacements) → transformation par coach automatique ============
alter table public.courses add column coach_id uuid references public.coaches(id) on delete set null;
create index if not exists courses_coach on public.courses(coach_id);

-- Remplacement ponctuel : un autre coach donne ce cours ce jour-là
create table public.course_coach_overrides (
  course_id uuid not null references public.courses(id) on delete cascade,
  day date not null,
  box_id uuid not null references public.boxes(id) on delete cascade,
  coach_id uuid references public.coaches(id) on delete cascade,
  primary key (course_id, day)
);
create index on public.course_coach_overrides(box_id, day);
create index on public.course_coach_overrides(coach_id);
alter table public.course_coach_overrides enable row level security;
create policy "remplacements : équipe lit" on public.course_coach_overrides for select to authenticated using (private.is_member(box_id));
create policy "remplacements : owner écrit" on public.course_coach_overrides for all to authenticated using (private.is_owner(box_id)) with check (private.is_owner(box_id));

-- Qui donne ce cours ce jour-là ?
create or replace function private.coach_for(p_course uuid, p_day date) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce((select o.coach_id from public.course_coach_overrides o where o.course_id = p_course and o.day = p_day),
                  (select c.coach_id from public.courses c where c.id = p_course));
$$;

-- L'essai réservé est attribué au coach du cours
create or replace function private.sync_trial_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if not new.is_trial then
    delete from public.trials where booking_id = new.id;
    return new;
  end if;
  if new.status = 'annule' then
    delete from public.trials where booking_id = new.id and result = 'att';
  elsif not exists(select 1 from public.trials where booking_id = new.id) then
    select name into nm from public.members where id = new.member_id;
    insert into public.trials(box_id, day, prospect, coach_id, result, member_id, booking_id, created_by)
    values (new.box_id, new.day, nm, private.coach_for(new.course_id, new.day), 'att', new.member_id, new.id, null);
  end if;
  return new;
end $$;

-- Si l'owner change le coach d'un cours ou fait un remplacement, les essais concernés suivent
create or replace function private.refresh_trial_coaches(p_course uuid, p_day date default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.trials t set coach_id = private.coach_for(b.course_id, b.day)
  from public.bookings b
  where t.booking_id = b.id and b.course_id = p_course and (p_day is null or b.day = p_day)
    and t.coach_id is distinct from private.coach_for(b.course_id, b.day);
end $$;

create or replace function private.on_course_coach_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.coach_id is distinct from old.coach_id then perform private.refresh_trial_coaches(new.id); end if;
  return new;
end $$;
create trigger courses_coach_change after update of coach_id on public.courses for each row execute function private.on_course_coach_change();

create or replace function private.on_override_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform private.refresh_trial_coaches(old.course_id, old.day); return old; end if;
  perform private.refresh_trial_coaches(new.course_id, new.day);
  return new;
end $$;
create trigger overrides_change after insert or update or delete on public.course_coach_overrides for each row execute function private.on_override_change();

-- Le planning adhérent affiche le coach du cours
drop function public.box_schedule(uuid, date, date);
create or replace function public.box_schedule(p_box uuid, p_from date, p_to date)
returns table(course_id uuid, day date, start_time time, type_name text, capacity int, booked int, waiting int, my_status text, my_booking uuid, my_rank int, starts_at timestamptz, label text, coach_name text)
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
    ((s.d + s.start_time) at time zone 'Europe/Paris'),
    s.label,
    (select co.name from public.coaches co where co.id = private.coach_for(s.id, s.d))
  from slots s
  left join public.bookings mb on mb.course_id = s.id and mb.day = s.d and mb.member_id = me
  order by s.d, s.start_time, s.type_name;
end $$;
revoke execute on function public.box_schedule(uuid, date, date) from public, anon;
grant execute on function public.box_schedule(uuid, date, date) to authenticated;
