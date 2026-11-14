-- ============ Mode démo : une salle complète générée en un clic, supprimable en un clic ============
alter table public.boxes add column is_demo boolean not null default false;
grant select (is_demo) on public.boxes to authenticated;

create or replace function public.admin_create_demo() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b uuid := gen_random_uuid();
  firsts text[] := array['Julien','Léa','Thomas','Camille','Nicolas','Manon','Maxime','Sarah','Antoine','Chloé','Lucas','Emma','Hugo','Inès','Romain','Laura','Mathis','Pauline','Alexandre','Marion',
                         'Kevin','Julie','Quentin','Océane','Florian','Anaïs','Jérémy','Clara','Benjamin','Elodie','Adrien','Morgane','Valentin','Justine','Dylan','Mélanie','Théo','Charlotte','Yanis','Margaux'];
  lasts text[] := array['Martin','Bernard','Dubois','Garcia','Roux','Fournier','Girard','Lopez','Mercier','Blanc','Guerin','Muller','Faure','Andre','Lambert','Fontaine','Chevalier','Robin','Masson','Sanchez'];
  c_hugo uuid := gen_random_uuid(); c_lea uuid := gen_random_uuid(); c_mehdi uuid := gen_random_uuid(); c_sarah uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid(); pill uuid := gen_random_uuid(); pan uuid := gen_random_uuid();
  pc5 uuid := gen_random_uuid(); pc10 uuid := gen_random_uuid(); pc20 uuid := gen_random_uuid(); pet uuid := gen_random_uuid();
  m record; i int; plan record; d date; crs record; n int; rate numeric; ev uuid; k int;
