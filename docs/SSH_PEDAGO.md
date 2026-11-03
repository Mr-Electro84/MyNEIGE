# Serveur pédagogique — terminal SSH

## Utilisation

Une fois le VPN prêt et la navigation universitaire ouverte, **CERI → Serveur pédagogique…** ouvre une fenêtre Electron séparée. Une seule fenêtre de terminal est conservée : un second clic la remet au premier plan.

La connexion cible exclusivement `pedago.univ-avignon.fr`, en SSH sur TCP 22. Les commandes s’exécutent sur ce serveur, avec les droits du compte universitaire. L’identifiant CAS/VPN est envoyé comme nom d’utilisateur SSH ; le nom du serveur n’est pas ajouté à cet identifiant. La notation habituelle `utilisateur@serveur` désigne ces deux informations séparées.

À chaque nouvelle connexion :

1. Si les identifiants du profil VPN sont enregistrés et Windows Hello disponible, une vérification Hello autorise leur lecture dans le coffre existant.
2. Sans enregistrement, ou si Hello/le coffre est indisponible, un dialogue local propose la saisie de l’identifiant et du mot de passe CAS/VPN. Cette saisie ne les enregistre pas.
3. Annuler Hello annule la connexion. Le bouton **Saisir les identifiants…** permet ensuite de choisir explicitement la saisie manuelle.
4. À la première connexion, une boîte affiche l’empreinte SHA-256 de la clé du serveur. La vérifier auprès de l’université avant de l’accepter. Aucune empreinte officielle n’est embarquée.

L’empreinte acceptée est conservée dans `%LOCALAPPDATA%\MyNEIGE\ssh-known-host.json`, séparément des identifiants et des données de navigation temporaires. Une clé différente bloque la connexion. Après confirmation d’un changement légitime par l’université, fermer le terminal, supprimer ce fichier et vérifier la nouvelle empreinte à la connexion suivante. Un fichier de confiance illisible ou malformé entraîne également un refus.

Le terminal prend en charge les couleurs, Unicode, le défilement, les applications interactives et le redimensionnement du pseudo-terminal distant. `Ctrl+C` est transmis au programme distant ; `Ctrl+Maj+C` copie la sélection. Les fonctionnalités disponibles, notamment les éditeurs, compilateurs et sessions `tmux`, dépendent du serveur.

**Déconnecter**, fermer la fenêtre, supprimer les identifiants enregistrés, perdre le VPN ou atteindre la fin de session ferme la connexion SSH. Les processus volontairement détachés sur le serveur restent soumis à ses règles habituelles. Une reconnexion demande une nouvelle authentification ; aucun essai répété de mot de passe n’est lancé automatiquement.

## Transport et isolation

Le client `ssh2` du processus principal utilise uniquement une socket TCP vers l’adresse numérique du relais local. Il ne résout pas le serveur et ne crée aucune connexion directe vers lui. Le relais accepte une exception CONNECT strictement limitée à `pedago.univ-avignon.fr:22`, uniquement dans son périmètre universitaire VPN.

Cette exception exige une capacité éphémère distincte de l’authentification proxy web, dérivée du secret de session avec SHA-256 et un préfixe de séparation. Le secret n’est jamais communiqué aux renderers. L’authentification web de Chromium ne permet pas d’ouvrir un tunnel SSH ; le relais public refuse le port 22. Les destinations web conservent leurs restrictions HTTPS/WSS 443.

Le relais résout le nom par les DNS du tunnel et utilise les mêmes sockets liées à l’adresse, à l’interface et à la génération VPN vérifiées que pour le web protégé. Les règles WFP d’Electron restent limitées au port du relais local. Aucun proxy système, DNS global ni routage physique par défaut n’est modifié.

Le tunnel SSH tolère trois minutes d’inactivité pour permettre la décision sur la première clé. Une fois la session établie, le client envoie un maintien de connexion toutes les dix secondes et ferme après trois réponses manquantes. Cela ne renouvelle pas la session MyNEIGE de deux heures.

## Identifiants et interface

