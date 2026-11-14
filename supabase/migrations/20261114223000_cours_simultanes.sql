-- ============ Jusqu'à 3 cours sur le même créneau ============
alter table public.courses drop constraint if exists courses_box_id_weekday_start_time_key;
alter table public.courses add column label text;   -- zone ou salle, ex. « Salle 1 », « Zone haltéro »
create index if not exists courses_slot on public.courses(box_id, weekday, start_time);

create or replace function private.max_courses_per_slot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.courses where box_id = new.box_id and weekday = new.weekday and start_time = new.start_time and id <> new.id) >= 3 then
    raise exception 'Maximum 3 cours sur le même créneau';
  end if;
  return new;
end $$;
create trigger courses_max_per_slot before insert or update of weekday, start_time on public.courses for each row execute function private.max_courses_per_slot();

-- Le planning renvoie aussi la zone du cours
drop function public.box_schedule(uuid, date, date);
create or replace function public.box_schedule(p_box uuid, p_from date, p_to date)
returns table(course_id uuid, day date, start_time time, type_name text, capacity int, booked int, waiting int, my_status text, my_booking uuid, my_rank int, starts_at timestamptz, label text)
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
    s.label
  from slots s
  left join public.bookings mb on mb.course_id = s.id and mb.day = s.d and mb.member_id = me
  order by s.d, s.start_time, s.type_name;
end $$;
revoke execute on function public.box_schedule(uuid, date, date) from public, anon;
grant execute on function public.box_schedule(uuid, date, date) to authenticated;
