-- ============ Séances d'essai offertes aux nouveaux inscrits ============
-- Réglages (boxes.settings.booking) : trial_sessions (nombre offert, 1 par défaut, 0 = aucun),
-- trial_course_types (types de cours ouverts à l'essai, absent = tous)

alter table public.bookings add column is_trial boolean not null default false;
alter table public.trials add column member_id uuid references public.members(id) on delete set null;
alter table public.trials add column booking_id uuid references public.bookings(id) on delete set null;
create index if not exists trials_member on public.trials(member_id);
create unique index if not exists trials_booking_uniq on public.trials(booking_id) where booking_id is not null;

-- Où en est l'adhérent : essais offerts, utilisés, cours ouverts, droit à l'essai
create or replace function private.trial_state(p_member uuid, out allowed int, out used int, out types text[], out eligible boolean)
language plpgsql stable security definer set search_path = '' as $$
declare b uuid; s jsonb;
begin
  select box_id into b from public.members where id = p_member;
  select settings->'booking' into s from public.boxes where id = b;
  allowed := coalesce((s->>'trial_sessions')::int, 1);
  types := case when jsonb_typeof(s->'trial_course_types') = 'array' and jsonb_array_length(s->'trial_course_types') > 0
                then array(select jsonb_array_elements_text(s->'trial_course_types')) end;
  select count(*) into used from public.bookings where member_id = p_member and is_trial and private.counts(status);
  -- l'essai est réservé à ceux qui n'ont encore jamais eu de formule
  eligible := not exists(select 1 from public.subscriptions where member_id = p_member and status in ('active','suspendue','terminee'));
end $$;

-- Pour l'écran adhérent
create or replace function public.my_trial(p_box uuid) returns table(allowed int, used int, types text[], eligible boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid;
begin
  if not private.is_athlete(p_box) then return; end if;
  me := private.my_member(p_box);
  return query select t.allowed, t.used, t.types, t.eligible from private.trial_state(me) t;
end $$;

-- Réserver : si aucune formule ne couvre le cours, on regarde la séance d'essai
create or replace function public.book_course(p_course uuid, p_day date) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.courses; me uuid; r record; taken int; st text; act boolean; existing public.bookings; ps record; need boolean; tr record; trial boolean := false;
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
  if need and ps.sub is null then
    select * into tr from private.trial_state(me);
    if tr.eligible and tr.used < tr.allowed then
      if tr.types is not null and not (c.type_name = any(tr.types)) then
        raise exception 'Ce cours n''est pas ouvert aux séances d''essai. Cours possibles : %.', array_to_string(tr.types, ', ');
      end if;
      trial := true;
    elsif tr.eligible and tr.allowed > 0 then
      raise exception 'Tu as utilisé ta séance d''essai offerte : choisis une formule dans la Boutique pour continuer.';
    else
      raise exception '%', ps.reason;
    end if;
  end if;

  select count(*) into taken from public.bookings where course_id = c.id and day = p_day and status in ('reserve','present','absent');
  st := case when taken < c.capacity then 'reserve' else 'attente' end;
  if existing.id is not null then
    update public.bookings set status = st, subscription_id = ps.sub, is_trial = trial, created_at = now(), updated_at = now() where id = existing.id;
  else
    insert into public.bookings(box_id, course_id, day, member_id, status, subscription_id, is_trial) values (c.box_id, c.id, p_day, me, st, ps.sub, trial);
  end if;
  return st;
end $$;

-- Chaque essai réservé apparaît dans « Séances d'essai » ; s'il est annulé à temps, il disparaît
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
    values (new.box_id, new.day, nm, null, 'att', new.member_id, new.id, null);
  end if;
  return new;
end $$;
create trigger bookings_trial_row after insert or update of status, is_trial, day on public.bookings for each row execute function private.sync_trial_row();

-- Dès qu'une formule est active, l'essai compte comme une inscription (transformation)
create or replace function private.trial_converted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    update public.trials set result = 'oui' where member_id = new.member_id and result = 'att';
  end if;
  return new;
end $$;
create trigger subscriptions_trial_converted after insert or update of status on public.subscriptions for each row execute function private.trial_converted();

revoke execute on function public.my_trial(uuid) from public, anon;
grant execute on function public.my_trial(uuid) to authenticated;
