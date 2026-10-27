# Navigation, téléchargements, logo et avertissement

Ce guide décrit les menus, les liens externes, les téléchargements, la consultation des PDF et les ressources graphiques de l’application. La construction des paquets est décrite dans le [guide de distribution](ALPHA_DISTRIBUTION.md).

## Navigation

Chaque fenêtre universitaire dispose d’un menu natif Windows :

| Commande | Raccourci | Fonction |
| --- | --- | --- |
| Navigation → Précédent | Alt + gauche | Revient à une entrée admise de l’historique de cette fenêtre. |
| Navigation → Suivant | Alt + droite | Avance dans cet historique. |
| Navigation → Accueil APPIGS | Alt + début | Ouvre l’adresse APPIGS initiale dans la même session. |
| Université → ENT | — | Ouvre `https://ent.univ-avignon.fr/` dans la fenêtre principale. |
| Université → Annuaire (VPN) | — | Ouvre `https://annuaire.univ-avignon.fr/` dans la fenêtre principale. |
| Université → Gestionnaire de projets (VPN) | — | Ouvre `https://projets.univ-avignon.fr/` dans la fenêtre principale. |
| Université → E-UAPV/Moodle | — | Ouvre `https://e-uapv.univ-avignon.fr/` dans la fenêtre principale. |
| Université → EDT | — | Ouvre `https://edt.univ-avignon.fr/` dans la fenêtre principale. |
| Université → Mail | — | Ouvre `https://partage.univ-avignon.fr/` dans la fenêtre principale. |
| Université → Nextcloud | — | Ouvre `https://cloud.univ-avignon.fr/` dans la fenêtre principale. |
| Fichiers → Téléchargements | Ctrl + J | Ouvre la fenêtre de suivi, d’ouverture et de localisation des fichiers, avec annulation des transferts en cours. |

Précédent/suivant sont désactivés lorsqu’aucune entrée correspondante n’est disponible ou admise. Les contrôles de domaines et le proxy restent ceux de la session. L’accueil conserve les cookies de la session. Le préremplissage CAS reste à usage unique : revenir à une page de connexion ne redélivre pas les identifiants.

Le menu Université conserve la fenêtre initialement ouverte sur APPIGS, son historique et sa session ; depuis un pop-up, il cible aussi cette fenêtre principale, sans remplacer le contenu du pop-up. Ses commandes sont désactivées si le VPN n’est pas prêt ou si la fenêtre principale est fermée, et leur exécution revérifie ces conditions. Les services universitaires restent sous tunnel, à l'exception explicite de Mail/PARTAGE ; RENATER et les ressources externes YouTube/H5P autorisées utilisent la connexion habituelle. Le routage et ses limites sont décrits dans [les autorisations de contenus intégrés](EMBEDDED_CONTENT.md). Une session conservée ne garantit pas une authentification automatique sur chaque service ; les redirections CAS et l’accès réel restent à qualifier.

### Liens externes

Depuis une page HTTPS admise, une navigation principale vers un domaine extérieur aux domaines universitaires et RENATER est annulée dans MyNEIGE et son adresse HTTP/HTTPS est transmise au navigateur par défaut avec `shell.openExternal`. Cela couvre les liens dans la fenêtre courante, les liens ouvrant une nouvelle fenêtre (`target="_blank"`, Ctrl+clic, `window.open`) et ceux des pop-ups universitaires. La page MyNEIGE reste affichée. Le navigateur externe utilise ses propres cookies et son réseau habituel ; MyNEIGE ne lui transmet ni session, ni corps POST. Une nouvelle fenêtre demandée par un formulaire POST externe reste refusée, sans conversion en GET.

La délégation exige une session prête et une fenêtre source encore active. Elle n’est jamais déclenchée par le filtre de requêtes : les iframes, scripts, images, téléchargements et redirections HTTP hors politique restent bloqués. Les lecteurs intégrés autorisés conservent leur fonctionnement ; une navigation principale vers YouTube s’ouvre à l’extérieur. Les adresses universitaires ou RENATER refusées (HTTP, port non admis, point final dans le nom d’hôte) restent bloquées dans MyNEIGE sans repli externe, y compris après un échec du VPN ou du relais.

Seules les adresses HTTP/HTTPS externes sans identifiants dans l’URL sont déléguées. Les protocoles locaux ou applicatifs (`file:`, `javascript:`, `data:`, `mailto:`, etc.) restent refusés. Un échec de l’ouverture système affiche un avertissement local sans exposer l’URL ni le détail de l’erreur.

## Icône Electron

