-- ============ Rentabilité : charges et salariés (dans box_private.settings, lisible par l'owner seul) ============
-- Structure : settings.finance = { vat_registered, vat_rate, employer_rate, employee_rate, charges:[…], staff:[…] }
-- Les salles de démo reçoivent automatiquement un jeu de charges et de salaires réalistes.

create or replace function private.demo_finance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.boxes where id = new.box_id and is_demo) then
    new.settings := coalesce(new.settings, '{}'::jsonb) || jsonb_build_object('finance', jsonb_build_object(
      'vat_registered', true, 'vat_rate', 20, 'employer_rate', 42, 'employee_rate', 22,
      'charges', jsonb_build_array(
        jsonb_build_object('id','c1','label','Loyer du local (450 m²)','category','loyer','amount_cents',320000,'period','mois','vat',20,'ttc',false),
        jsonb_build_object('id','c2','label','Électricité','category','energie','amount_cents',42000,'period','mois','vat',20,'ttc',true),
        jsonb_build_object('id','c3','label','Eau','category','energie','amount_cents',6000,'period','mois','vat',5.5,'ttc',true),
        jsonb_build_object('id','c4','label','Internet et téléphone','category','telecom','amount_cents',5500,'period','mois','vat',20,'ttc',true),
        jsonb_build_object('id','c5','label','Logiciel de réservation','category','logiciel','amount_cents',12900,'period','mois','vat',20,'ttc',true),
        jsonb_build_object('id','c6','label','Affiliation CrossFit','category','logiciel','amount_cents',400000,'period','an','vat',0,'ttc',true),
        jsonb_build_object('id','c7','label','Assurance RC pro et locaux','category','assurance','amount_cents',180000,'period','an','vat',0,'ttc',true),
        jsonb_build_object('id','c8','label','Expert-comptable','category','services','amount_cents',25000,'period','mois','vat',20,'ttc',false),
        jsonb_build_object('id','c9','label','Matériel et renouvellement (barres, ballons…)','category','achats','amount_cents',35000,'period','mois','vat',20,'ttc',true),
        jsonb_build_object('id','c10','label','Ménage et entretien','category','services','amount_cents',30000,'period','mois','vat',20,'ttc',true),
        jsonb_build_object('id','c11','label','Publicité Meta et flyers','category','marketing','amount_cents',20000,'period','mois','vat',20,'ttc',true)
      ),
      'staff', jsonb_build_array(
        jsonb_build_object('id','s1','name','Hugo','role','Head coach','type','salarie','basis','brut','amount_cents',260000),
        jsonb_build_object('id','s2','name','Léa','role','Coach','type','salarie','basis','net','amount_cents',150000),
        jsonb_build_object('id','s3','name','Mehdi','role','Coach (auto-entrepreneur)','type','independant','basis','facture','amount_cents',90000),
        jsonb_build_object('id','s4','name','Sarah','role','Stagiaire','type','salarie','basis','brut','amount_cents',60000)
      )));
  end if;
  return new;
end $$;
create trigger box_private_demo_finance before insert on public.box_private for each row execute function private.demo_finance();
