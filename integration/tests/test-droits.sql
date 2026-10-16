-- Tests de la migration : doublons, historique, droits par rôle, vues et statistiques.
\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-00000000000a','admin@x'),('00000000-0000-0000-0000-00000000000b','setter@x'),('00000000-0000-0000-0000-00000000000c','closer@x'),('00000000-0000-0000-0000-00000000000d','closer2@x');
insert into tunnel.equipe values ('00000000-0000-0000-0000-00000000000a','admin','Marco'),('00000000-0000-0000-0000-00000000000b','setter','Setter'),('00000000-0000-0000-0000-00000000000c','closer','Closer A'),('00000000-0000-0000-0000-00000000000d','closer','Closer B');

-- La fonction "candidature" (clé service) crée une partielle puis la complète
set role service_role;
insert into tunnel.leads (cle_formulaire, whatsapp, whatsapp_valide, instagram) values ('form-1', '+33611223344', true, 'coach.lyon');
update tunnel.leads set q1_presentation='Coach', q3_revenus='5 000 à 10 000 €', statut='nouveau', argent_auto=tunnel.argent_par_tranche('5 000 à 10 000 €') where cle_formulaire='form-1';
insert into tunnel.leads (cle_formulaire, whatsapp, instagram, statut, depose_le) values ('form-2', '+33611223344', 'Coach.Lyon', 'nouveau', now() - interval '50 hours');
insert into tunnel.leads (cle_formulaire, whatsapp, instagram, statut, depose_le, closer_id, call_le) values ('form-3', '+33700000000', 'autre', 'rendez_vous', now() - interval '3 days', '00000000-0000-0000-0000-00000000000c', now());
insert into tunnel.montants (lead_id, montant, closer_id) select id, 4000, '00000000-0000-0000-0000-00000000000c' from tunnel.leads where cle_formulaire='form-3';
reset role;

select 'argent form-1 = ' || argent || ', depose_le rempli = ' || (depose_le is not null) from tunnel.leads where cle_formulaire='form-1';
select 'doublon form-2 -> form-1 : ' || (doublon_de = (select id from tunnel.leads where cle_formulaire='form-1')) from tunnel.leads where cle_formulaire='form-2';

-- Le setter
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'setter voit leads : ' || count(*) from tunnel.leads;
select 'setter voit montants : ' || count(*) from tunnel.montants;
update tunnel.leads set statut='prise_de_contact', qualite='chaud', argent_manuel='vert' where cle_formulaire='form-2';
select 'premier contact horodaté : ' || (premier_contact_le is not null) || ', argent corrigé = ' || argent from tunnel.leads where cle_formulaire='form-2';
select 'historique visible setter : ' || count(*) || ' (sensible : ' || count(*) filter (where sensible) || ')' from tunnel.historique;
select 'qui a modifié : ' || string_agg(distinct qui_nom, ', ') from tunnel.historique where champ='qualite';
select 'rubriques : ' || string_agg(coalesce(rubrique,'-') || '/' || coalesce(urgence,'-'), ' ') from tunnel.a_traiter;
select 'manque prochaine action form-2 : ' || manque_prochaine_action from tunnel.a_traiter where cle_formulaire='form-2';
do $$ begin perform tunnel.statistiques(); raise exception 'le setter ne devrait pas voir les stats'; exception when others then if sqlerrm like 'Réservé%' then raise notice 'stats refusées au setter : ok'; else raise; end if; end $$;
do $$ begin insert into tunnel.montants (lead_id, montant) select id, 1 from tunnel.leads limit 1; raise exception 'insertion montant setter acceptée'; exception when insufficient_privilege then raise notice 'montant interdit au setter : ok'; end $$;

-- Le closer A
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select 'closer A voit leads : ' || count(*) from tunnel.leads;
select 'closer A voit montants : ' || count(*) from tunnel.montants;
update tunnel.leads set resultat_call='close' where cle_formulaire='form-3';
-- Le closer B
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select 'closer B voit leads : ' || count(*) || ', montants : ' || (select count(*) from tunnel.montants) from tunnel.leads;

-- L'admin
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'admin voit leads : ' || count(*) || ', montants : ' || (select sum(montant) from tunnel.montants) from tunnel.leads;
select 'stats : ' || jsonb_pretty(tunnel.statistiques(now() - interval '7 days', now() + interval '1 hour'));

-- Un inconnu connecté (pas dans l'équipe)
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select 'inconnu voit leads : ' || count(*) from tunnel.leads;
reset role;
