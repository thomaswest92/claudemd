-- Limite d'envois par adresse IP (appelée par la fonction "candidature" avec la clé service).
create or replace function tunnel.compter_envoi(p_ip_hache text) returns int
language plpgsql security definer set search_path = tunnel, public as $$
declare
  v_fenetre timestamptz := date_trunc('hour', now()) + floor(extract(minute from now()) / 10) * interval '10 minutes';
  v_compteur int;
begin
  insert into tunnel.limites_ip (ip_hache, fenetre) values (p_ip_hache, v_fenetre)
  on conflict (ip_hache, fenetre) do update set compteur = tunnel.limites_ip.compteur + 1
  returning compteur into v_compteur;
  delete from tunnel.limites_ip where fenetre < now() - interval '1 day';
  return v_compteur;
end $$;
revoke execute on function tunnel.compter_envoi(text) from public, authenticated, anon;
grant execute on function tunnel.compter_envoi(text) to service_role;

-- =====================================================================
-- Tâches planifiées (Supabase : extensions pg_cron et pg_net)
-- À lancer APRÈS avoir déployé la fonction "taches" et rangé deux secrets dans le coffre :
--   select vault.create_secret('https://TON_PROJET.supabase.co', 'url_projet');
--   select vault.create_secret('TA_CLE_SERVICE', 'cle_service');
-- Les heures sont en UTC : 6 h UTC = 8 h à Paris en été, 7 h en hiver.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function tunnel.appeler_tache(p_tache text) returns void
language plpgsql security definer set search_path = tunnel, public as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'url_projet');
  v_cle text := (select decrypted_secret from vault.decrypted_secrets where name = 'cle_service');
begin
  perform net.http_post(
    url := v_url || '/functions/v1/taches',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_cle),
    body := jsonb_build_object('tache', p_tache)
  );
end $$;
revoke execute on function tunnel.appeler_tache(text) from public, authenticated, anon;

select cron.schedule('tunnel-recap-quotidien', '0 6 * * *', $$select tunnel.appeler_tache('recap_quotidien')$$);
select cron.schedule('tunnel-analyses-en-attente', '*/15 * * * *', $$select tunnel.appeler_tache('analyses')$$);
-- Candidatures partielles anonymes : suppression au-delà de la durée fixée dans la page légale (90 jours ici, à ajuster).
select cron.schedule('tunnel-purge-partielles', '30 3 * * *', $$delete from tunnel.leads where statut = 'partielle' and cree_le < now() - interval '90 days'$$);
