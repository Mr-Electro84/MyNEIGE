# Développer et vérifier MyNEIGE

Ce guide complète le [README](../README.md), qui décrit l’état actuel du projet et le démarrage depuis les sources. Il rassemble les commandes avancées et les points d’entrée techniques auparavant présents dans le README.

## Préparer le poste de développement

La cible actuelle est Windows 11 x64. Installer Node.js/npm et Visual Studio 2022 ou les Build Tools avec les outils C++ x64/x86 et le SDK Windows 10/11. Le script de compilation détecte Visual Studio avec `vswhere`, initialise son environnement x64 et compile le contrôleur en C++20. Aucune dépendance C++ externe ni restauration NuGet n’est nécessaire.

Depuis la racine du dépôt :

```powershell
npm ci
npm run poc:build
npm start
```

Electron est épinglé par `package.json` et `package-lock.json` ; utiliser `npm ci` pour conserver les versions verrouillées. Le contrôleur compilé est `.local/poc/myneige-poc.exe`, exclu de Git. Après une modification native, relancer `npm run poc:build` avant `npm start`.

Le lancement s’effectue depuis un terminal non administrateur. L’UAC élève le contrôleur ; le formulaire, le navigateur et les relais restent à intégrité moyenne. Le lancement et les tests privilégiés préparent des ressources réseau et des répertoires protégés : consulter [l’architecture Windows](ARCHITECTURE_WINDOWS.md) avant de modifier ce parcours.

Les commandes disponibles et leur implémentation font référence dans [package.json](../package.json) et `scripts/`.

## Choisir les tests

### Tests de base sans VPN universitaire

```powershell
npm test
npm run poc:inspect
```

`npm test` recompile le contrôleur, exécute les tests de protocole natif, le test DPAPI avec des données fictives, l’inspection du profil fourni et les tests Node. Il ne démarre pas de VPN universitaire et ne nécessite pas d’identifiants réels. Le test DPAPI utilise néanmoins la protection Windows du compte local.

`npm run poc:inspect` lit le profil et les paramètres réseau sans démarrer OpenVPN ni installer de règle. Conserver intact le fichier source `VPN_Universite_Avignon.ovpn` ; le profil d’exécution est reconstruit depuis les directives admises.

### Tests JavaScript et navigateur ciblés

Après `npm ci`, ces commandes utilisent les tests locaux et leurs données fictives, sans compte universitaire :

| Commande | Périmètre |
| --- | --- |
| `npm run test:js` | Tests Node des politiques, de l’IPC, de la navigation et des diagnostics. |
| `npm run test:cas` | Préremplissage CAS dans Electron. |
| `npm run test:browser` | Navigation, téléchargements, PDF et contenus intégrés dans Electron. |
| `npm run test:mail` | Parcours SSO Mail/PARTAGE avec réponses TLS locales, sans authentification réelle. |

Ces scénarios ciblés ne remplacent pas un test sous confinement WFP ni une recette réseau réelle. La confiance TLS particulière de la fixture Mail reste limitée à la session de test et n’est pas installée dans Windows.

### Précontrôles avec UAC

Compiler le contrôleur avant ces commandes :

```powershell
npm run browser:test
npm run poc:wfp-test
```

`browser:test` vérifie localement le confinement IPv4/IPv6/UDP, les processus enfants, la sandbox, le proxy authentifié et les scénarios du navigateur. Il ne contacte pas le VPN universitaire et ne soumet pas d’identifiants. `poc:wfp-test` teste le filtrage Windows. La commande explicite équivalente est :

```powershell
powershell -NoProfile -File scripts/test-wfp.ps1 -Elevate
```

Les procédures et les limites de ces contrôles figurent dans le [guide du pilote réseau](POC_WINDOWS.md).

### Sortie publique réelle, sans VPN

```powershell
npm run test:public
```

Ce test nécessite UAC et Internet. Il émet deux requêtes HEAD sans compte vers PARTAGE et l’API YouTube, via le relais public natif confiné, avec vérification TLS. Il ne démarre pas OpenVPN et ne suit pas les redirections. Voir les [règles de routage et de contenu](EMBEDDED_CONTENT.md).

## Recette avec un compte universitaire

Pour le parcours complet, utiliser `npm start`. OpenVPN Community signé et son pilote compatible sont nécessaires ; le lanceur propose leur préparation lorsqu’ils manquent. Ne pas substituer OpenVPN Connect au moteur Community attendu.

Pour lancer uniquement la préparation/installation OpenVPN :

```powershell
npm run openvpn:install
```

Cette commande peut télécharger puis installer OpenVPN avec UAC. Une installation incomplète après désinstallation peut également déclencher la proposition de réparation au lancement. Les erreurs et diagnostics de préparation sont détaillés dans le [guide OpenVPN et identifiants](J2_CREDENTIALS_SETUP.md).

Pour le mode console de l’essai réseau :

```powershell
npm run poc:live
```

La console interactive demande les identifiants localement. Ne jamais fournir de mot de passe dans le chat, les arguments de commande ou un journal. Pour les captures et les scénarios de perte de route, VPN, relais ou contrôleur, suivre le [guide réseau](POC_WINDOWS.md) et le [rapport de validation](POC_STATUS.md).

## Repères d’implémentation

