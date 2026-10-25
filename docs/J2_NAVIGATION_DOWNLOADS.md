# J2 — navigation, téléchargements, logo et avertissement

Extension du pilote Windows autorisée le 23 octobre 2026. Aucun packaging ajouté.

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
| Fichiers → Téléchargements | Ctrl + J | Affiche les états récents et permet d’annuler les transferts en cours. |

Précédent/suivant sont désactivés lorsqu’aucune entrée correspondante n’est disponible ou admise. Les contrôles de domaines et le proxy restent ceux de la session ; aucun navigateur externe n’est ouvert. L’accueil conserve les cookies de la session. Le préremplissage CAS reste à usage unique : revenir à une page de connexion ne redélivre pas les identifiants.

Le menu Université conserve la fenêtre initialement ouverte sur APPIGS, son historique et sa session ; depuis un pop-up, il cible aussi cette fenêtre principale, sans remplacer le contenu du pop-up. Ses commandes sont désactivées si le VPN n’est pas prêt ou si la fenêtre principale est fermée, et leur exécution revérifie ces conditions. Les services universitaires restent sous tunnel, à l'exception explicite de Mail/PARTAGE ; RENATER et les ressources externes YouTube/H5P autorisées utilisent la connexion habituelle. Le routage et ses limites sont décrits dans [les autorisations de contenus intégrés](EMBEDDED_CONTENT.md). Une session conservée ne garantit pas une authentification automatique sur chaque service ; les redirections CAS et l’accès réel restent à qualifier.

## Icône Electron

Le logo source est [Logo MyNEIGE@2x.png](../assets/Logo%20MyNEIGE@2x.png), un PNG transparent de 1 000 × 1 000 pixels. Le fichier dérivé [myneige.ico](../assets/myneige.ico) contient les tailles 16, 20, 24, 32, 40, 48, 64, 128 et 256 pixels. Il est fourni dans le dépôt ; aucune conversion au lancement n’est nécessaire. Pour le régénérer sous Windows après remplacement du logo :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-app-icon.ps1
```

Le formulaire, la fenêtre universitaire et tous les pop-ups reçoivent explicitement cette icône. Le processus définit le nom MyNEIGE et une identité de barre des tâches dédiée. Le contrôleur natif copie également les ressources `assets` en lecture seule dans le staging protégé, avec les mêmes contrôles de liens de réanalyse que le code. Après mise à jour du code natif, reconstruire avec `npm run poc:build` avant de lancer `npm start`.

L’icône de la barre de titre a été vérifiée visuellement sur une page fictive locale ; l’apparence exacte des regroupements/épinglages de la barre des tâches reste à confirmer en recette Windows. Le binaire reste `electron.exe` : son icône intégrée, les raccourcis installés et l’installateur seront traités lors du packaging J3.

## Téléchargements

Les téléchargements passent par le moteur Chromium de la session universitaire, avec son contexte d’authentification, son proxy et WFP. Les pièces jointes Mail/PARTAGE suivent la sortie publique autorisée ; les autres documents universitaires restent sous VPN. Aucun transfert n’est délégué à Node, curl ou une autre application. Une boîte « Enregistrer le fichier » propose un nom normalisé et laisse l’utilisateur choisir la destination, avec confirmation d’écrasement.

- HTTPS uniquement vers les domaines universitaires et RENATER admis ; toute la chaîne de redirections est contrôlée. Les exceptions vidéo ne donnent pas accès au téléchargement des flux externes.
- Les fichiers `blob:` générés par la page sont acceptés seulement si leur origine correspond à la page universitaire initiatrice.
- Une fenêtre de téléchargement doit appartenir à la session et le VPN doit être prêt. Les pièces jointes ouvertes dans une nouvelle fenêtre utilisent la destination explicitement admise par le contrôleur de fenêtres.
- Les pop-ups conservent le cycle natif Chromium : corps POST, fenêtre nommée et lien `window.opener`. Une fenêtre initialement `about:blank` peut être préparée par une page universitaire HTTPS ; ses navigations et transferts restent filtrés. Toutes ces fenêtres utilisent la même session, les mêmes menus et les mêmes protections, sans accès Node ni API exposée au site.
- Noms proposés sans séparateurs de chemin, caractères de contrôle, flux alternatifs, noms de périphériques Windows ni caractères de direction trompeurs. Le choix final du chemin reste celui de l’utilisateur.
- Progression dans la barre des tâches ; états et annulation dans Fichiers → Téléchargements. Historique récent en mémoire seulement.
- Fermeture de la fenêtre, blocage ou arrêt de la session : annulation des transferts actifs. Aucune reprise automatique hors tunnel, aucune ouverture/exécution automatique du fichier.

Les fichiers complètement enregistrés restent au chemin choisi après fermeture du pilote. Les fichiers partiels sont soumis au comportement d’annulation Chromium ; le pilote ne supprime pas arbitrairement les fichiers de l’utilisateur. Un fichier ouvert ensuite dans un logiciel tiers relève du réseau et des droits de ce logiciel.

Le diagnostic ne contient que les états `STARTED`, `COMPLETED`, `CANCELLED`, `INTERRUPTED` ou `REFUSED`, sans nom de fichier, chemin, URL ni contenu du document. Les noms sont visibles dans la boîte de suivi locale, pas dans les journaux MyNEIGE.

Les destinations hors politique, HTTP, `file:` et `data:` restent refusées. La gestion des services externes nécessiterait une révision explicite du périmètre.

## Consultation des PDF

Les réponses `application/pdf` proposées en consultation (`Content-Disposition: inline` ou sans téléchargement forcé) utilisent le lecteur PDF intégré à Chromium, dans la session universitaire existante, y compris en iframe et en pop-up POST. Les pièces jointes `attachment` conservent le parcours de téléchargement.

Le lecteur nécessite des ressources locales que le filtrage HTTPS/WSS universitaire bloquait : l'extension intégrée `mhjfbmdgcfjbbpaeojofohoefgiehjai` et certaines ressources `chrome://resources`. Le module `src/main/pdf-policy.js` autorise uniquement sa page initiale en sous-fenêtre d'un document universitaire, une liste exacte de scripts/styles provenant du lecteur, et la navigation de son propre sous-cadre vers un flux PDF à identifiant UUID. Les ressources exigent le contexte de frame et l'origine initiatrice du lecteur ; les informations absentes ou les frames détruites sont refusées.

