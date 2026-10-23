# Pilote J2 — préremplissage CAS

Fonctionnalité autorisée le 23 octobre 2026, ajoutée au navigateur existant. Les identifiants CAS et OpenVPN sont identiques selon l’utilisateur. MyNEIGE préremplit les champs ; **l’utilisateur clique lui-même sur « SE CONNECTER »**. Aucun clic, événement input/change ou envoi du formulaire n’est déclenché par le préremplissage.

## Utilisation

Après compilation du pilote et installation des dépendances :

```powershell
npm start
```

Saisir le compte VPN dans le formulaire local. Après validation du tunnel, APPIGS redirige vers CAS. Si la page correspond au contrat ci-dessous, les deux champs sont remplis et le formulaire MyNEIGE indique que le clic reste manuel. En cas de page différente, de saisie déjà présente, d’expiration ou de rechargement après consommation, saisir les identifiants directement sur CAS.

## Périmètre strict

- Document principal uniquement, dans une fenêtre explicitement liée par le processus principal, après réception de `VPN_READY` du contrôleur.
- Origine exacte `https://cas.univ-avignon.fr`, chemin `/cas/login`, sans userinfo ni fragment. Un seul paramètre `service`, désignant HTTPS sur l’origine exacte `https://www.appigs.univ-avignon.fr`.
- Un seul formulaire `fm1`, méthode POST, destination effective CAS `/cas/login`, sans cible ni surcharge d’action/méthode/cible sur les boutons.
- Champs identifiant/mot de passe uniques, actifs, modifiables et vides ; champs cachés `execution` non vide et `_eventId=submit` présents. Les doublons, y compris ceux associés au formulaire hors de son arbre, sont refusés.
- Après réponse IPC, revérification de l’URL, des mêmes nœuds, de l’action et des valeurs cachées. Si la page a changé pendant le transfert, aucun remplissage.

Le HTML utilisateur a servi à identifier ce contrat ; il n’est pas copié dans le programme. Aucun jeton de son fichier n’est réutilisé. Le navigateur conserve les cookies et l’état de la page réellement chargée ; le remplissage ne modifie que les valeurs des deux champs visibles. La soumission manuelle garde les contrôles et traitements CAS.

## Secrets et frontières

Le processus principal Electron garde une copie en buffers pendant 3 minutes maximum depuis la soumission initiale. Le contrôleur natif garde son effacement après l’échange OpenVPN. L’IPC CAS authentifie l’émetteur par fenêtre et frame principale, vérifie URL/service et disponibilité du VPN, puis consomme la copie une seule fois. Pas de credentials en fichier, argument, journal, URL, stockage web ou source JavaScript générée.

Le preload fonctionne avec sandbox et isolation de contexte ; aucun `contextBridge` ni getter de mot de passe n’est exposé au site. Les valeurs passent par IPC structuré, sans interpolation dans du code. Les copies de buffers sont effacées, les références JavaScript relâchées au mieux. Les chaînes et copies internes du navigateur ne permettent pas une garantie d’effacement total.

Après remplissage, le mot de passe existe nécessairement dans le DOM de CAS et ses scripts peuvent le lire. Les champs remplis sont vidés sur `pagehide` ; la copie du processus principal a déjà été consommée. Fermer/bloquer la session efface toute copie encore en attente. Un rechargement ne recharge pas automatiquement les identifiants. MFA, challenges et erreurs restent traités manuellement, sans boucle d’authentification.

## Vérification

```powershell
npm test
npm run test:cas        # Formulaire Chromium uniquement, sans UAC ni VPN
npm run browser:test
```

Les tests Node couvrent URL/service, fenêtre/frame, VPN non prêt, consommation unique, effacement des buffers, expiration et fermeture. Le test Electron utilise des identifiants fictifs et des réponses HTTPS interceptées dans des sessions de test distinctes, sans connexion CAS ni désactivation TLS. Il vérifie le remplissage, les caractères spéciaux, les champs cachés/cookies intacts, zéro soumission automatique, l’absence de Node/bridge sur le site, le refus d’autres origines/services/actions, des doublons, des sous-cadres et des saisies existantes, ainsi que l’absence de réutilisation après rechargement/annulation.

Les fixtures remplacent le transport uniquement dans le test local ; l’essai réel conserve le proxy WFP, le relais VPN et la validation TLS existants. Les résultats effectivement exécutés sont dans [POC_STATUS.md](POC_STATUS.md).

Validation du 23 octobre : 42 tests natifs/JavaScript et neuf scénarios Chromium réussis, avec et sans le précontrôle WFP. Essai réel confirmé par l’utilisateur : deux champs CAS préremplis, accès APPIGS après clic manuel ; fermeture propre avec code 0. Aucune soumission automatique ajoutée.