| Sujet | Documentation |
| --- | --- |
| Contrôleur C++/Win32, relais CONNECT/DNS, privilèges, WFP et arrêt après crash | [Architecture Windows](ARCHITECTURE_WINDOWS.md) et [pilote réseau](POC_WINDOWS.md). |
| Préremplissage CAS à usage unique, contrôle de la page cible et expiration après trois minutes | [Préremplissage CAS](CAS_PREFILL.md). La validation du formulaire reste manuelle. |
| Menus Navigation et Université, téléchargements, PDF et avertissement de connexion | [Navigation et téléchargements](J2_NAVIGATION_DOWNLOADS.md). |
| Mail/PARTAGE, RENATER, Nextcloud, lecteurs YouTube/H5P et exceptions de routage | [Contenus intégrés et messagerie](EMBEDDED_CONTENT.md). |
| Retour d’authentification PARTAGE : diagnostics sans données d’authentification et reprise HTTPS unique du parcours reconnu | [Retour d’authentification PARTAGE](EMBEDDED_CONTENT.md#retour-dauthentification-partage). |
| Enregistrement facultatif DPAPI, vérification Windows Hello et préparation d’OpenVPN | [Identifiants et OpenVPN](J2_CREDENTIALS_SETUP.md). |
| Cache Electron protégé, vérification native des empreintes et réduction des processus PowerShell au démarrage | [Performances de démarrage](STARTUP_PERFORMANCE.md). Les chemins de session WFP restent distincts. |
| Icônes des fenêtres, pop-ups, exécutables et raccourcis | [Ressources graphiques](J2_NAVIGATION_DOWNLOADS.md#icône-electron) et [distribution](ALPHA_DISTRIBUTION.md). |

Le menu **Navigation** propose Précédent, Suivant et Accueil APPIGS. **Fichiers → Téléchargements** (`Ctrl+J`) affiche le suivi et l’annulation ; les fichiers ne sont jamais ouverts automatiquement. Le menu **Université** conserve la fenêtre principale et sa session, sans garantir une authentification automatique auprès de chaque service.

Les services protégés, dont Nextcloud et les pages d’authentification universitaires, restent sous VPN. Mail/PARTAGE, RENATER et les lecteurs externes autorisés suivent une politique explicite de sortie sur le réseau habituel. Les échecs n’autorisent aucun repli d’une voie sur l’autre. Les lecteurs YouTube intégrés ne donnent pas accès à la navigation principale ni aux pop-ups externes YouTube.

Les identifiants peuvent être supprimés depuis l’interface sans déverrouillage Hello ou, lorsque l’application est fermée, avec :

```powershell
npm run credentials:forget
```

## Diagnostics de développement

Pour un lancement depuis les sources, les diagnostics du lanceur se trouvent dans `.local/browser/`, notamment `openvpn-preparation.txt`, `live-session.txt` et `exit-code.txt`. Le contrôleur conserve aussi des journaux de session protégés sous `%PROGRAMDATA%\MyNEIGE-Logs`. Le mode console utilise `.local/poc/`. Les emplacements et procédures de diagnostic des paquets distribués figurent dans le [guide utilisateur](ALPHA_TESTER.md).

Les diagnostics évitent les mots de passe et les données d’authentification, mais peuvent contenir des adresses réseau. Relire et nettoyer tout extrait avant de le partager ; ne pas publier de capture brute d’authentification.

## Résultats et limites de validation

Des essais réels ont couvert le VPN, le DNS UDP/TCP du tunnel, une réponse HTTPS APPIGS `302`, des pertes de route/VPN/relais et un crash du contrôleur. Le préremplissage CAS et l’accès APPIGS après clic manuel ont également été confirmés. Les scénarios exécutés et ceux restant ouverts sont consignés dans le [rapport réseau](POC_STATUS.md).

La recette de développement du 25 octobre 2026 a confirmé le premier accès à Mail/PARTAGE après l’IdP réel et la reprise HTTPS unique du parcours reconnu. Les résultats, y compris ceux des lecteurs intégrés et de la sortie publique, sont suivis dans la [documentation des contenus intégrés](EMBEDDED_CONTENT.md).

Distinguer systématiquement compilation, tests de protocole, fixtures navigateur, précontrôles WFP et recettes réelles. Une réussite locale ne prouve pas l’isolation complète sur tous les environnements et ne valide pas un paquet construit antérieurement. Les limites de qualification des distributions sont précisées dans le [guide de distribution](ALPHA_DISTRIBUTION.md).

Les anciens jalons J1/J2/J3 et `PLAN.md` conservent du contexte historique ; certaines mentions de fonctionnalités différées sont dépassées. Le README prime pour l’état actuel. Les études de faisabilité, notamment [celle des identifiants et d’OpenVPN](J2_CREDENTIALS_OPENVPN_FEASIBILITY.md), décrivent des propositions historiques et ne remplacent pas les guides d’implémentation.

## Distributions et site de présentation

La construction d’un standalone ou d’un paquet distribuable exige l’accord explicite préalable du mainteneur, conformément à [AGENTS.md](../AGENTS.md). Les commandes `npm run dist:win` et `npm run dist:dir` ne font pas partie des vérifications ordinaires en développement.

Après accord, le [guide de distribution](ALPHA_DISTRIBUTION.md) décrit les prérequis C++/SDK/NSIS, le dossier autonome, le ZIP portable, l’installateur et les empreintes SHA-256 générés dans `dist/`. Le profil VPN est embarqué pour cette Alpha et les paquets sont actuellement non signés. `npm run test:dist` vérifie le contenu livré ; la recette du paquet reste distincte de celle des sources.

Le site se trouve dans `website/`, avec une feuille CSS séparée et sans dépendance externe. Son [guide](../website/README.md) décrit la prévisualisation, la préparation des liens et l’hébergement. Les paquets ne sont pas versionnés avec le site : un clone ne contient pas ses téléchargements.
