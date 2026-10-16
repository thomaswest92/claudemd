# Intégration : tunnel de candidature et outil setter / closer

À l'attention de Louis (et de son Claude Code). Ce dossier branche la page de candidature de l'Académie sur la plateforme Supabase existante, et pose tout ce qu'il faut pour l'outil du setter, du closer et de l'admin.

Tout vit dans un schéma Postgres à part, `tunnel`, pour ne rien toucher aux tables existantes. Il n'y a rien à migrer ni à synchroniser : on installe directement dans le projet Supabase de la plateforme.

## Règles du métier (à respecter dans les écrans)

- Aucun message automatique aux leads. Le premier contact est toujours fait à la main par le setter.
- L'argent est le premier critère, mais l'outil ne fait que l'indiquer : personne n'est écarté automatiquement. L'indication est proposée (tranche de revenus, puis lecture de la réponse 4 par Claude), le setter peut la corriger à la main et sa correction est conservée.
- La plateforme relance le setter (vue « Aujourd'hui », e-mail du matin), jamais le lead.
- Le setter ne voit jamais les montants de closing. Le closer voit ses calls. L'admin voit tout.
- Mobile d'abord pour le setter, ordinateur pour le closer et l'admin.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `supabase/migrations/20261016000000_tunnel_setter.sql` | Tables, types, droits par rôle (RLS), historique automatique, doublons, vue `a_traiter`, fonction `statistiques` |
| `supabase/migrations/20261016000100_taches_planifiees.sql` | Limite par adresse IP, tâches planifiées (e-mail du matin, nouvel essai des analyses, purge des partielles) |
| `supabase/functions/candidature/` | Point d'entrée public de la page : candidatures partielles et complètes, commentaire, mesure d'audience |
| `supabase/functions/taches/` | Tâches appelées par `pg_cron` |
| `supabase/functions/_shared/` | Règles de validation, analyse par Claude, e-mails |
| `tests/` | Tests du schéma (PostgreSQL) et des règles (Node) |
| `../tunnel/src/page.html` | La page de candidature (source) |
| `../tunnel/src/outil.html` | La maquette validée de l'outil : la référence pour les écrans |

## Installation

1. **Migrations.** Copier les deux fichiers SQL dans `supabase/migrations/` de la plateforme, puis `supabase db push`. Le second fichier utilise `pg_cron`, `pg_net` et le coffre (`vault`) : à lancer après l'étape 3.
2. **Exposer le schéma.** Dashboard Supabase : Project Settings > API > Exposed schemas, ajouter `tunnel`.
3. **Fonctions.** Copier `supabase/functions/*` puis :
   ```
   supabase functions deploy candidature --no-verify-jwt
   supabase functions deploy taches --no-verify-jwt
   supabase secrets set ANTHROPIC_API_KEY=... RESEND_API_KEY=... \
     EMAIL_EXPEDITEUR="Académie des Sorciers <candidatures@DOMAINE>" \
     URL_OUTIL_SETTER=https://APP/setter \
     ORIGINES_AUTORISEES=https://academiedessorciers.app \
     SOURCES_LISIBLES='{"louis":"Compte de Louis","b2b":"Compte commun"}' \
     SEL_IP=une-chaine-aleatoire
   ```
   `candidature` est publique (pas de connexion), `taches` n'accepte que la clé service.
   Les e-mails passent par Resend par défaut. Si la plateforme utilise déjà un autre service, seule la fonction `envoyerEmail` de `_shared/email.ts` est à changer.
4. **Coffre et tâches planifiées.** Dans l'éditeur SQL :
   ```sql
   select vault.create_secret('https://PROJET.supabase.co', 'url_projet');
   select vault.create_secret('CLE_SERVICE', 'cle_service');
   ```
   puis lancer `20261016000100_taches_planifiees.sql`.
5. **Réglages.** Dans `tunnel.reglages` : `emails_nouveau_lead` et `emails_recap_quotidien` (listes JSON d'adresses, à demander à Louis). Les seuils de l'indication argent (`argent_par_tranche`), le délai de relance (48 h) et les paliers d'urgence (24 h, 48 h) sont aussi là : c'est le seul endroit à modifier.
6. **Comptes.** Créer les comptes du setter et des closers dans Supabase Auth, puis :
   ```sql
   insert into tunnel.equipe (user_id, role, nom, email) values ('UUID', 'setter', 'Prénom', 'email');
   ```
   Marco et Louis en `admin`.
7. **La page.** Elle doit être servie à **https://academiedessorciers.app/** (choix de Marco). Depuis ce dépôt : `python3 tunnel/build.py --envoi https://PROJET.supabase.co/functions/v1/candidature` produit `tunnel/site/index.html`, une page HTML autonome : la servir telle quelle à la racine du domaine (fichier statique ou route qui renvoie ce fichier). Si la racine sert déjà l'application, demander à Louis où déplacer l'une ou l'autre.
8. **Sauvegardes.** Elles dépendent de l'offre Supabase : quotidiennes sur Pro. À vérifier dans Database > Backups.

## Écrans à construire dans la plateforme

La maquette `tunnel/src/outil.html` (publiée : https://claude.ai/artifact/83rwt8bbvGxKE4tfr3onWc) montre chaque écran avec des exemples. Les requêtes passent par le client Supabase de la plateforme avec `.schema('tunnel')`. Les droits sont appliqués par la base : pas de filtrage de sécurité à refaire côté écran.

**Setter (téléphone)**
- *Aujourd'hui* : `a_traiter` filtrée par `rubrique` :
  - `nouveau` : triée par `ordre_argent` puis `depose_le` croissant, avec le compteur `urgence` (vert, orange, rouge) ;
  - `a_relancer` ;
  - `call_du_jour`.
- *Carte lead* :
  - nom ou @Instagram, numéro, indication argent et `argent_explication`, `resume_auto` ;
  - les 5 réponses en entier ;
  - un bouton WhatsApp (`https://wa.me/` + numéro sans le +), un bouton Instagram, et le statut modifiable en un clic.
- *Tableau de tous les leads* : une ligne par lead.
  - Toutes les colonnes du suivi : prénom, nom, conversation, qualité, statut (process), problèmes, dernier message (date et résumé), follow-up, prochaine action et sa date, call, closer, commentaire.
  - Puis les 5 réponses, la source, le résultat du call et la date de R2.
  - Modifiable directement, avec des filtres : statut, qualité, indication argent, source, closer, recherche.
- *Fiche* : tout le lead, la correction manuelle de l'indication (`argent_manuel`) et l'historique (`tunnel.historique`, du plus récent au plus ancien).
- *Messages* : `tunnel.messages`, avec un bouton Copier.
- Règle : un lead « actif » (prise de contact, éducation, proposition, rendez-vous) doit avoir une prochaine action et sa date. La vue renvoie `manque_prochaine_action`. L'écran doit bloquer l'enregistrement ou afficher l'alerte en rouge.
- Quand le setter note un message, il remplit `dernier_message_le`, `dernier_message_resume` et `dernier_message_du_lead`. Ce dernier vaut `true` si c'est le lead qui a répondu : il sert au taux de réponse et à la relance après 48 h sans réponse.

**Closer (ordinateur)** : ses leads (`closer_id` = lui, filtré par la base), triés par `call_le`. Sur la fiche complète, il saisit `resultat_call`, `r2_le`, et le montant dans `tunnel.montants`. Cette vue sera reprise avec Marco plus tard.

**Admin (ordinateur)** : `rpc('statistiques', { p_debut, p_fin, p_utm_source })` renvoie l'entonnoir, la semaine, le pipeline et l'activité de chaque setter, comme dans la maquette. Il gère aussi l'équipe, les réglages et les messages. L'export CSV se fait depuis `tunnel.leads` (avec `tunnel.montants` pour l'admin).

## API

**Créer un lead** (la page, ou tout autre formulaire) : `POST /functions/v1/candidature`, corps JSON :

```json
{ "type": "candidature", "id": "identifiant-unique-du-formulaire", "statut": "partielle | complète",
  "whatsapp": "+33612345678", "whatsapp_valide": true, "instagram": "nom", "sans_instagram": false,
  "q1": "...", "q2": "...", "q3": "5 000 à 10 000 €", "q4": "...", "q5": "...",
  "utm": { "source": "louis", "campaign": "...", "referrer": "instagram.com" }, "site": "" }
```

- Le même `id` met à jour la même ligne : pas de doublon pendant la saisie.
- `statut: "complète"` fait passer le lead à `nouveau`, horodate `depose_le`, lance l'analyse par Claude, puis envoie l'e-mail à l'équipe.
- Les autres types :
  - `{ "type": "commentaire", "id", "texte" }` ;
  - `{ "type": "visite" | "clic_cta" | "video_25" | "video_50" | "video_75" | "video_100", "utm" }`.

**Lire et modifier** : par le client Supabase de la plateforme, connecté, sur `tunnel.leads`, `tunnel.a_traiter`, `tunnel.historique`, `tunnel.montants`, `tunnel.messages`. Les droits de chaque rôle sont appliqués par la base. Chaque modification est tracée automatiquement dans `tunnel.historique` : qui, quand, champ, avant, après.

**Brancher sur le reste de la plateforme** :
- `tunnel.leads.id` est un UUID stable ;
- `mis_a_jour_le` permet une lecture incrémentale ;
- un Database Webhook Supabase sur `tunnel.leads` peut prévenir les autres modules (par exemple, créer le client quand `resultat_call` passe à `close`).

## Tests

```
psql ... -f integration/tests/supabase-local.sql   # imitation minimale de Supabase sur un PostgreSQL nu
psql ... -f integration/supabase/migrations/20261016000000_tunnel_setter.sql
psql ... -f integration/tests/test-droits.sql      # doublons, historique, droits admin / setter / closer, statistiques
node --experimental-strip-types integration/tests/regles.test.ts
deno check integration/supabase/functions/candidature/index.ts integration/supabase/functions/taches/index.ts
```

Ce qui a été vérifié :
- **Le schéma** : les droits de chaque rôle, l'historique, les doublons, la vue « à traiter », les statistiques et la limite par adresse IP, sur PostgreSQL 16.
- **Le code des fonctions** : la vérification de Deno passe.

Ce qui n'a pas été testé de bout en bout : les fonctions déployées sur un vrai projet Supabase, l'appel réel à Claude, l'envoi réel d'e-mails et les tâches planifiées. À faire juste après l'installation, avec une candidature de test.

## Coût de l'analyse par Claude

Modèle `claude-opus-5-5`, effort `low`, environ 1 500 mots en entrée et une courte réponse JSON. Estimation : 1 à 2 centimes par candidature complète, à vérifier sur les premières vraies candidatures dans la console Anthropic. Si l'appel échoue, l'indication reste celle de la tranche, et la tâche `analyses` réessaie toutes les 15 minutes en cas d'erreur passagère.

## Points ouverts

- Les adresses e-mail des alertes, et le service d'envoi : à demander à Louis.
- Les vidéos et leur hébergement. Le plus simple : un fichier MP4 compressé dans Supabase Storage, lu par la balise `<video>` de la page. Pas de service en plus, pas de cookie, et la mesure 25, 50, 75, 100 % est déjà codée.
- Les textes de la bibliothèque de messages (Marco).
- Les champs [À REMPLIR] de la page « Mentions légales et confidentialité », dont la durée de conservation. La purge automatique des candidatures partielles est réglée à 90 jours par défaut.
