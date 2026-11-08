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

### Outils du terminal

La barre d’outils, le menu **Autres actions…** et le clic droit donnent accès aux opérations locales. Elles ne demandent aucune nouvelle connexion SSH.

| Action | Raccourci / comportement |
| --- | --- |
| Copier la sélection | `Ctrl+Maj+C`. Le texte est copié dans le presse-papiers Windows. |
| Coller | `Ctrl+Maj+V`, `Ctrl+V` ou `Maj+Inser`. Les retours à la ligne déclenchent une confirmation avec aperçu ; aucun retour final n’est ajouté par MyNEIGE. |
| Tout sélectionner | `Ctrl+Maj+A`. Sélectionne le contenu conservé par xterm. |
| Rechercher | `Ctrl+Maj+F`. Recherche dans l’écran et l’historique conservés, avec surlignage, compteur, respect de la casse et mot entier. `Entrée` / `Maj+Entrée` passe à l’occurrence suivante / précédente ; `Échap` ferme la barre. |
| Enregistrer la sortie | `Ctrl+Maj+S`. Choix explicite d’un fichier `.txt` UTF-8 contenant le tampon actif au moment de l’export. |
| Zoom | `Ctrl++`, `Ctrl+−`, `Ctrl+0`, ou boutons de taille du texte. Taille bornée de 10 à 28 pixels, défaut 14. |
| Effacer l’écran | Action locale qui efface le contenu visible ; l’historique antérieur et la connexion sont conservés. |
| Effacer l’historique | Supprime les lignes de défilement antérieures, en conservant l’écran courant et la connexion. |
| Aller en bas | Bouton affiché pendant la consultation de lignes anciennes. Il indique l’arrivée d’une nouvelle sortie. |

Les raccourcis habituels du programme distant, notamment `Ctrl+C`, `Ctrl+A` et `Ctrl+R`, conservent leur rôle (hors saisie dans la barre de recherche). Les collages utilisent le mode de collage négocié par le programme distant, notamment le *bracketed paste*. Un collage dépassant 60 Kio ou contenant des caractères de contrôle est refusé avec un message ; il ne ferme pas SSH. Réduire le texte ou le coller en plusieurs parties. L’accès au presse-papiers se fait dans le processus principal, uniquement depuis le document local du terminal ; les pages universitaires n’obtiennent pas cette API.

La recherche reste littérale : les caractères comme `+`, `[` ou `.` sont recherchés tels quels. Le surlignage et son compteur sont bornés à 1 000 résultats pour préserver la réactivité pendant des sorties abondantes.

L’export est un instantané du **contenu encore conservé**, pas un enregistrement continu : 3 000 lignes d’historique au maximum, en plus de l’écran courant. Les lignes déjà évincées, effacées ou perdues à la reconnexion ne sont pas récupérables. Dans un éditeur plein écran qui utilise le tampon alternatif, seul ce tampon actif est exporté. Les lignes simplement repliées par la largeur de fenêtre sont réunies ; les séquences de couleur et de contrôle ne sont pas exportées. Le texte est figé avant le dialogue de sauvegarde et le fichier est remplacé après une écriture temporaire réussie. Aucun journal n’est créé automatiquement.

Un export peut contenir les commandes affichées, leurs résultats et toute information sensible apparue dans le terminal. Le mot de passe d’authentification géré par Hello ou le dialogue local n’est pas ajouté à l’export. L’enregistrement reste une action explicite de l’utilisateur. Recherche et export restent disponibles après une déconnexion SSH tant que la fenêtre est ouverte dans une session MyNEIGE valide.

**Déconnecter**, fermer la fenêtre, supprimer les identifiants enregistrés, perdre le VPN ou atteindre la fin de session ferme la connexion SSH. Les processus volontairement détachés sur le serveur restent soumis à ses règles habituelles. Une reconnexion demande une nouvelle authentification ; aucun essai répété de mot de passe n’est lancé automatiquement.

## Transport et isolation

Le client `ssh2` du processus principal utilise uniquement une socket TCP vers l’adresse numérique du relais local. Il ne résout pas le serveur et ne crée aucune connexion directe vers lui. Le relais accepte une exception CONNECT strictement limitée à `pedago.univ-avignon.fr:22`, uniquement dans son périmètre universitaire VPN.