Le logo source est [Logo MyNEIGE@2x.png](../assets/Logo%20MyNEIGE@2x.png), un PNG transparent de 1 000 × 1 000 pixels. Le fichier dérivé [myneige.ico](../assets/myneige.ico) contient les tailles 16, 20, 24, 32, 40, 48, 64, 128 et 256 pixels. Il est fourni dans le dépôt ; aucune conversion au lancement n’est nécessaire. Pour le régénérer sous Windows après remplacement du logo :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-app-icon.ps1
```

Le formulaire, la fenêtre universitaire et tous les pop-ups reçoivent explicitement cette icône. Le processus définit le nom MyNEIGE et une identité de barre des tâches dédiée. Le contrôleur natif copie également les ressources `assets` en lecture seule dans le staging protégé, avec les mêmes contrôles de liens de réanalyse que le code. Après mise à jour du code natif, reconstruire avec `npm run poc:build` avant de lancer `npm start`.

L’icône de la barre de titre a été vérifiée visuellement sur une page fictive locale ; l’apparence exacte des regroupements/épinglages de la barre des tâches reste à confirmer en recette Windows. Le runtime de navigation reste `electron.exe`. Les paquets utilisent un lanceur natif `MyNEIGE.exe` avec icône intégrée ; l’installateur crée les raccourcis. Voir le [guide de distribution](ALPHA_DISTRIBUTION.md).

## Téléchargements

Les téléchargements passent par le moteur Chromium de la session universitaire, avec son contexte d’authentification, son proxy et WFP. Les pièces jointes Mail/PARTAGE suivent la sortie publique autorisée ; les autres documents universitaires restent sous VPN. Aucun transfert n’est délégué à Node, curl ou une autre application. Une boîte « Enregistrer le fichier » propose un nom normalisé et laisse l’utilisateur choisir la destination, avec confirmation d’écrasement.

- HTTPS uniquement vers les domaines universitaires et RENATER admis ; toute la chaîne de redirections est contrôlée. Les exceptions vidéo ne donnent pas accès au téléchargement des flux externes.
- Les fichiers `blob:` générés par la page sont acceptés seulement si leur origine correspond à la page universitaire initiatrice.
- Une fenêtre de téléchargement doit appartenir à la session et le VPN doit être prêt. Les pièces jointes ouvertes dans une nouvelle fenêtre utilisent la destination explicitement admise par le contrôleur de fenêtres.
- Les pop-ups conservent le cycle natif Chromium : corps POST, fenêtre nommée et lien `window.opener`. Une fenêtre initialement `about:blank` peut être préparée par une page universitaire HTTPS ; ses navigations et transferts restent filtrés. Toutes ces fenêtres utilisent la même session, les mêmes menus et les mêmes protections, sans accès Node ni API exposée au site.
- Noms proposés sans séparateurs de chemin, caractères de contrôle, flux alternatifs, noms de périphériques Windows ni caractères de direction trompeurs. Le choix final du chemin reste celui de l’utilisateur.
- Progression dans la barre des tâches et dans la fenêtre non bloquante **Fichiers → Téléchargements** (`Ctrl+J`). Un seul exemplaire de cette fenêtre est ouvert : les appels suivants le ramènent au premier plan. La fermer n’annule pas les transferts ; **Annuler les transferts en cours** conserve l’annulation explicite.
- Chaque ligne affiche le nom réellement enregistré (y compris après renommage), le poids reçu, la progression et la date/heure locale. La date affichée est celle de fin pour un transfert terminé ou arrêté, et celle de début pendant le transfert. Si la taille totale est inconnue, la progression reste indéterminée. L’historique récent est conservé uniquement en mémoire : les 20 entrées les plus récentes et les transferts encore actifs plus anciens.
- **Ouvrir** utilise l’application Windows associée ; **Afficher dans le dossier** sélectionne le fichier dans l’Explorateur lorsque Windows le permet. Les actions sont disponibles seulement après réussite du téléchargement et vérifient la présence du fichier. Une suppression, un déplacement ou une erreur d’ouverture est signalé dans la fenêtre. Aucun fichier n’est ouvert automatiquement.
- Fermeture de la fenêtre, blocage ou arrêt de la session : annulation des transferts actifs. Aucune reprise automatique hors tunnel, aucune ouverture/exécution automatique du fichier.

Les fichiers complètement enregistrés restent au chemin choisi après fermeture du pilote. Les fichiers partiels sont soumis au comportement d’annulation Chromium ; le pilote ne supprime pas arbitrairement les fichiers de l’utilisateur. Un fichier ouvert ensuite dans un logiciel tiers relève du réseau et des droits de ce logiciel.

La fenêtre utilise une session locale sans réseau, un renderer sandboxé et un preload dédié. Les commandes IPC vérifient la fenêtre émettrice, sa frame principale et son URL locale exacte. Les chemins ne sont pas transmis au renderer : celui-ci fournit uniquement un identifiant de téléchargement et une action admise. Le processus principal retrouve le chemin choisi dans « Enregistrer le fichier », vérifie l’état et le fichier, puis délègue l’action à Windows. L’arrêt de la session ferme aussi la fenêtre et interdit les actions tardives.

Le diagnostic ne contient que les états `STARTED`, `COMPLETED`, `CANCELLED`, `INTERRUPTED` ou `REFUSED`, sans nom de fichier, chemin, URL ni contenu du document. Les noms sont visibles dans la fenêtre de suivi locale, pas dans les journaux MyNEIGE.

Pour les téléchargements dans MyNEIGE, les destinations hors politique, HTTP, `file:` et `data:` restent refusées. L’ouverture des liens web externes décrite ci-dessus n’élargit pas les autorisations de téléchargement de la session.

## Consultation des PDF

Les réponses `application/pdf` proposées en consultation (`Content-Disposition: inline` ou sans téléchargement forcé) utilisent le lecteur PDF intégré à Chromium, dans la session universitaire existante, y compris en iframe et en pop-up POST. Les pièces jointes `attachment` conservent le parcours de téléchargement.

Le lecteur nécessite des ressources locales que le filtrage HTTPS/WSS universitaire bloquait : l'extension intégrée `mhjfbmdgcfjbbpaeojofohoefgiehjai` et certaines ressources `chrome://resources`. Le module `src/main/pdf-policy.js` autorise uniquement sa page initiale en sous-fenêtre d'un document universitaire, une liste exacte de scripts/styles provenant du lecteur, et la navigation de son propre sous-cadre vers un flux PDF à identifiant UUID. Les ressources exigent le contexte de frame et l'origine initiatrice du lecteur ; les informations absentes ou les frames détruites sont refusées.

