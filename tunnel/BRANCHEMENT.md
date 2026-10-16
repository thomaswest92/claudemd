# Brancher la page de candidature

Résultat : chaque candidature arrive en temps réel dans un Google Sheet, déjà triée pour le setter.

Temps estimé : 15 minutes (20 avec l'analyse par Claude). Coût : 0 €, plus quelques centimes par candidature si l'analyse par Claude est activée.

## Ce que le setter voit

L'onglet **Candidatures** est sa file de travail, triée automatiquement à chaque nouvelle candidature complète :
1. en haut, les candidatures complètes **À contacter** : priorité A d'abord, puis B, puis C, et à priorité égale la plus ancienne (pour tenir les 48 h promises) ;
2. ensuite les candidatures déjà traitées ;
3. tout en bas, les **partielles** (contact laissé, questionnaire pas fini), en gris.

Colonnes, de gauche à droite, dans l'ordre où le setter en a besoin :
- **Priorité** selon l'argent (question 3) : A · Prioritaire (5 000 € et plus par mois), B · À creuser (2 000 à 5 000 €), C · Pas prioritaire (moins de 2 000 €). Les seuils se règlent dans `CONFIG.PRIORITE` en haut du script.
- **Reçue le** : orange après 24 h sans contact, rouge après 48 h.
- **Suivi** : menu déroulant (À contacter, Contacté, Appel fixé, Closé, Pas qualifié, Injoignable).
- **Instagram** et **WhatsApp** : cliquables, le lien WhatsApp ouvre directement la conversation.
- **Revenus mensuels** et **Situation financière** juste à côté, pour juger l'argent en un coup d'œil.
- **Analyse de Claude** et **Note projet** (si activé, étape 5) : recommandation, capacité à investir, résumé en deux phrases, points à surveiller, note du projet sur 5.
- Les autres réponses, **WhatsApp confirmé** (le candidat a cliqué sur le bouton de la page de remerciement), la source, puis les colonnes **Setter** et **Notes**.

Le menu **Académie** du Sheet permet de retrier la file à la main.

L'onglet **Tableau de bord** donne les visites, le taux de conversion, le taux d'abandon, les confirmations WhatsApp, les candidatures en retard et la répartition par priorité, par revenus, par suivi et par source.

## 1. Créer le Google Sheet et coller le script

1. Crée un Google Sheet, ou ouvre votre CRM existant : le script ajoute ses propres onglets.
2. Menu **Extensions > Apps Script**.
3. Efface le contenu de `Code.gs`, colle tout le contenu de `tunnel/google-sheet/Code.gs`, enregistre.
4. En haut du fichier, dans `CONFIG` :
   - `EMAILS` : les adresses qui reçoivent une alerte à chaque candidature complète, par exemple `['marco@...']`. L'objet de l'e-mail commence par la priorité.
   - `PRIORITE` : vérifie les seuils.
5. Choisis la fonction **installer** puis **Exécuter**. Accepte les autorisations demandées par Google.

## 2. Mettre le script en ligne

1. **Déployer > Nouveau déploiement**, type **Application Web**.
2. « Exécuter en tant que » : **Moi**. « Qui a accès » : **Tout le monde**.
3. **Déployer**, puis copie l'URL qui se termine par `/exec`. Ouvre-la dans ton navigateur : tu dois voir `{"ok":true,...}`.

Après chaque modification du script : **Déployer > Gérer les déploiements > Modifier > Nouvelle version**. L'URL reste la même.

## 3. Fabriquer la page

```
python3 tunnel/build.py --envoi https://script.google.com/macros/s/TON_ID/exec --whatsapp 33612345678
```

`--whatsapp` est le numéro WhatsApp de l'Académie, au format international sans le +. C'est lui qui reçoit le message « Je viens de déposer ma candidature » quand le candidat clique sur « Confirmer sur WhatsApp ». Utilise le WhatsApp du setter, idéalement en WhatsApp Business.

La page prête est créée dans `tunnel/site/index.html`.

## 4. Mettre la page en ligne sur Netlify

1. Netlify : **Add new site > Deploy manually**, glisse le dossier `tunnel/site`.
2. **Domain management** : branche le domaine ou le sous-domaine choisi.
3. Fais une candidature test de bout en bout, vérifie la ligne et l'e-mail, puis supprime la ligne de test.

Mets un lien différent par endroit (`?utm_source=louis` dans la bio de Louis, `?utm_source=b2b` sur le compte commun) : la colonne Source dira quel compte amène les bons profils.

## 5. Facultatif : l'analyse par Claude

1. Crée une clé sur https://platform.claude.com (rubrique API keys) et ajoute un moyen de paiement.
2. Dans Apps Script : **Paramètres du projet > Propriétés du script > Ajouter**, nom `ANTHROPIC_API_KEY`, valeur : la clé. Ne la colle jamais dans le code.
3. Lance la fonction **installer** une nouvelle fois : elle active l'analyse automatique (une vérification par minute).
4. Lance **testerUneCandidature** : une ligne de test apparaît avec « Analyse en attente... », puis l'analyse s'écrit dans la minute. Supprime la ligne ensuite.

Règle intégrée : l'argent reste éliminatoire. Une candidature en priorité C n'est jamais marquée « Appeler en priorité », même si le projet est bon.

## 6. Facultatif : GoHighLevel ou votre SaaS

Colle l'URL d'un webhook entrant dans `CONFIG.WEBHOOKS` puis redéploie. Chaque candidature complète y part en JSON avec ces champs : `phone`, `instagram`, `instagram_url`, `priorite`, `revenus_mensuels`, `presentation`, `activite`, `situation_financiere`, `rapport_reseaux`, `source`, `id`, `recu_le`.

## Ce que la page vérifie

- **WhatsApp** : le numéro doit exister pour le pays choisi. S'il est collé avec un indicatif (+44...), le pays se met à jour seul. Il est enregistré au format international.
- **Instagram** : un nom d'utilisateur valide. Un lien de profil ou un @ sont nettoyés.
- **Les 5 questions** sont obligatoires.
- **Anti-robots** : un champ invisible piège les robots.
- **Brouillon** : si la page se recharge, les réponses restent sur le téléphone du candidat.
