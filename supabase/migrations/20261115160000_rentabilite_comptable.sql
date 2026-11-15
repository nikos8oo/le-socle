-- Rentabilité présentée comme un compte de résultat (comptes du plan comptable, SIG, amortissements, emprunts, IS).
-- settings.finance = { vat_registered, vat_rate, employer_rate, employee_rate, tax_regime ('is'|'ir'), is_reduced,
--   revenues:[{id,label,account,amount_cents,period,vat,ttc}], charges:[…même forme…], staff:[…],
--   assets:[{id,label,amount_cents,years}], loans:[{id,label,remaining_cents,rate,payment_cents}] }
-- Les anciennes lignes (champ « category ») sont converties à l'affichage.

create or replace function private.demo_finance_json() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'vat_registered', true, 'vat_rate', 20, 'employer_rate', 42, 'employee_rate', 22, 'tax_regime', 'is', 'is_reduced', true,
    'revenues', jsonb_build_array(
      jsonb_build_object('id','r1','label','Coaching privé','account','706','amount_cents',60000,'period','mois','vat',20,'ttc',true),
      jsonb_build_object('id','r2','label','Ventes boissons et compléments','account','707','amount_cents',90000,'period','mois','vat',5.5,'ttc',true),
      jsonb_build_object('id','r3','label','Sponsoring équipementier','account','708','amount_cents',300000,'period','an','vat',20,'ttc',false)),
    'charges', jsonb_build_array(
      jsonb_build_object('id','c1','label','Loyer du local (450 m²)','account','613','amount_cents',320000,'period','mois','vat',20,'ttc',false),
      jsonb_build_object('id','c2','label','Électricité','account','606','amount_cents',42000,'period','mois','vat',20,'ttc',true),
      jsonb_build_object('id','c3','label','Eau','account','606','amount_cents',6000,'period','mois','vat',5.5,'ttc',true),
      jsonb_build_object('id','c4','label','Petit matériel (bandes, cordes, ballons)','account','606','amount_cents',15000,'period','mois','vat',20,'ttc',true),
      jsonb_build_object('id','c5','label','Achats de boissons et compléments','account','607','amount_cents',45000,'period','mois','vat',5.5,'ttc',true),
      jsonb_build_object('id','c6','label','Ménage et entretien','account','615','amount_cents',30000,'period','mois','vat',20,'ttc',true),
      jsonb_build_object('id','c7','label','Assurance RC pro et locaux','account','616','amount_cents',180000,'period','an','vat',0,'ttc',true),
      jsonb_build_object('id','c8','label','Expert-comptable','account','622','amount_cents',25000,'period','mois','vat',20,'ttc',false),
      jsonb_build_object('id','c9','label','Publicité Meta et flyers','account','623','amount_cents',20000,'period','mois','vat',20,'ttc',true),
      jsonb_build_object('id','c10','label','Internet et téléphone','account','626','amount_cents',5500,'period','mois','vat',20,'ttc',true),
      jsonb_build_object('id','c11','label','Frais bancaires et terminal CB','account','627','amount_cents',4500,'period','mois','vat',20,'ttc',true),
      jsonb_build_object('id','c12','label','Affiliation CrossFit','account','651','amount_cents',400000,'period','an','vat',0,'ttc',true),
      jsonb_build_object('id','c13','label','Logiciel de réservation','account','651','amount_cents',12900,'period','mois','vat',20,'ttc',true),
      jsonb_build_object('id','c14','label','CFE','account','635','amount_cents',120000,'period','an','vat',0,'ttc',true)),
    'staff', jsonb_build_array(
      jsonb_build_object('id','s1','name','Hugo','role','Head coach','type','salarie','basis','brut','amount_cents',260000),
      jsonb_build_object('id','s2','name','Léa','role','Coach','type','salarie','basis','net','amount_cents',150000),
      jsonb_build_object('id','s3','name','Mehdi','role','Coach (auto-entrepreneur)','type','independant','basis','facture','amount_cents',90000),
      jsonb_build_object('id','s4','name','Sarah','role','Stagiaire','type','salarie','basis','brut','amount_cents',60000)),
    'assets', jsonb_build_array(
      jsonb_build_object('id','a1','label','Racks, barres et poids','amount_cents',2800000,'years',5),
      jsonb_build_object('id','a2','label','Cardio (rameurs, bikes, SkiErg)','amount_cents',1500000,'years',5),
      jsonb_build_object('id','a3','label','Travaux d''aménagement et sol','amount_cents',2000000,'years',10)),
    'loans', jsonb_build_array(
      jsonb_build_object('id','l1','label','Prêt d''installation','remaining_cents',3200000,'rate',3.9,'payment_cents',78000)))
$$;

create or replace function private.demo_finance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.boxes where id = new.box_id and is_demo) then
    new.settings := coalesce(new.settings, '{}'::jsonb) || jsonb_build_object('finance', private.demo_finance_json());
  end if;
  return new;
end $$;

-- salles de démo existantes
update public.box_private p set settings = coalesce(p.settings, '{}'::jsonb) || jsonb_build_object('finance', private.demo_finance_json())
from public.boxes b where b.id = p.box_id and b.is_demo;
