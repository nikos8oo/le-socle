-- ============ Fiche de la salle (modifiable par l'owner) ============
alter table public.boxes add column logo_url text;
alter table public.boxes add column tagline text;          -- présentation courte
alter table public.boxes add column address text;
alter table public.boxes add column postal_code text;
alter table public.boxes add column phone text;
alter table public.boxes add column email text;
alter table public.boxes add column website text;
alter table public.boxes add column instagram text;
alter table public.boxes add column siret text;
alter table public.boxes add column opening_hours text;   -- horaires d'accueil
alter table public.boxes add column welcome_message text; -- affiché aux nouveaux adhérents
alter table public.boxes add column rules_url text;       -- règlement intérieur / CGV

-- Les notes privées de l'admin ne sont lisibles que par la console (fonction admin_overview)
revoke select (admin_notes) on public.boxes from anon, authenticated;

-- Seul l'admin plateforme change le statut et les notes ; le nom reste non vide
create or replace function private.guard_box_admin_columns() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') and not private.is_platform_admin()
     and (new.status is distinct from old.status or new.admin_notes is distinct from old.admin_notes) then
    raise exception 'Réservé à Drill''s & Skills';
  end if;
  if coalesce(trim(new.name), '') = '' then raise exception 'Le nom de la salle est obligatoire'; end if;
  new.name := trim(new.name);
  return new;
end $$;
create trigger guard_box_admin before update on public.boxes for each row execute function private.guard_box_admin_columns();

-- Logos : stockage public, écriture réservée à l'owner de la salle (dossier = identifiant de la salle)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('box-logos', 'box-logos', true, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg'];

create policy "logos : owner dépose" on storage.objects for insert to authenticated
  with check (bucket_id = 'box-logos' and private.is_owner(((storage.foldername(name))[1])::uuid));
create policy "logos : owner remplace" on storage.objects for update to authenticated
  using (bucket_id = 'box-logos' and private.is_owner(((storage.foldername(name))[1])::uuid));
create policy "logos : owner supprime" on storage.objects for delete to authenticated
  using (bucket_id = 'box-logos' and private.is_owner(((storage.foldername(name))[1])::uuid));

-- Le droit de lecture sur toute la table l'emporte sur le retrait d'une colonne :
-- on accorde donc la lecture colonne par colonne, sans admin_notes
revoke select on public.boxes from anon, authenticated;
grant select (id, name, settings, created_by, created_at, join_code, status, city, stripe_account_id, stripe_charges_enabled, stripe_details_submitted,
  logo_url, tagline, address, postal_code, phone, email, website, instagram, siret, opening_hours, welcome_message, rules_url) on public.boxes to authenticated;