Ces exceptions ne modifient pas `allowedURL`, les domaines réseau, le proxy, WFP, le sandbox, l'isolation du contexte ou l'accès Node. Elles ne permettent pas les navigations principales vers les pages internes, les autres extensions ou les destinations externes. Les ressources internes ne sont pas journalisées comme des domaines réseau. La liste correspond à Electron 45.0.0 ; toute évolution du lecteur doit être validée par les tests de consultation avant d'élargir cette liste.

## Avertissement de connexion

L’écran de connexion affiche « Version Alpha » et reprend le bleu `#182f9e` et la pervenche `#5d6dbb` du logo MyNEIGE. Les informations, l’état de la connexion, l’avertissement et les actions Windows Hello occupent la colonne de gauche ; la saisie manuelle et les précisions sur les identifiants occupent celle de droite. La fenêtre s’ouvre en 1 120 × 900 pixels et la page repasse sur une colonne lorsque sa largeur est inférieure ou égale à 860 pixels.

L’encadré « Une version alpha à utiliser avec discernement » indique le caractère expérimental et indépendant, l’utilisation aux risques de l’utilisateur, l’absence de garantie, et la déclinaison de responsabilité de l’auteur pour les comptes VPN/CAS, pertes/altérations/divulgations de données et inexactitudes affichées. Le texte réserve les limites de la loi applicable et les droits auxquels on ne peut renoncer.

Cette formulation exprime une information et une limitation souhaitée, sans prétendre garantir une exonération juridique absolue. Elle accompagne les sections 7 et 8 de la [licence Apache 2.0 du dépôt](../LICENSE), qui reste inchangée. Aucun écran d’acceptation ni case obligatoire n’a été ajouté.

## Vérifications

La correction PDF porte le total à 27 vérifications Chromium : les 22 précédentes, consultation directe avec `inline`, consultation sans `Content-Disposition`, iframe, pop-up POST, et refus des navigations principales hors politique. Le PDF de test contient désormais une vraie page ; les tests attendent le chargement réussi du lecteur et vérifient le nombre de pages, l'URL source et l'absence d'accès Node. Une capture locale facultative permet de contrôler visuellement le rendu. Quatre tests Node supplémentaires vérifient les exceptions internes et leurs refus (autres extensions, types de requête, contexte absent/détruit, origine initiatrice et journalisation).

```powershell
npm test
npm run test:cas
npm run test:browser
npm run browser:test  # Précontrôle complet avec WFP et UAC
```

Les tests Node contrôlent la provenance, les redirections, les noms, les fenêtres autorisées, la disponibilité du VPN, l’annulation et les destinations d’historique. Les douze vérifications Chromium utilisent les mêmes fenêtres, menus, gestionnaire et filtrage de requêtes que le pilote : précédent, suivant, accueil, fichier HTTPS enregistré et contenu comparé, conservation de la session et du magasin de cookies, boîte de suivi, fichier `blob` enregistré, annulation d’un transfert en cours ; formulaires POST vers une nouvelle fenêtre et une fenêtre nommée, fenêtre vide préparée par JavaScript, maintien de la session et de l’isolation du pop-up, refus des ouvertures hors politique. Les réponses réseau sont des fixtures locales sans compte étudiant ; le test choisit un chemin sous `.local/` pour éviter une boîte de dialogue interactive. Cette fixture vérifie le magasin de cookies conservé, pas leur transmission à un serveur distant.

L’extension Université/logo porte le total à 22 vérifications Chromium : les douze précédentes, lecture de l’icône depuis le chemin réel d’exécution, cinq destinations exactes dans le même WebContents/session sans nouvelle fenêtre, retour dans l’historique entre services, refus des commandes sans VPN y compris un clic déjà en attente, commande depuis un pop-up vers la fenêtre principale et refus après fermeture de celle-ci. Le test n’utilise aucun compte universitaire.

Le précontrôle WFP exécute aussi ces scénarios avec l’image Electron confinée et les ressources réellement copiées par le contrôleur natif. L’essai réel d’un fichier universitaire et de la boîte native de sauvegarde est suivi séparément dans [POC_STATUS.md](POC_STATUS.md).

Références : [Electron DownloadItem](https://www.electronjs.org/docs/latest/api/download-item), [NavigationHistory](https://www.electronjs.org/docs/latest/api/navigation-history), [création native des fenêtres](https://www.electronjs.org/docs/latest/api/web-contents#contentssetwindowopenhandlerhandler).
