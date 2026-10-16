# Message à envoyer à Louis

Marco : copie tout le bloc ci-dessous et envoie-le à Louis. Il n'a qu'à le coller dans son Claude Code, ouvert dans le dossier de la plateforme.

---

```
Je veux brancher sur notre plateforme (Supabase) la page de candidature et l'outil setter / closer / admin que Marco a préparés avec Claude.

1. Récupère le travail :
   git clone --branch claude/eager-noether-uv7e4i https://github.com/thomaswest92/claudemd.git ../sorciers-tunnel

2. Lis, dans cet ordre :
   - ../sorciers-tunnel/integration/README.md (le guide d'intégration, à suivre)
   - ../sorciers-tunnel/CLAUDE.md, section 11 (les décisions de Marco sur la page et l'outil)
   - ../sorciers-tunnel/tunnel/src/outil.html (la maquette validée des écrans setter, closer et admin)
   - ../sorciers-tunnel/tunnel/src/page.html (la page de candidature)

3. Avant de coder, regarde notre projet et dis-moi :
   - comment tu comptes intégrer le schéma "tunnel", les fonctions Supabase et les écrans dans notre code ;
   - où tu mets la page de candidature : elle doit être à l'adresse https://academiedessorciers.app/ ;
     si cette adresse sert déjà à autre chose, propose-moi une solution ;
   - ce qui te manque. Demande-moi en particulier :
     les adresses e-mail qui reçoivent les alertes (nouveau lead et récap du matin),
     le service d'envoi d'e-mails que la plateforme utilise déjà,
     la clé API Anthropic pour l'analyse des candidatures,
     les comptes du setter et des closers à créer.

4. Ensuite, suis le guide étape par étape. Ne mets rien en production sans me le montrer.
   Termine par une candidature de test de bout en bout : la page, la base, l'analyse, l'e-mail, et l'affichage dans l'outil du setter.
```

---

## Ce que Louis va recevoir

- `integration/` : la base de données (schéma `tunnel`), les fonctions Supabase (réception des candidatures, analyse par Claude, e-mails, tâches planifiées), les tests et le guide `README.md`.
- `tunnel/src/page.html` : la page de candidature, et `tunnel/build.py` pour la brancher sur la fonction Supabase.
- `tunnel/src/outil.html` : la maquette des écrans, qui sert de modèle.
- `CLAUDE.md` : le contexte de l'Académie et toutes tes décisions.

Le dépôt est public : Louis peut le récupérer sans rien installer de plus. Une fois l'intégration faite, il vaut mieux le passer en privé (il contient aussi tes prix).