Cette exception exige une capacité éphémère distincte de l’authentification proxy web, dérivée du secret de session avec SHA-256 et un préfixe de séparation. Le secret n’est jamais communiqué aux renderers. L’authentification web de Chromium ne permet pas d’ouvrir un tunnel SSH ; le relais public refuse le port 22. Les destinations web conservent leurs restrictions HTTPS/WSS 443.

Le relais résout le nom par les DNS du tunnel et utilise les mêmes sockets liées à l’adresse, à l’interface et à la génération VPN vérifiées que pour le web protégé. Les règles WFP d’Electron restent limitées au port du relais local. Aucun proxy système, DNS global ni routage physique par défaut n’est modifié.

Le tunnel SSH tolère trois minutes d’inactivité pour permettre la décision sur la première clé. Une fois la session établie, le client envoie un maintien de connexion toutes les dix secondes et ferme après trois réponses manquantes. Cela ne renouvelle pas la session MyNEIGE de deux heures.

## Identifiants et interface

Le terminal et son dialogue chargent uniquement des fichiers locaux, dans des renderers sandboxés sans Node, avec isolation de contexte et politique CSP interdisant les communications réseau. Leurs IPC vérifient la fenêtre, le document principal et son URL exacte. Les pages universitaires n’ont accès à aucun de ces canaux.

Le terminal d’affichage ne reçoit pas le mot de passe d’authentification. Celui-ci passe du coffre Hello ou du dialogue au client SSH dans le processus principal, puis au serveur après vérification de sa clé. Les copies contrôlées par l’application sont libérées au mieux après usage ; aucun effacement intégral de toutes les copies internes JavaScript ou Windows n’est garanti. Aucun journal automatique de commandes ou de sorties du terminal n’est écrit sur disque par MyNEIGE ; seul l’export volontaire décrit ci-dessus enregistre le texte choisi.

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

`test:ssh` utilise de vraies fenêtres Electron et xterm.js, avec coffre/Hello, presse-papiers et connexion simulés. Il vérifie le dialogue modal, l’IPC, les reconnexions, l’annulation, l’arrêt, les collages, la recherche, l’export réel d’un texte fictif, les effacements et le zoom. Le rendu logiciel rend les captures reproductibles ; les vues fictives sont produites dans `.local/ssh-preview/`. Les tests Node vérifient aussi les limites de taille, les annulations tardives, le remplacement de fichier et les lignes repliées. `browser:test` vérifie le chargement des dépendances depuis le staging protégé sous WFP, sans connexion SSH distante.

## Recette réelle à effectuer

Avec `npm start` et un compte autorisé, vérifier :

- L’accès effectif au serveur sur TCP 22 depuis le VPN, les droits du compte et l’empreinte confirmée par l’université.
- La vérification Windows Hello réelle, son annulation et la saisie lorsque Hello est indisponible ou les identifiants non enregistrés.
- Un shell interactif, un éditeur plein écran, une période d’inactivité et une sortie volumineuse interrompue par Ctrl+C.
- La fermeture du terminal pendant Hello ou pendant la confirmation de clé, puis sa réouverture.
- La coupure du VPN et du relais, l’expiration et la fermeture du formulaire principal : aucune résolution DNS ou connexion SSH ne doit emprunter le réseau physique en secours.
- Le maintien de la connexion habituelle des autres applications, sans modification de leur DNS.

Les compilations, tests de protocole, échanges SSH locaux et tests de chargement sous WFP ne démontrent pas à eux seuls l’isolation réseau réelle de SSH sur le VPN universitaire. Aucun essai d’authentification sur le serveur pédagogique n’est réalisé par les tests automatiques.

### Validation des outils — 8 novembre 2026

Le mainteneur a confirmé le fonctionnement de l’accès SSH avant cet ajout. Pour les nouveaux outils : 111 tests Node réussis, tests Electron du terminal réussis et précontrôle WFP/Electron réussi depuis le staging de développement. Les scénarios couvrent les collages simples et multiligne, leur annulation et leur limite, le mode bracketed paste, les recherches avec casse et mot entier, l’export UTF-8, les effacements, le zoom, le défilement et Ctrl+R. Les vues à la taille minimale ont été inspectées. Ces vérifications utilisent des données fictives ; le presse-papiers et les dialogues sont simulés dans les tests automatisés. Aucun nouveau test d’authentification universitaire ni aucune distribution n’est produit dans ce cadre.
