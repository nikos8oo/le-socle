-- Les accès « salle » (owner, coach) sont délivrés par l'administrateur de la plateforme (Drill's & Skills).
-- Les athlètes s'inscrivent eux-mêmes avec le code de leur salle.

-- Seul l'admin plateforme crée une salle ; il n'en devient pas membre (il voit déjà tout)
create or replace function public.create_box(box_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b uuid;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise'; end if;
  if not private.is_platform_admin() then raise exception 'La création d''une salle est réservée à Drill''s & Skills'; end if;
  insert into public.boxes(name, created_by) values (trim(box_name), (select auth.uid())) returning id into b;
  insert into public.box_private(box_id) values (b);
  return b;
end $$;

-- Invitations owner / coach : créées par l'admin plateforme ; l'owner voit celles de sa salle
drop policy "invitations : owner" on public.invitations;
create policy "invitations : owner lit" on public.invitations for select to authenticated using (private.is_owner(box_id));
create policy "invitations : admin crée" on public.invitations for insert to authenticated with check (private.is_platform_admin());
create policy "invitations : admin modifie" on public.invitations for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "invitations : admin supprime" on public.invitations for delete to authenticated using (private.is_platform_admin());

-- Les membres « salle » ne peuvent plus être ajoutés à la main par l'owner (seulement via invitation)
drop policy "membres : owner ajoute" on public.box_members;
create policy "membres : admin ajoute" on public.box_members for insert to authenticated with check (private.is_platform_admin());
