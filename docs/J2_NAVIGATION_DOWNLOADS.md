# J2 — navigation, téléchargements et avertissement

Extension du pilote Windows autorisée le 23 octobre 2026. Aucun packaging ajouté.

## Navigation

Chaque fenêtre universitaire dispose d’un menu natif Windows :

| Commande | Raccourci | Fonction |
| --- | --- | --- |
| Navigation → Précédent | Alt + gauche | Revient à une entrée admise de l’historique de cette fenêtre. |
| Navigation → Suivant | Alt + droite | Avance dans cet historique. |
| Navigation → Accueil APPIGS | Alt + début | Ouvre l’adresse APPIGS initiale dans la même session. |
| Fichiers → Téléchargements | Ctrl + J | Affiche les états récents et permet d’annuler les transferts en cours. |

Précédent/suivant sont désactivés lorsqu’aucune entrée correspondante n’est disponible ou admise. Les contrôles de domaines et le proxy restent ceux de la session ; aucun navigateur externe n’est ouvert. L’accueil conserve les cookies de la session. Le préremplissage CAS reste à usage unique : revenir à une page de connexion ne redélivre pas les identifiants.

## Téléchargements

Les téléchargements passent par le moteur Chromium de la session universitaire, avec son contexte d’authentification, son proxy et WFP. Aucun transfert n’est délégué à Node, curl ou une autre application. Une boîte « Enregistrer le fichier » propose un nom normalisé et laisse l’utilisateur choisir la destination, avec confirmation d’écrasement.

- HTTPS uniquement vers les domaines universitaires déjà admis ; toute la chaîne de redirections est contrôlée.
- Les fichiers `blob:` générés par la page sont acceptés seulement si leur origine correspond à la page universitaire initiatrice.
- Une fenêtre de téléchargement doit appartenir à la session et le VPN doit être prêt. Les pièces jointes ouvertes dans une nouvelle fenêtre utilisent la destination explicitement admise par le contrôleur de fenêtres.
- Les pop-ups conservent le cycle natif Chromium : corps POST, fenêtre nommée et lien `window.opener`. Une fenêtre initialement `about:blank` peut être préparée par une page universitaire HTTPS ; ses navigations et transferts restent filtrés. Toutes ces fenêtres utilisent la même session, les mêmes menus et les mêmes protections, sans accès Node ni API exposée au site.
- Noms proposés sans séparateurs de chemin, caractères de contrôle, flux alternatifs, noms de périphériques Windows ni caractères de direction trompeurs. Le choix final du chemin reste celui de l’utilisateur.
- Progression dans la barre des tâches ; états et annulation dans Fichiers → Téléchargements. Historique récent en mémoire seulement.
- Fermeture de la fenêtre, blocage ou arrêt de la session : annulation des transferts actifs. Aucune reprise automatique hors tunnel, aucune ouverture/exécution automatique du fichier.

Les fichiers complètement enregistrés restent au chemin choisi après fermeture du pilote. Les fichiers partiels sont soumis au comportement d’annulation Chromium ; le pilote ne supprime pas arbitrairement les fichiers de l’utilisateur. Un fichier ouvert ensuite dans un logiciel tiers relève du réseau et des droits de ce logiciel.

Le diagnostic ne contient que les états `STARTED`, `COMPLETED`, `CANCELLED`, `INTERRUPTED` ou `REFUSED`, sans nom de fichier, chemin, URL ni contenu du document. Les noms sont visibles dans la boîte de suivi locale, pas dans les journaux MyNEIGE.

Les destinations hors politique, HTTP, `file:` et `data:` restent refusées. La gestion des services externes nécessiterait une révision explicite du périmètre.

## Avertissement de connexion

L’écran affiche, avant les champs, un encadré « Un pilote à utiliser avec discernement ». Il indique le caractère expérimental et indépendant, l’utilisation aux risques de l’utilisateur, l’absence de garantie, et la déclinaison de responsabilité de l’auteur pour les comptes VPN/CAS, pertes/altérations/divulgations de données et inexactitudes affichées. Le texte réserve les limites de la loi applicable et les droits auxquels on ne peut renoncer.

Cette formulation exprime une information et une limitation souhaitée, sans prétendre garantir une exonération juridique absolue. Elle accompagne les sections 7 et 8 de la [licence Apache 2.0 du dépôt](../LICENSE), qui reste inchangée. Aucun écran d’acceptation ni case obligatoire n’a été ajouté.

## Vérifications

```powershell
npm test
npm run test:cas
npm run test:browser
npm run browser:test  # Précontrôle complet avec WFP et UAC
```

Les tests Node contrôlent la provenance, les redirections, les noms, les fenêtres autorisées, la disponibilité du VPN, l’annulation et les destinations d’historique. Les douze vérifications Chromium utilisent les mêmes fenêtres, menus, gestionnaire et filtrage de requêtes que le pilote : précédent, suivant, accueil, fichier HTTPS enregistré et contenu comparé, conservation de la session et du magasin de cookies, boîte de suivi, fichier `blob` enregistré, annulation d’un transfert en cours ; formulaires POST vers une nouvelle fenêtre et une fenêtre nommée, fenêtre vide préparée par JavaScript, maintien de la session et de l’isolation du pop-up, refus des ouvertures hors politique. Les réponses réseau sont des fixtures locales sans compte étudiant ; le test choisit un chemin sous `.local/` pour éviter une boîte de dialogue interactive. Cette fixture vérifie le magasin de cookies conservé, pas leur transmission à un serveur distant.

Le précontrôle WFP exécute aussi ces scénarios avec l’image Electron confinée. L’essai réel d’un fichier universitaire et de la boîte native de sauvegarde est suivi séparément dans [POC_STATUS.md](POC_STATUS.md).

Références : [Electron DownloadItem](https://www.electronjs.org/docs/latest/api/download-item), [NavigationHistory](https://www.electronjs.org/docs/latest/api/navigation-history), [création native des fenêtres](https://www.electronjs.org/docs/latest/api/web-contents#contentssetwindowopenhandlerhandler).
