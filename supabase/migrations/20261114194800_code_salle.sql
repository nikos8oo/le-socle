-- Code de salle lisible (ex. K7P2QX), modifiable par l'owner (ex. BLACKWINGS)
create or replace function private.new_join_code() returns text
language plpgsql volatile set search_path = '' as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    exit when not exists(select 1 from public.boxes where join_code = c);
  end loop;
  return c;
end $$;

alter table public.boxes alter column join_code set default private.new_join_code();
update public.boxes set join_code = private.new_join_code();
alter table public.boxes add constraint boxes_join_code_format check (join_code ~ '^[A-Z0-9]{4,16}$');

-- Voir le nom de la salle avant de la rejoindre
create or replace function public.find_box(code text) returns table(id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select b.id, b.name from public.boxes b where b.join_code = upper(trim(code));
$$;

create or replace function public.join_box(code text, full_name text default null, phone text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b uuid; uid uuid := (select auth.uid()); nm text;
begin
  if uid is null then raise exception 'Connexion requise'; end if;
  select id into b from public.boxes where join_code = upper(trim(code));
  if b is null then raise exception 'Aucune salle ne correspond à ce code'; end if;
  if exists(select 1 from public.box_members where box_id = b and user_id = uid) then return b; end if;
  nm := coalesce(nullif(trim(full_name),''), (select p.full_name from public.profiles p where p.id = uid), split_part((select auth.jwt()->>'email'),'@',1));
  insert into public.members(box_id, name, joined, user_id, email, phone)
    values (b, nm, current_date, uid, (select auth.jwt()->>'email'), nullif(trim(phone),''))
    on conflict (box_id, user_id) where user_id is not null do nothing;
  insert into public.box_members(box_id, user_id, role) values (b, uid, 'adherent');
  return b;
end $$;

-- L'owner choisit son code, ou en tire un nouveau au hasard (code vide)
drop function public.reset_join_code(uuid);
create or replace function public.set_join_code(p_box uuid, p_code text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare c text := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not private.is_owner(p_box) then raise exception 'Réservé à l''owner'; end if;
  if c = '' then c := private.new_join_code(); end if;
  if c !~ '^[A-Z0-9]{4,16}$' then raise exception 'Le code doit faire de 4 à 16 lettres ou chiffres'; end if;
  if exists(select 1 from public.boxes where join_code = c and id <> p_box) then raise exception 'Ce code est déjà pris par une autre salle'; end if;
  update public.boxes set join_code = c where id = p_box;
  return c;
end $$;

revoke execute on function public.find_box(text), public.set_join_code(uuid, text) from public, anon;
grant execute on function public.find_box(text), public.set_join_code(uuid, text) to authenticated;
