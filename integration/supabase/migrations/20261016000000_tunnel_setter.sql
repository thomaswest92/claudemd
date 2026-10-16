-- =====================================================================
-- L'Académie des Sorciers : tunnel de candidature et outil setter / closer
-- Migration Supabase (PostgreSQL 15+). Tout est rangé dans le schéma "tunnel"
-- pour ne rien mélanger avec les tables existantes de la plateforme.
--
-- Contenu :
--   tunnel.equipe       qui est admin, setter ou closer (lié à auth.users)
--   tunnel.reglages     seuils de l'indication argent, délai de relance (un seul endroit)
--   tunnel.leads        une ligne par candidat : formulaire + suivi setter + résultat du call
--   tunnel.montants     montant du closing, séparé pour que le setter ne le voie jamais
--   tunnel.historique   chaque changement : qui, quand, champ, avant, après
--   tunnel.messages     bibliothèque de messages à copier (modifiable par l'admin)
--   tunnel.evenements   mesure d'audience sans cookie : visites, vidéo, clics
--   tunnel.limites_ip   anti-spam : nombre d'envois par adresse IP (hachée)
-- =====================================================================

create schema if not exists tunnel;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type tunnel.role_equipe as enum ('admin', 'setter', 'closer');
create type tunnel.statut_lead as enum (
  'partielle',        -- WhatsApp et Instagram remplis, questionnaire pas envoyé
  'nouveau',          -- questionnaire envoyé, pas encore contacté
  'prise_de_contact', 'education', 'proposition', 'rendez_vous', 'pas_interesse'
);
create type tunnel.couleur_argent as enum ('vert', 'jaune', 'rouge', 'gris');
create type tunnel.qualite as enum ('inconnu', 'chaud', 'tiede', 'a_travailler', 'pas_de_retour');
create type tunnel.conversation as enum ('pas_encore', 'instagram', 'whatsapp', 'les_deux');
create type tunnel.resultat_call as enum ('a_venir', 'close', 'r2_a_prevoir', 'pas_close', 'absent');
create type tunnel.etat_analyse as enum ('non_demandee', 'en_attente', 'faite', 'regle_seule');

-- ---------------------------------------------------------------------
-- Équipe et rôles
-- ---------------------------------------------------------------------
create table tunnel.equipe (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  role      tunnel.role_equipe not null,
  nom       text not null,
  email     text,
  actif     boolean not null default true,
  cree_le   timestamptz not null default now()
);

-- Rôle de la personne connectée (null si elle ne fait pas partie de l'équipe).
create or replace function tunnel.mon_role() returns tunnel.role_equipe
language sql stable security definer set search_path = tunnel, public as $$
  select role from tunnel.equipe where user_id = auth.uid() and actif
$$;

-- ---------------------------------------------------------------------
-- Réglages : modifiables par l'admin, lus par le code (un seul endroit)
-- ---------------------------------------------------------------------
create table tunnel.reglages (
  cle      text primary key,
  valeur   jsonb not null,
  note     text
);
insert into tunnel.reglages (cle, valeur, note) values
  ('argent_par_tranche', '{
      "Moins de 2 000 €": "rouge",
      "2 000 à 3 500 €": "jaune",
      "3 500 à 5 000 €": "jaune",
      "5 000 à 10 000 €": "vert",
      "10 000 à 30 000 €": "vert",
      "Plus de 30 000 €": "vert"
    }', 'Indication argent de base selon la question 3. La lecture de la question 4 par Claude peut l''ajuster.'),
  ('relance_sans_reponse_heures', '48', 'Un lead contacté sans réponse remonte dans "À relancer" après ce délai.'),
  ('urgence_heures', '{"orange": 24, "rouge": 48}', 'Compteur sur les leads non contactés.'),
  ('emails_nouveau_lead', '[]', 'Adresses qui reçoivent un e-mail à chaque candidature complète.'),
  ('emails_recap_quotidien', '[]', 'Adresses qui reçoivent le récapitulatif du matin.');

create or replace function tunnel.reglage(p_cle text) returns jsonb
language sql stable security definer set search_path = tunnel, public as $$
  select valeur from tunnel.reglages where cle = p_cle
$$;

create or replace function tunnel.argent_par_tranche(p_tranche text) returns tunnel.couleur_argent
language sql stable security definer set search_path = tunnel, public as $$
  select coalesce((tunnel.reglage('argent_par_tranche') ->> p_tranche)::tunnel.couleur_argent, 'gris')
$$;

-- ---------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------
create table tunnel.leads (
  id                    uuid primary key default gen_random_uuid(),
  cle_formulaire        text not null unique,          -- identifiant créé par la page, évite les doublons pendant la saisie
  statut                tunnel.statut_lead not null default 'partielle',

  -- Formulaire
  whatsapp              text not null,                 -- format international, ex. +33612345678
  whatsapp_valide       boolean not null default false,
  instagram             text,                          -- sans @, null si "pas de compte Instagram"
  sans_instagram        boolean not null default false,
  q1_presentation       text,
  q2_activite           text,
  q3_revenus            text,
  q4_situation_financiere text,
  q5_reseaux            text,
  commentaire_lead      text,                          -- ajouté par le candidat après l'envoi
  source                text,                          -- résumé lisible de l'origine
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  utm_content           text,
  referrer              text,
  cree_le               timestamptz not null default now(),  -- première saisie (candidature partielle)
  depose_le             timestamptz,                         -- envoi complet (passage en "nouveau")

  -- Indication argent et résumé (proposés, jamais définitifs)
  argent_auto           tunnel.couleur_argent not null default 'gris',
  argent_manuel         tunnel.couleur_argent,               -- correction du setter, conservée
  argent                tunnel.couleur_argent generated always as (coalesce(argent_manuel, argent_auto)) stored,
  argent_explication    text,
  argent_incoherence    boolean not null default false,
  resume_auto           text,
  analyse_etat          tunnel.etat_analyse not null default 'non_demandee',
  analyse_le            timestamptz,

  -- Suivi du setter
  setter_id             uuid references tunnel.equipe (user_id),
  prenom                text,
  nom                   text,
  conversation          tunnel.conversation not null default 'pas_encore',
  qualite               tunnel.qualite not null default 'inconnu',
  problemes             text[] not null default '{}',        -- argent, meconnaissance_reseaux, projet_inconnu, autre
  premier_contact_le    timestamptz,
  dernier_message_le    timestamptz,
  dernier_message_resume text,
  dernier_message_du_lead boolean,                           -- true si le dernier message vient du lead (il a répondu)
  followup_le           timestamptz,
  prochaine_action      text,
  prochaine_action_le   timestamptz,
  call_le               timestamptz,
  closer_id             uuid references tunnel.equipe (user_id),
  commentaire           text,

  -- Résultat du call (visible par le setter, sauf le montant qui est dans tunnel.montants)
  resultat_call         tunnel.resultat_call,
  r2_le                 timestamptz,

  doublon_de            uuid references tunnel.leads (id) on delete set null,
  mis_a_jour_le         timestamptz not null default now(),

  constraint problemes_valides check (problemes <@ array['argent', 'meconnaissance_reseaux', 'projet_inconnu', 'autre'])
);

create index on tunnel.leads (statut);
create index on tunnel.leads (depose_le desc);
create index on tunnel.leads (whatsapp);
create index on tunnel.leads (lower(instagram));
create index on tunnel.leads (closer_id, call_le);
create index on tunnel.leads (mis_a_jour_le);  -- synchronisation incrémentale

-- "Actif" = en cours avec le setter : la prochaine action est obligatoire (contrôlée par l'outil, voir la vue).
create or replace function tunnel.est_actif(s tunnel.statut_lead) returns boolean language sql immutable as $$
  select s in ('prise_de_contact', 'education', 'proposition', 'rendez_vous')
$$;

-- Montant du closing : table à part, le setter n'y a pas accès.
create table tunnel.montants (
  lead_id     uuid primary key references tunnel.leads (id) on delete cascade,
  montant     numeric(12, 2) not null check (montant >= 0),
  closer_id   uuid references tunnel.equipe (user_id),
  saisi_le    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Historique : chaque changement, qui, quand, avant, après
-- ---------------------------------------------------------------------
create table tunnel.historique (
  id         bigint generated always as identity primary key,
  lead_id    uuid not null references tunnel.leads (id) on delete cascade,
  le         timestamptz not null default now(),
  qui        uuid,                     -- null = la page ou l'automate
  qui_nom    text not null,
  champ      text not null,
  avant      text,
  apres      text,
  sensible   boolean not null default false  -- true pour le montant : invisible pour le setter
);
create index on tunnel.historique (lead_id, le);

create or replace function tunnel.nom_auteur() returns text
language sql stable security definer set search_path = tunnel, public as $$
  select coalesce((select nom from tunnel.equipe where user_id = auth.uid()), 'Page ou automate')
$$;

create or replace function tunnel.tracer_lead() returns trigger
language plpgsql security definer set search_path = tunnel, public as $$
declare
  champ text;
  v_avant text;
  v_apres text;
  ignores text[] := array['mis_a_jour_le', 'argent', 'analyse_le'];
begin
  new.mis_a_jour_le := now();
  if tg_op = 'INSERT' then
    return new;
  end if;
  for champ in select key from jsonb_each(to_jsonb(new)) loop
    continue when champ = any (ignores);
    v_avant := to_jsonb(old) ->> champ;
    v_apres := to_jsonb(new) ->> champ;
    if v_avant is distinct from v_apres then
      insert into tunnel.historique (lead_id, qui, qui_nom, champ, avant, apres)
      values (new.id, auth.uid(), tunnel.nom_auteur(), champ, v_avant, v_apres);
    end if;
  end loop;
  -- Premier passage hors "nouveau" = premier contact (sert au délai moyen avant 1er contact).
  if old.statut = 'nouveau' and new.statut not in ('nouveau', 'partielle') and new.premier_contact_le is null then
    new.premier_contact_le := now();
  end if;
  -- Le setter qui fait avancer un lead sans setter attitré en devient le setter.
  if new.setter_id is null and tunnel.mon_role() = 'setter' then
    new.setter_id := auth.uid();
  end if;
  if new.statut <> 'partielle' and old.statut = 'partielle' and new.depose_le is null then
    new.depose_le := now();
  end if;
  return new;
end $$;

create trigger tracer_lead before insert or update on tunnel.leads
  for each row execute function tunnel.tracer_lead();

create or replace function tunnel.tracer_montant() returns trigger
language plpgsql security definer set search_path = tunnel, public as $$
begin
  insert into tunnel.historique (lead_id, qui, qui_nom, champ, avant, apres, sensible)
  values (coalesce(new.lead_id, old.lead_id), auth.uid(), tunnel.nom_auteur(), 'montant',
          case when tg_op = 'INSERT' then null else old.montant::text end,
          case when tg_op = 'DELETE' then null else new.montant::text end, true);
  return coalesce(new, old);
end $$;

create trigger tracer_montant after insert or update or delete on tunnel.montants
  for each row execute function tunnel.tracer_montant();

-- Doublons : même numéro WhatsApp ou même Instagram qu'un lead existant.
create or replace function tunnel.reperer_doublon() returns trigger
language plpgsql security definer set search_path = tunnel, public as $$
begin
  if new.doublon_de is null then
    select id into new.doublon_de from tunnel.leads
     where id <> new.id
       and (whatsapp = new.whatsapp or (new.instagram is not null and lower(instagram) = lower(new.instagram)))
     order by cree_le asc limit 1;
  end if;
  return new;
end $$;

create trigger reperer_doublon before insert or update of whatsapp, instagram on tunnel.leads
  for each row execute function tunnel.reperer_doublon();

-- ---------------------------------------------------------------------
-- Messages à copier et événements de la page
-- ---------------------------------------------------------------------
create table tunnel.messages (
  id        bigint generated always as identity primary key,
  titre     text not null,
  texte     text not null,
  ordre     int not null default 0,
  actif     boolean not null default true,
  modifie_le timestamptz not null default now()
);
insert into tunnel.messages (titre, texte, ordre) values
  ('Premier message', 'Salut, comment tu vas ? J''ai vu ton projet, il est super cool.', 1);

create table tunnel.evenements (
  id         bigint generated always as identity primary key,
  le         timestamptz not null default now(),
  type       text not null check (type in ('visite', 'clic_cta', 'video_25', 'video_50', 'video_75', 'video_100')),
  utm_source text,
  utm_campaign text,
  referrer   text
);
create index on tunnel.evenements (type, le);

create table tunnel.limites_ip (
  ip_hache   text not null,
  fenetre    timestamptz not null,
  compteur   int not null default 1,
  primary key (ip_hache, fenetre)
);

-- ---------------------------------------------------------------------
-- Droits (Row Level Security)
--   admin  : tout
--   setter : tous les leads, jamais les montants
--   closer : seulement les leads dont il est le closer, et ses montants
--   la page publique n'écrit que par la fonction "candidature" (clé service)
-- ---------------------------------------------------------------------
alter table tunnel.equipe     enable row level security;
alter table tunnel.reglages   enable row level security;
alter table tunnel.leads      enable row level security;
alter table tunnel.montants   enable row level security;
alter table tunnel.historique enable row level security;
alter table tunnel.messages   enable row level security;
alter table tunnel.evenements enable row level security;
alter table tunnel.limites_ip enable row level security;

create policy equipe_lecture on tunnel.equipe for select to authenticated using (tunnel.mon_role() is not null);
create policy equipe_admin on tunnel.equipe for all to authenticated using (tunnel.mon_role() = 'admin') with check (tunnel.mon_role() = 'admin');

create policy reglages_lecture on tunnel.reglages for select to authenticated using (tunnel.mon_role() is not null);
create policy reglages_admin on tunnel.reglages for all to authenticated using (tunnel.mon_role() = 'admin') with check (tunnel.mon_role() = 'admin');

create policy leads_lecture on tunnel.leads for select to authenticated using (
  tunnel.mon_role() in ('admin', 'setter') or (tunnel.mon_role() = 'closer' and closer_id = auth.uid())
);
create policy leads_modif on tunnel.leads for update to authenticated using (
  tunnel.mon_role() in ('admin', 'setter') or (tunnel.mon_role() = 'closer' and closer_id = auth.uid())
) with check (
  tunnel.mon_role() in ('admin', 'setter') or (tunnel.mon_role() = 'closer' and closer_id = auth.uid())
);
create policy leads_suppression on tunnel.leads for delete to authenticated using (tunnel.mon_role() = 'admin');

create policy montants_lecture on tunnel.montants for select to authenticated using (
  tunnel.mon_role() = 'admin' or (tunnel.mon_role() = 'closer' and closer_id = auth.uid())
);
create policy montants_ecriture on tunnel.montants for all to authenticated using (
  tunnel.mon_role() = 'admin' or (tunnel.mon_role() = 'closer' and closer_id = auth.uid())
) with check (
  tunnel.mon_role() = 'admin' or (tunnel.mon_role() = 'closer' and closer_id = auth.uid())
);

create policy historique_lecture on tunnel.historique for select to authenticated using (
  case tunnel.mon_role()
    when 'admin' then true
    when 'setter' then not sensible
    when 'closer' then exists (select 1 from tunnel.leads l where l.id = lead_id and l.closer_id = auth.uid())
    else false
  end
);

create policy messages_lecture on tunnel.messages for select to authenticated using (tunnel.mon_role() is not null);
create policy messages_admin on tunnel.messages for all to authenticated using (tunnel.mon_role() = 'admin') with check (tunnel.mon_role() = 'admin');

create policy evenements_admin on tunnel.evenements for select to authenticated using (tunnel.mon_role() = 'admin');
-- limites_ip : aucune politique, seule la clé service y touche.

grant usage on schema tunnel to authenticated, service_role;
grant select, update, delete on tunnel.leads to authenticated;
grant select, insert, update, delete on tunnel.montants, tunnel.messages, tunnel.equipe, tunnel.reglages to authenticated;
grant select on tunnel.historique, tunnel.evenements to authenticated;
grant all on all tables in schema tunnel to service_role;
grant usage, select on all sequences in schema tunnel to authenticated, service_role;
grant execute on all functions in schema tunnel to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Vues de travail (les droits des tables s'appliquent : security_invoker)
-- ---------------------------------------------------------------------

-- Vue "Aujourd'hui" du setter : une ligne par lead à traiter, avec sa rubrique et son urgence.
create view tunnel.a_traiter with (security_invoker = true) as
select l.*,
  case
    when l.statut = 'nouveau' then 'nouveau'
    when l.call_le::date = current_date then 'call_du_jour'
    when tunnel.est_actif(l.statut) and (
           (l.prochaine_action_le is not null and l.prochaine_action_le < now() + interval '1 day')
        or (l.followup_le is not null and l.followup_le < now() + interval '1 day')
        or (l.dernier_message_le is not null and coalesce(l.dernier_message_du_lead, false) = false
            and l.dernier_message_le < now() - make_interval(hours => (tunnel.reglage('relance_sans_reponse_heures'))::text::int))
       ) then 'a_relancer'
  end as rubrique,
  case
    when l.statut <> 'nouveau' then null
    when now() - l.depose_le < make_interval(hours => (tunnel.reglage('urgence_heures') ->> 'orange')::int) then 'vert'
    when now() - l.depose_le < make_interval(hours => (tunnel.reglage('urgence_heures') ->> 'rouge')::int) then 'orange'
    else 'rouge'
  end as urgence,
  (tunnel.est_actif(l.statut) and (l.prochaine_action is null or l.prochaine_action_le is null)) as manque_prochaine_action,
  case l.argent when 'vert' then 0 when 'jaune' then 1 when 'gris' then 2 else 3 end as ordre_argent
from tunnel.leads l
where l.statut <> 'partielle';

grant select on tunnel.a_traiter to authenticated, service_role;

-- Statistiques de l'admin sur une période (par défaut : la semaine en cours), optionnellement par source.
create or replace function tunnel.statistiques(p_debut timestamptz default date_trunc('week', now()),
                                               p_fin timestamptz default now(),
                                               p_utm_source text default null)
returns jsonb language plpgsql stable security invoker set search_path = tunnel, public as $$
declare r jsonb;
begin
  if tunnel.mon_role() is distinct from 'admin' and current_user <> 'service_role' then
    raise exception 'Réservé à l''admin';
  end if;
  with l as (
    select * from tunnel.leads
    where cree_le >= p_debut and cree_le < p_fin and (p_utm_source is null or utm_source = p_utm_source)
  ), e as (
    select * from tunnel.evenements
    where le >= p_debut and le < p_fin and (p_utm_source is null or utm_source = p_utm_source)
  )
  select jsonb_build_object(
    'entonnoir', jsonb_build_object(
      'visites',        (select count(*) from e where type = 'visite'),
      'video_25',       (select count(*) from e where type = 'video_25'),
      'video_50',       (select count(*) from e where type = 'video_50'),
      'video_75',       (select count(*) from e where type = 'video_75'),
      'video_100',      (select count(*) from e where type = 'video_100'),
      'clics_cta',      (select count(*) from e where type = 'clic_cta'),
      'commences',      (select count(*) from l),
      'termines',       (select count(*) from l where statut <> 'partielle')
    ),
    'semaine', jsonb_build_object(
      'leads_recus',    (select count(*) from l where statut <> 'partielle'),
      'abandons',       (select count(*) from l where statut = 'partielle'),
      'argent',         (select coalesce(jsonb_object_agg(argent, n), '{}') from (select argent, count(*) n from l where statut <> 'partielle' group by argent) x),
      'contactes',      (select count(*) from l where premier_contact_le is not null),
      'ont_repondu',    (select count(*) from l where dernier_message_du_lead),
      'qualifies',      (select count(*) from l where qualite in ('chaud', 'tiede')),
      'calls_poses',    (select count(*) from l where call_le is not null),
      'calls_realises', (select count(*) from l where resultat_call is not null and resultat_call not in ('a_venir', 'absent')),
      'closes',         (select count(*) from l where resultat_call = 'close')
    ),
    'pipeline', jsonb_build_object(
      'par_statut',     (select coalesce(jsonb_object_agg(statut, n), '{}') from (select statut, count(*) n from l group by statut) x),
      'delai_moyen_premier_contact_heures',
                        (select round(extract(epoch from avg(premier_contact_le - depose_le)) / 3600.0, 1) from l where premier_contact_le is not null),
      'taux_reponse',   (select round(100.0 * count(*) filter (where dernier_message_du_lead) / nullif(count(*) filter (where premier_contact_le is not null), 0), 1) from l),
      'taux_closing',   (select round(100.0 * count(*) filter (where resultat_call = 'close') / nullif(count(*) filter (where resultat_call in ('close', 'pas_close', 'r2_a_prevoir')), 0), 1) from l),
      'montant_total',  (select coalesce(sum(m.montant), 0) from tunnel.montants m join l on l.id = m.lead_id)
    ),
    'setters', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'setter', eq.nom,
        'contactes', (select count(*) from l where l.setter_id = eq.user_id and premier_contact_le is not null),
        'calls_poses', (select count(*) from l where l.setter_id = eq.user_id and call_le is not null),
        'qualifies', (select count(*) from l where l.setter_id = eq.user_id and qualite in ('chaud', 'tiede')),
        'actions', (select count(*) from tunnel.historique h where h.qui = eq.user_id and h.le >= p_debut and h.le < p_fin),
        'derniere_action', (select max(h.le) from tunnel.historique h where h.qui = eq.user_id)
      )), '[]') from tunnel.equipe eq where eq.role = 'setter'
    ),
    'en_retard_48h', (select count(*) from tunnel.leads where statut = 'nouveau' and depose_le < now() - interval '48 hours')
  ) into r;
  return r;
end $$;

grant execute on function tunnel.statistiques(timestamptz, timestamptz, text) to authenticated, service_role;

-- Rend le schéma visible par l'API (à ajouter aussi dans Réglages > API > Exposed schemas).
comment on schema tunnel is 'Tunnel de candidature et outil setter / closer de L''Académie des Sorciers';