Le terminal et son dialogue chargent uniquement des fichiers locaux, dans des renderers sandboxés sans Node, avec isolation de contexte et politique CSP interdisant les communications réseau. Leurs IPC vérifient la fenêtre, le document principal et son URL exacte. Les pages universitaires n’ont accès à aucun de ces canaux.

Le terminal d’affichage ne reçoit pas le mot de passe d’authentification. Celui-ci passe du coffre Hello ou du dialogue au client SSH dans le processus principal, puis au serveur après vérification de sa clé. Les copies contrôlées par l’application sont libérées au mieux après usage ; aucun effacement intégral de toutes les copies internes JavaScript ou Windows n’est garanti. Aucun journal de commandes ou de sorties du terminal n’est écrit sur disque par MyNEIGE.

Le client utilise une authentification par mot de passe, ou un unique prompt de mot de passe PAM si le serveur annonce seulement `keyboard-interactive`. Il ne remplit pas les prompts OTP, les champs visibles ou les questionnaires multiples. Une évolution MFA du serveur nécessiterait une prise en charge dédiée.

Les sorties sont soumises à un contrôle de débit entre SSH et xterm.js, avec acquittements du renderer. Les acquittements d’une ancienne connexion ne peuvent débloquer une nouvelle connexion. Le défilement est limité à 3 000 lignes, les dimensions du terminal et la taille des entrées sont bornées. Les liens et titres provenant du terminal ne déclenchent pas d’action système ; aucun transfert de fichiers, agent SSH, redirection de ports ou X11 n’est exposé par cette interface.

## Dépendances et développement

Les versions sont épinglées dans `package.json` et `package-lock.json`. `src/runtime-dependencies.txt` recense les modules JavaScript requis, y compris les dépendances transitives. Le staging natif de développement copie cette liste dans le répertoire de session protégé, avec les licences. Les accélérateurs `.node` compilés pour Node sont exclus afin de conserver le chemin JavaScript dans Electron. Le script de distribution applique la même liste ; son adaptation ne constitue pas une construction de distribution.

Commandes de vérification sans compte universitaire :

```powershell
npm test
npm run test:ssh
npm run test:browser
npm run test:session
npm run browser:test
```

`npm test` couvre le protocole natif, la séparation des capacités web/SSH, le coffre fictif et les tests Node. Les tests SSH Node ouvrent des ports de boucle locale pour un serveur et un proxy fictifs : ils nécessitent un environnement autorisant ces connexions. Ils vérifient notamment un vrai échange SSH local, le pseudo-terminal, Unicode, Ctrl+C, le redimensionnement et le refus d’authentifier un serveur dont la clé n’est pas acceptée.

`test:ssh` utilise de vraies fenêtres Electron et xterm.js, avec coffre/Hello et connexion simulés. Il vérifie le dialogue modal, l’IPC, les reconnexions, l’annulation et l’arrêt. Les captures fictives sont produites dans `.local/ssh-preview/`. `browser:test` vérifie aussi le chargement des dépendances SSH et du terminal depuis le staging protégé sous WFP, sans connexion SSH distante.

## Recette réelle à effectuer

Avec `npm start` et un compte autorisé, vérifier :

- L’accès effectif au serveur sur TCP 22 depuis le VPN, les droits du compte et l’empreinte confirmée par l’université.
- La vérification Windows Hello réelle, son annulation et la saisie lorsque Hello est indisponible ou les identifiants non enregistrés.
- Un shell interactif, un éditeur plein écran, une période d’inactivité et une sortie volumineuse interrompue par Ctrl+C.
- La fermeture du terminal pendant Hello ou pendant la confirmation de clé, puis sa réouverture.
- La coupure du VPN et du relais, l’expiration et la fermeture du formulaire principal : aucune résolution DNS ou connexion SSH ne doit emprunter le réseau physique en secours.
- Le maintien de la connexion habituelle des autres applications, sans modification de leur DNS.

Les compilations, tests de protocole, échanges SSH locaux et tests de chargement sous WFP ne démontrent pas à eux seuls l’isolation réseau réelle de SSH sur le VPN universitaire. Aucun essai d’authentification sur le serveur pédagogique n’est réalisé par les tests automatiques.