Ces exceptions ne modifient pas `allowedURL`, les domaines réseau, le proxy, WFP, le sandbox, l'isolation du contexte ou l'accès Node. Elles ne permettent pas les navigations principales vers les pages internes, les autres extensions ou les destinations externes. Les ressources internes ne sont pas journalisées comme des domaines réseau. La liste correspond à Electron 45.0.0 ; toute évolution du lecteur doit être validée par les tests de consultation avant d'élargir cette liste.

## Avertissement de connexion

L’écran de connexion affiche « Version Alpha » et reprend le bleu `#182f9e` et la pervenche `#5d6dbb` du logo MyNEIGE. Les informations, l’état de la connexion, l’avertissement et les actions Windows Hello occupent la colonne de gauche ; la saisie manuelle et les précisions sur les identifiants occupent celle de droite. La fenêtre s’ouvre en 1 120 × 900 pixels et la page repasse sur une colonne lorsque sa largeur est inférieure ou égale à 860 pixels.

L’encadré « Une version alpha à utiliser avec discernement » indique le caractère expérimental et indépendant, l’utilisation aux risques de l’utilisateur, l’absence de garantie, et la déclinaison de responsabilité de l’auteur pour les comptes VPN/CAS, pertes/altérations/divulgations de données et inexactitudes affichées. Le texte réserve les limites de la loi applicable et les droits auxquels on ne peut renoncer.

Cette formulation exprime une information et une limitation souhaitée, sans prétendre garantir une exonération juridique absolue. Elle accompagne les sections 7 et 8 de la [licence Apache 2.0 du dépôt](../LICENSE), qui reste inchangée. Aucun écran d’acceptation ni case obligatoire n’a été ajouté.

## Vérifications

Validation de la fenêtre des téléchargements du 28 octobre 2026 : `npm run test:js` réussit (79 tests Node), ainsi que `npm run test:downloads`, `npm run test:browser` (48 vérifications Chromium), `npm run test:session` et `npm run browser:test` (précontrôle WFP, téléchargement de fixtures, CAS et cycle de session). Les captures normales et étroites ont été contrôlées visuellement. Une recette locale distincte, hors confinement WFP, confirme les deux boutons sur un document texte fictif : ouverture dans le Bloc-notes Windows et affichage du dossier dans l’Explorateur. `npm start` atteint le formulaire local puis se ferme normalement (code 0), sans authentification universitaire. Le téléchargement depuis un vrai service universitaire et les actions Windows depuis une session VPN réelle restent à confirmer ; ces vérifications ne prouvent pas à elles seules l’isolation réseau réelle.