begin
  if not private.is_platform_admin() then raise exception 'Réservé à l''administrateur Drill''s & Skills'; end if;

  insert into public.boxes(id, name, is_demo, status, city, tagline, address, postal_code, phone, email, instagram, opening_hours, welcome_message, settings, created_by)
  values (b, 'Démo · CrossFit Les Remparts', true, 'pilote', 'Perpignan', 'CrossFit, haltéro et Hyrox au cœur de Perpignan', '12 rue des Remparts', '66000',
          '04 68 00 00 00', 'contact@demo-remparts.fr', 'crossfitremparts', E'Lun–ven : 6h30–21h30\nSam : 9h–13h\nDim : 9h30–12h',
          'Bienvenue dans la team ! Arrive 10 minutes avant ton premier cours, on te fait visiter et on adapte la séance à ton niveau.',
          jsonb_build_object('suivi_debut', current_date - 60, 'booking', jsonb_build_object('enabled', true, 'open_days', 7, 'cancel_hours', 2, 'require_plan', true, 'trial_sessions', 1, 'trial_course_types', jsonb_build_array('CrossFit','Hyrox'))),
          (select auth.uid()));
  insert into public.box_private(box_id) values (b);

  insert into public.course_types(box_id, name, color_index) values (b,'CrossFit',0),(b,'Hyrox',5),(b,'Haltéro',2),(b,'Gym',6),(b,'Open Gym',7);
  insert into public.coaches(id, box_id, name, role_label, path) values
    (c_hugo, b, 'Hugo', 'Head coach', 'prime'), (c_lea, b, 'Léa', 'Coach', 'prime'), (c_mehdi, b, 'Mehdi', 'Coach', 'formation'), (c_sarah, b, 'Sarah', 'Stagiaire', 'formation');

  -- Planning (avec deux créneaux en parallèle à 18h)
  insert into public.courses(box_id, weekday, start_time, type_name, capacity, coach_id, label)
  select b, wd, t::time, ty, cap, co, lb from (values
    (0,'07:00','CrossFit',14,c_lea,null),(1,'07:00','CrossFit',14,c_hugo,null),(2,'07:00','CrossFit',14,c_lea,null),(3,'07:00','CrossFit',14,c_hugo,null),(4,'07:00','CrossFit',14,c_lea,null),
    (0,'12:15','CrossFit',14,c_mehdi,null),(1,'12:15','CrossFit',14,c_mehdi,null),(2,'12:15','CrossFit',14,c_mehdi,null),(3,'12:15','CrossFit',14,c_mehdi,null),(4,'12:15','CrossFit',14,c_mehdi,null),
    (0,'18:00','CrossFit',16,c_hugo,'Salle 1'),(1,'18:00','CrossFit',16,c_lea,'Salle 1'),(2,'18:00','CrossFit',16,c_hugo,'Salle 1'),(3,'18:00','CrossFit',16,c_lea,'Salle 1'),(4,'18:00','CrossFit',16,c_hugo,'Salle 1'),
    (0,'18:00','Haltéro',8,c_mehdi,'Salle 2'),(2,'18:00','Haltéro',8,c_mehdi,'Salle 2'),(1,'18:00','Gym',8,c_sarah,'Salle 2'),
    (0,'19:15','CrossFit',16,c_lea,null),(1,'19:15','CrossFit',16,c_hugo,null),(2,'19:15','CrossFit',16,c_lea,null),(3,'19:15','CrossFit',16,c_hugo,null),(4,'19:15','CrossFit',16,c_lea,null),
    (1,'20:30','Hyrox',12,c_mehdi,null),(3,'20:30','Hyrox',12,c_mehdi,null),
    (5,'09:30','CrossFit',16,c_hugo,null),(5,'11:00','Gym',10,c_sarah,null),(6,'10:00','Open Gym',12,c_sarah,null)
  ) v(wd, t, ty, cap, co, lb);

  -- Formules
  insert into public.plans(id, box_id, name, kind, per_week, sessions, validity_days, price_cents, period, commitment_months, sort, description) values
    (p2, b, '2 séances / semaine', 'hebdo', 2, null, null, 5900, 'mois', 0, 1, 'Pour reprendre en douceur'),
    (p3, b, '3 séances / semaine', 'hebdo', 3, null, null, 6900, 'mois', 0, 2, 'La formule la plus choisie'),
    (p4, b, '4 séances / semaine', 'hebdo', 4, null, null, 7900, 'mois', 0, 3, null),
    (pill, b, 'Illimité', 'illimite', null, null, null, 8900, 'mois', 0, 4, 'Tous les cours, sans limite'),
    (pan, b, 'Illimité annuel', 'illimite', null, null, null, 89000, 'annee', 12, 5, 'Deux mois offerts'),
    (pet, b, 'Étudiant · 3 séances', 'hebdo', 3, null, null, 5500, 'mois', 0, 6, 'Sur présentation de la carte étudiante'),
    (pc5, b, 'Carnet 5 séances', 'carnet', null, 5, 90, 6000, 'unique', 0, 7, null),
    (pc10, b, 'Carnet 10 séances', 'carnet', null, 10, 180, 11000, 'unique', 0, 8, null),
    (pc20, b, 'Carnet 20 séances', 'carnet', null, 20, 365, 20000, 'unique', 0, 9, null);

  -- 80 adhérents : anciens, nouveaux (moins de 60 j), quelques-uns à relancer, 3 suspendus
  for i in 1..80 loop
    insert into public.members(box_id, name, joined, active, email)
    values (b, firsts[1 + (i * 7) % array_length(firsts, 1)] || ' ' || lasts[1 + (i * 3) % array_length(lasts, 1)],
            case when i <= 10 then current_date - (5 + i * 5) else current_date - (70 + (i * 37) % 650) end,
            i not in (77, 78, 79),
            'demo' || i || '@exemple.fr');
  end loop;

  -- Formules des adhérents (répartition réaliste)
  i := 0;
  for m in select id, joined from public.members where box_id = b order by joined loop
    i := i + 1;
    select * into plan from public.plans where id = case
      when i % 10 in (0, 1) then pill when i % 10 in (2, 3, 4) then p3 when i % 10 = 5 then p2 when i % 10 = 6 then p4
      when i % 10 = 7 then (case when i % 20 = 7 then pan else pet end) when i % 10 = 8 then (case when i % 3 = 0 then pc5 when i % 3 = 1 then pc10 else pc20 end)
      else (case when i % 4 = 0 then p2 else p3 end) end;
    insert into public.subscriptions(box_id, member_id, plan_id, name, kind, per_week, sessions, course_types, price_cents, period, start_date, end_date, commitment_until, status, source, payment_method, paid_at, payment_issue)
    values (b, m.id, plan.id, plan.name, plan.kind, plan.per_week, plan.sessions, plan.course_types, plan.price_cents, plan.period,
            greatest(m.joined, current_date - 300), case when plan.kind = 'carnet' then greatest(m.joined, current_date - 300) + plan.validity_days end,
            case when plan.commitment_months > 0 then (greatest(m.joined, current_date - 300) + make_interval(months => plan.commitment_months))::date end,
            case when i in (77, 78, 79) then 'suspendue' when i in (3, 41) then 'attente_paiement' else 'active' end,
            case when i in (3, 41) then 'achat' else 'owner' end,
            case when i in (3, 41) then null when i % 3 = 0 then 'en_ligne' when i % 3 = 1 then 'cb' else 'sur_place' end,
            case when i in (3, 41) then null else now() - make_interval(days => (i * 11) % 30) end,
            case when i = 12 then 'Paiement refusé le ' || to_char(current_date - 2, 'DD/MM/YYYY') end);
  end loop;

  -- Historique : 60 jours de cours passés + 7 jours de réservations à venir
  for d in select generate_series(current_date - 60, current_date + 6, interval '1 day')::date loop
    for crs in select * from public.courses where box_id = b and weekday = extract(isodow from d)::int - 1 loop
      rate := case
        when crs.start_time = '07:00' then 0.45 when crs.start_time = '12:15' then 0.55
        when crs.start_time = '18:00' and crs.type_name = 'CrossFit' then 0.97 when crs.start_time = '18:00' then 0.7
        when crs.start_time = '19:15' then 0.82 when crs.type_name = 'Hyrox' then 0.62
        when crs.start_time = '09:30' then 0.9 when crs.type_name = 'Gym' then 0.6 else 0.38 end;
      if d > current_date then rate := rate * (1 - (d - current_date) * 0.11); end if;
      n := greatest(1, least(crs.capacity, round(crs.capacity * rate + (random() * 4 - 2))::int));
      insert into public.bookings(box_id, course_id, day, member_id, status, subscription_id, created_at, updated_at)
      select b, crs.id, d, mm.id,
        case when d > current_date then 'reserve' when d = current_date and crs.start_time > (now() at time zone 'Europe/Paris')::time then 'reserve'
             else (case when random() < 0.9 then 'present' when random() < 0.5 then 'absent' else 'annule_tard' end) end,
        (select s.id from public.subscriptions s where s.member_id = mm.id order by s.created_at limit 1),
        (d - 1)::timestamptz, now()
      from (select id from public.members where box_id = b and active
              and joined <= d and id not in (select id from public.members where box_id = b order by joined desc limit 8 offset 10)
            order by random() limit n) mm;
    end loop;
  end loop;

  -- Fréquentation et dernière venue calculées depuis l'appel
  insert into public.attendance(course_id, box_id, day, present)
  select course_id, b, day, count(*) filter (where status = 'present') from public.bookings where box_id = b and day <= current_date group by course_id, day;
  update public.members mm set last_visit = x.lv from (select member_id, max(day) lv from public.bookings where box_id = b and status = 'present' group by member_id) x where x.member_id = mm.id;
  -- 8 adhérents « à relancer » : plus venus depuis 3 à 5 semaines
  update public.members set last_visit = current_date - (20 + (random() * 15)::int)
  where id in (select id from public.members where box_id = b order by joined desc limit 8 offset 10);

  -- Séances d'essai des 90 derniers jours (transformation par coach)
  for k in 1..22 loop
    insert into public.trials(box_id, day, prospect, coach_id, result)
    values (b, current_date - (k * 4), firsts[1 + (k * 5) % 40] || ' (essai)',
            case k % 4 when 0 then c_hugo when 1 then c_lea when 2 then c_mehdi else c_sarah end,
            case when k <= 2 then 'att' when k % 4 = 3 and k % 3 = 0 then 'non' when k % 4 = 2 and k % 2 = 0 then 'non' when k % 7 = 0 then 'non' else 'oui' end);
  end loop;

  -- Observations des coachs
  insert into public.observations(box_id, coach_id, observer, day, scores, note) values
    (b, c_hugo, 'Owner', current_date - 20, '{"ens":3,"obs":3,"cor":2,"grp":3,"pre":3,"mev":2,"cha":3}', 'Varier davantage les paliers sur le WOD'),
    (b, c_lea, 'Owner', current_date - 35, '{"ens":2,"obs":3,"cor":3,"grp":2,"pre":3,"mev":2,"cha":3}', 'Gestion du temps sur l''échauffement'),
    (b, c_mehdi, 'Hugo', current_date - 12, '{"ens":2,"obs":2,"cor":2,"grp":2,"pre":3,"mev":2,"cha":2}', 'Plus de démonstrations, triage des corrections'),
    (b, c_sarah, 'Hugo', current_date - 5, '{"ens":1,"obs":2,"cor":1,"grp":2,"pre":3,"mev":1,"cha":2}', 'Préparer la fiche de cours la veille');
  update public.coaches set last_review = (select max(day) from public.observations o where o.coach_id = coaches.id) where box_id = b;

  -- Événements : une compétition à venir, une porte ouverte passée avec bilan
  ev := gen_random_uuid();
  insert into public.events(id, box_id, type, name, day, responsible, goal_participants, goal_trials) values (ev, b, 'compet', 'Battle des Remparts', current_date + 28, c_hugo::text, 40, 10);
  insert into public.event_finance(event_id, box_id, budget, goal_revenue) values (ev, b, 600, 1800);
  insert into public.event_tasks(event_id, box_id, title, due, assignee, done) values
    (ev, b, 'Fixer la date, le format et les catégories', current_date - 17, 'owner', true),
    (ev, b, 'Trouver des partenaires locaux et des lots', current_date - 12, 'owner', true),
    (ev, b, 'Annoncer et ouvrir les inscriptions', current_date - 7, c_lea::text, true),
    (ev, b, 'Commander le merch de l''événement', current_date - 2, 'owner', false),
    (ev, b, 'Écrire les WODs et les standards', current_date + 7, c_hugo::text, false),
    (ev, b, 'Recruter les juges et les bénévoles', current_date + 14, c_mehdi::text, false),
    (ev, b, 'Briefer les juges', current_date + 25, c_hugo::text, false),
    (ev, b, 'Accueillir les invités et noter les contacts', current_date + 28, 'equipe', false);
  ev := gen_random_uuid();
  insert into public.events(id, box_id, type, name, day, responsible, goal_participants, goal_trials) values (ev, b, 'porte', 'Porte ouverte de rentrée', current_date - 40, 'owner', 25, 8);
  insert into public.event_finance(event_id, box_id, budget, goal_revenue, review) values (ev, b, 150, 0, '{"participants":31,"essais":11,"inscrits":7,"ca":0,"note":"Garder le WOD découverte en binôme, relancer plus vite les contacts"}');
  insert into public.event_tasks(event_id, box_id, title, due, assignee, done)
  select ev, b, t, current_date - 40 + o, a, true from (values ('Créer le visuel et l''annonce', -18, c_lea::text), ('Accueil en 3 phases et noter chaque contact', 0, 'equipe'), ('Bilan : essais générés et inscriptions', 7, 'owner')) v(t, o, a);

  insert into public.reminders(box_id, title, due) values (b, 'Appeler les 2 adhérents en attente de paiement', current_date), (b, 'Préparer le point mensuel avec l''équipe', current_date + 3);
  insert into public.journal(box_id, text, actor) values (b, 'Salle de démo créée', (select auth.uid()));
  return b;
end $$;

create or replace function public.admin_delete_demo(p_box uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Réservé à l''administrateur Drill''s & Skills'; end if;
  if not exists(select 1 from public.boxes where id = p_box and is_demo) then raise exception 'Seule une salle de démo peut être supprimée ainsi'; end if;
  delete from public.boxes where id = p_box;
end $$;

revoke execute on function public.admin_create_demo(), public.admin_delete_demo(uuid) from public, anon;
grant execute on function public.admin_create_demo(), public.admin_delete_demo(uuid) to authenticated;

-- Console admin : les salles de démo sont signalées
drop function public.admin_overview();
create or replace function public.admin_overview()
returns table(id uuid, name text, city text, status text, join_code text, created_at timestamptz, admin_notes text,
              owners text, coaches int, adherents int, active_subs int, mrr_cents int, bookings_30 int, presents_30 int,
              pending_invites int, last_activity timestamptz, stripe_account_id text, stripe_charges_enabled boolean, is_demo boolean)
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
    b.stripe_account_id, b.stripe_charges_enabled, b.is_demo
  from public.boxes b
  order by case b.status when 'active' then 0 when 'pilote' then 1 when 'suspendue' then 2 else 3 end, b.name;
end $$;

revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;
