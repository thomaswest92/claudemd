# Brancher la page de candidature sur un Google Sheet

Résultat : chaque candidature arrive en temps réel dans un Google Sheet mis en forme pour le setter. Une ligne par candidat :
- **Partielle** dès que WhatsApp et Instagram sont remplis, même si la personne abandonne ensuite. Les réponses se complètent au fur et à mesure qu'elle écrit.
- **Complète** quand elle clique sur « Je dépose ma candidature ». Un e-mail part alors aux adresses choisies.

Le script crée aussi :
- un onglet **Visites** (une ligne par visite de la page) ;
- un onglet **Tableau de bord** : visites, candidatures complètes et partielles, taux de conversion, taux d'abandon, candidatures en retard, répartition par tranche de revenus, par étape de suivi et par source, en total et sur 7 jours.

Une candidature complète restée « À contacter » voit sa date passer en orange après 48 h et en rouge après 72 h : c'est la promesse faite au candidat.

Le setter a ses propres colonnes (Setter, Suivi avec menu déroulant coloré, Notes) : le script n'y touche jamais. Instagram et WhatsApp sont des liens cliquables (le lien WhatsApp ouvre directement la conversation).

Temps estimé : 15 minutes. Coût : 0 €.

## 1. Créer le Google Sheet et coller le script

1. Crée un Google Sheet, ou ouvre votre CRM existant (le script ajoute simplement un onglet « Candidatures »).
2. Menu **Extensions > Apps Script**.
3. Efface le contenu de `Code.gs`, colle tout le contenu de `tunnel/google-sheet/Code.gs`, enregistre.
4. En haut du fichier, dans `CONFIG` :
   - `EMAILS` : les adresses qui reçoivent une alerte à chaque candidature complète, par exemple `['marco@...', 'louis@...']`.
   - `WEBHOOKS` : laisse vide pour l'instant (voir l'étape 5).
5. En haut de l'éditeur, choisis la fonction **installer** puis clique sur **Exécuter**. Google demande des autorisations : accepte avec ton compte. L'onglet « Candidatures » se crée et se met en forme.

## 2. Mettre le script en ligne

1. Bouton **Déployer > Nouveau déploiement**.
2. Type : **Application Web**.
3. « Exécuter en tant que » : **Moi**. « Qui a accès » : **Tout le monde**.
4. **Déployer**, puis copie l'URL qui se termine par `/exec`.

Vérification : ouvre cette URL dans ton navigateur. Tu dois voir `{"ok":true,...}`.

Si tu modifies le script plus tard : **Déployer > Gérer les déploiements > Modifier > Nouvelle version**. L'URL reste la même.

## 3. Fabriquer la page branchée

Dans le dépôt :

```
python3 tunnel/build.py --envoi https://script.google.com/macros/s/TON_ID/exec
```

La page prête à mettre en ligne est créée dans `tunnel/site/index.html`.

## 4. Mettre la page en ligne sur Netlify

1. Sur Netlify : **Add new site > Deploy manually**, puis glisse le dossier `tunnel/site`.
2. Dans **Domain management**, branche le domaine ou sous-domaine choisi (par exemple `candidature.tondomaine.com`).
3. Fais une candidature test de bout en bout et vérifie la ligne dans le Sheet et l'e-mail. Supprime ensuite la ligne de test.

Astuce suivi : mets des liens différents selon l'endroit où tu les publies, par exemple `?utm_source=louis` dans la bio de Louis et `?utm_source=b2b` sur le compte B2B. La colonne **Source** du Sheet dira d'où vient chaque candidat.

## 5. Facultatif : envoyer aussi vers GoHighLevel ou votre SaaS

1. Dans GoHighLevel : **Automation > Workflows > nouveau workflow**, déclencheur **Inbound Webhook**. Copie l'URL du webhook.
2. Colle-la dans `WEBHOOKS` du script, par exemple `WEBHOOKS: ['https://services.leadconnectorhq.com/hooks/...']`, puis redéploie une nouvelle version (étape 2).
3. Dans le workflow, ajoute l'action **Create/Update Contact** et associe les champs reçus : `phone`, `instagram`, `revenus_mensuels`, `presentation`, `activite`, `situation_financiere`, `rapport_reseaux`, `source`.

Même principe pour votre SaaS ou n'importe quel outil qui accepte un webhook entrant (Zapier, Make...) : chaque candidature complète y est envoyée en JSON.

## Ce que la page vérifie

- **WhatsApp** : le numéro doit exister pour le pays choisi (vérification par numéro, pays par pays, avec la librairie de Google). Si la personne colle un numéro avec indicatif (+44...), le pays se met à jour tout seul. Le numéro est enregistré au format international (+33612345678).
- **Instagram** : un nom d'utilisateur valide (lettres, chiffres, points, tirets bas). Si la personne colle un lien de profil ou met un @, c'est nettoyé.
- **Les 5 questions** : toutes obligatoires.
- **Anti-robots** : un champ invisible piège les robots, leurs envois sont ignorés.
- **Brouillon** : si la page se recharge, les réponses sont gardées sur le téléphone de la personne.