Validation des liens externes du 27 octobre 2026 : `npm run test:js` réussit (61 tests Node), ainsi que `npm run test:browser` (48 vérifications Chromium), `npm run test:cas` (9 cas, aucune soumission automatique), `npm run test:mail` (7 scénarios TLS locaux) et `npm run browser:test` (précontrôle WFP, fixtures navigateur, CAS et durée de session). Les nouveaux scénarios vérifient la délégation unique des liens dans la même fenêtre ou une nouvelle fenêtre, les liens depuis un pop-up, l’échec système avec avertissement sans données privées, et les refus pour ressources, iframes, POST en nouvelle fenêtre, protocoles non web, domaines internes mal formés, redirections et session indisponible. La délégation système est remplacée par un collecteur dans ces tests, y compris sous WFP : aucun vrai navigateur externe n’est lancé. `npm start` a été vérifié jusqu’au formulaire local puis fermé normalement (code 0), sans saisir d’identifiants ni démarrer le VPN universitaire. L’ouverture effective d’un lien dans le navigateur Windows choisi par l’utilisateur, depuis un service réel après connexion, reste à confirmer en recette ; ces tests ne démontrent pas l’isolation réseau réelle sous VPN.

La correction PDF porte le total à 27 vérifications Chromium : les 22 précédentes, consultation directe avec `inline`, consultation sans `Content-Disposition`, iframe, pop-up POST, et refus des navigations principales hors politique. Le PDF de test contient désormais une vraie page ; les tests attendent le chargement réussi du lecteur et vérifient le nombre de pages, l'URL source et l'absence d'accès Node. Une capture locale facultative permet de contrôler visuellement le rendu. Quatre tests Node supplémentaires vérifient les exceptions internes et leurs refus (autres extensions, types de requête, contexte absent/détruit, origine initiatrice et journalisation).

```powershell
npm test
npm run test:cas
npm run test:browser
npm run test:downloads
npm run browser:test  # Précontrôle complet avec WFP et UAC
```

Les tests Node contrôlent la provenance, les redirections, les noms, les fenêtres autorisées, la disponibilité du VPN, l’annulation et les destinations d’historique. Les douze vérifications Chromium initiales utilisent les mêmes fenêtres, menus, gestionnaire et filtrage de requêtes que le pilote : précédent, suivant, accueil, fichier HTTPS enregistré et contenu comparé, conservation de la session et du magasin de cookies, fenêtre de suivi, fichier `blob` enregistré, annulation d’un transfert en cours ; formulaires POST vers une nouvelle fenêtre et une fenêtre nommée, fenêtre vide préparée par JavaScript, maintien de la session et de l’isolation du pop-up, refus des ouvertures hors politique. Les réponses réseau sont des fixtures locales sans compte étudiant ; le test choisit un chemin sous `.local/` pour éviter une boîte de dialogue interactive. Cette fixture vérifie le magasin de cookies conservé, pas leur transmission à un serveur distant.

`test:downloads` complète la recette avec de vraies fenêtres Electron et des événements de téléchargement simulés : nom final, dates, tailles connues/inconnues, fichier absent, erreurs système, actions depuis une fenêtre étrangère refusées, maintien du focus, fenêtre unique, annulation et fermeture pendant le chargement ou à l’arrêt. Les appels d’ouverture et de localisation sont remplacés par des collecteurs dans les tests automatisés. Des captures avec des noms fictifs longs et une fenêtre étroite sont produites sous `.local/downloads-ui/`. L’ouverture dans un logiciel Windows et la localisation réelle dans l’Explorateur relèvent d’une recette locale distincte ; le parcours universitaire sous VPN reste à vérifier séparément.

L’extension Université/logo porte le total à 22 vérifications Chromium : les douze précédentes, lecture de l’icône depuis le chemin réel d’exécution, cinq destinations exactes dans le même WebContents/session sans nouvelle fenêtre, retour dans l’historique entre services, refus des commandes sans VPN y compris un clic déjà en attente, commande depuis un pop-up vers la fenêtre principale et refus après fermeture de celle-ci. Le test n’utilise aucun compte universitaire.

Le précontrôle WFP exécute aussi ces scénarios avec l’image Electron confinée et les ressources réellement copiées par le contrôleur natif. L’essai réel d’un fichier universitaire et de la boîte native de sauvegarde est suivi séparément dans [POC_STATUS.md](POC_STATUS.md).

Références : [Electron DownloadItem](https://www.electronjs.org/docs/latest/api/download-item), [NavigationHistory](https://www.electronjs.org/docs/latest/api/navigation-history), [création native des fenêtres](https://www.electronjs.org/docs/latest/api/web-contents#contentssetwindowopenhandlerhandler).
