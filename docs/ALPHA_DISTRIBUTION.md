# Distribution Alpha Windows

Les formats de distribution conservent des **binaires Windows 11 x64**, exécutables sous émulation sur Windows ARM64 (prise en charge expérimentale, recette ARM64 restante). Le lanceur et NSIS acceptent ces deux systèmes ; OpenVPN et TAP sont choisis selon l'architecture native du système. Voir le [guide ARM64](WINDOWS_ARM64.md). La diffusion publique est suspendue depuis le 29 octobre 2026 ; une construction locale ne vaut pas reprise de la publication. Aucun profil VPN ne doit être inclus dans les paquets. Les anciens résultats de recette ci-dessous concernent des paquets retirés et ne valident pas le profil personnel. Le lanceur natif, le dossier autonome, le ZIP et l’installateur NSIS sont construits localement ; la publication reste une étape distincte.

## Construire et utiliser

Ces commandes nécessitent un accord explicite préalable du mainteneur, conformément à [AGENTS.md](../AGENTS.md).

```powershell
npm ci
npm run dist:win
npm run test:dist
```

Prérequis de construction : Windows x64, Node.js/npm, Visual Studio Build Tools C++/SDK Windows et NSIS (`makensis.exe` sur PATH ou installation standard). Pour une installation NSIS personnalisée : `powershell -NoProfile -File scripts/build-distribution.ps1 -NsisPath 'C:\chemin\makensis.exe'`. `npm run dist:dir` produit le dossier et le ZIP sans installateur. Le lanceur, le contrôleur, le coffre et les relais natifs dédiés utilisent le runtime MSVC statique (`/MT`), avec icône et ressources de version. Le coffre `bin/myneige-vault.exe` et les deux relais `bin/myneige-relay.exe` et `bin/myneige-public-relay.exe` sont obligatoires dans les futurs manifestes ; ils ne peuvent être remplacés par des copies du contrôleur. Les sondes de développement ne sont pas distribuées. Voir [la séparation des relais et les validations locales](RELAY_EXECUTABLES.md).

Sorties sous `dist` : dossier `MyNEIGE-1.1.0-alpha.1-win-x64`, archive `MyNEIGE-1.1.0-alpha.1-win-x64-portable.zip`, installateur `MyNEIGE-1.1.0-alpha.1-win-x64-setup.exe` et `MyNEIGE-1.1.0-alpha.1-win-x64-SHA256SUMS.txt`. Le paquet inclut un guide `LIRE-MOI.md` issu du [guide testeur](ALPHA_TESTER.md), les notices tierces et un manifeste SHA-256 par fichier. Il est actuellement **non signé**.

Le suffixe `win-x64` et le manifeste `architecture: x64` restent exacts sur un hôte ARM64 : ils décrivent les binaires applicatifs émulés. La construction vérifie les architectures PE d'Electron et des exécutables MyNEIGE et inclut le helper obligatoire `scripts/windows-platform.ps1`. Aucun paquet n'a été reconstruit pour cette adaptation du 8 novembre 2026.

Le lanceur `MyNEIGE.exe`, à intégrité normale, utilise un seul Windows PowerShell 5.1 fourni avec Windows. Les empreintes du paquet sont vérifiées par le contrôleur natif ; la préparation OpenVPN s'exécute dans le même processus PowerShell, puis l'UAC démarre directement le contrôleur. Celui-ci écrit ses diagnostics dans un répertoire administratif protégé. Electron reste non administrateur ; ses binaires sont réutilisés depuis un cache protégé et reliés au staging propre à chaque session, avec les contrôles WFP existants. Aucun Node.js/npm ni compilation du programme chez le testeur. Les données utilisateur sont sous `%LOCALAPPDATA%\MyNEIGE`, les diagnostics administratifs sous `%PROGRAMDATA%\MyNEIGE-Logs`. Le ZIP conserve ces dépendances système et emplacements de données ; il ne s’agit pas d’une application sans traces. Voir [les corrections et mesures de démarrage](STARTUP_PERFORMANCE.md).

L’installateur utilise l’emplacement fixe protégé `%ProgramFiles%\MyNEIGE`, crée les raccourcis du menu Démarrer et une entrée de désinstallation. Il conserve OpenVPN et les données utilisateur ; un raccourci séparé propose leur suppression avec confirmation **avant** désinstallation. L’installateur et le lanceur se verrouillent mutuellement ; les sessions natives sont aussi réservées pendant la copie/suppression. La désinstallation récupère les seules protections MyNEIGE résiduelles et supprime une liste explicite de fichiers, sans suppression récursive du dossier d’installation.

La construction utilise **NSIS directement** et le runtime Electron épinglé. Aucun electron-builder n’est nécessaire. Les choix ci-dessous décrivent l’implémentation ; la recette sur VM propre reste à effectuer avant diffusion élargie.

## Construction 1.1.0-alpha.1 — 2 novembre 2026

Construction locale demandée explicitement par le mainteneur : version `1.1.0-alpha.1`, révision de livraison **3** dans `package.json` et dans le paquet. Les deux exécutables natifs et l’installateur portent cette version ; leur version numérique Windows est `1.1.0.1`. Electron reste épinglé à 45.0.0, sans changement de dépendances. Aucun profil VPN ni coffre personnel n’est inclus.

Vérifications locales réalisées pour cette version :

- Contrôleur et lanceur x64 compilés ; dossier autonome, ZIP portable et installateur NSIS produits avec la compression LZMA habituelle. Les deux empreintes du fichier `SHA256SUMS` et les ressources de version sont contrôlées.
- `npm test` réussi : 41 tests natifs, coffre DPAPI avec données fictives, inspection du profil synthétique, 4 contrôles du paquet fictif et 91 tests JavaScript.
- Les sept suites Electron passent : CAS (9 scénarios, aucune soumission automatique), profil personnel avec stockage simulé, navigateur (48 contrôles), téléchargements, Mail (7 contrôles sur boucle locale), renouvellement/expiration de session et mises à jour avec API simulée.
- 46 contrôles de préparation OpenVPN réussis, sans installation.
- `npm run test:dist` réussi : 35 contrôles du contenu livré, intégrité, métadonnées, architecture x64, absence de profil VPN et rejet de corruption.
- ZIP extrait dans un chemin avec espaces et accents : intégrité des 125 fichiers et métadonnées `version=1.1.0-alpha.1`, `revision=3` vérifiées. `MyNEIGE.exe --check` réussit avec Node.js/npm retirés du `PATH`, OpenVPN étant déjà prêt sur ce poste.

Le script de test du paquet fictif charge désormais explicitement le module Utility de l’interpréteur Windows PowerShell et évite de masquer le code de retour natif par une variable locale. Le bilan de `test:dist` et le texte d’accueil de l’installateur précisent l’absence de profil fourni et l’import du profil personnel. Ces corrections ne modifient pas le fonctionnement réseau de l’application.

Les tests Electron, DPAPI et la construction ont été exécutés hors du bac à sable après des erreurs propres à ce contexte. Aucun compte universitaire n’a été utilisé. Le lancement interactif `npm start`, les précontrôles WFP avec UAC, le VPN réel, les pertes VPN/relais, l’installation/remplacement/désinstallation et la recette sur Windows propre ne sont pas rejoués pour cette version. Ces scénarios restent à qualifier séparément ; les paquets sont non signés et aucune publication n’a été effectuée.

## Construction 1.0.2-alpha.1 — 28 octobre 2026

La version est `1.0.2-alpha.1`, avec la révision de livraison **2** dans `package.json`, recopiée dans le paquet pour le futur système de mise à jour. Les ressources des deux exécutables natifs portent cette version ; leur version numérique Windows est `1.0.2.1`. Electron reste épinglé à 45.0.0, sans changement de dépendances.

Vérifications locales réalisées pour cette version :

- Compilation du contrôleur et du lanceur x64 réussie.
- Dossier autonome, ZIP portable et installateur NSIS générés ; version de l'installateur et deux empreintes du fichier `SHA256SUMS` vérifiées.
- `npm test` réussi : 38 tests de protocole natif, coffre DPAPI avec données fictives, inspection du profil embarqué et 79 tests JavaScript.
- Tests Electron réussis : 9 cas CAS sans soumission automatique, 48 contrôles navigateur, 7 contrôles Mail sur boucle locale, fenêtre des téléchargements, renouvellement/expiration de session et mises à jour avec API simulée.
- 46 contrôles de préparation OpenVPN réussis, sans installation.
- `npm run test:dist` réussi : 35 contrôles du contenu livré, dont intégrité, métadonnées, architecture x64 et rejet de corruption.
- ZIP extrait dans un chemin avec espaces et accents : intégrité des 125 fichiers et métadonnées `version=1.0.2-alpha.1`, `revision=2` vérifiées. `MyNEIGE.exe --check` réussit avec Node.js/npm retirés du `PATH`, OpenVPN étant déjà prêt sur ce poste.

Electron et le test DPAPI ont nécessité une exécution hors du bac à sable. NSIS a également nécessité ce contexte après l'erreur de chargement de DLL système déjà observée pour la version précédente. Aucun compte universitaire n'a été utilisé. Les précontrôles WFP avec UAC, le lancement interactif `npm start`, le parcours VPN réel, l'installation/remplacement/désinstallation et la recette sur Windows propre ne sont pas rejoués pour cette construction. Ces validations restent distinctes des tests locaux ci-dessus ; les paquets restent non signés.

## Construction 1.0.1-alpha.1 — 25 octobre 2026

La version du paquet et les ressources des deux exécutables natifs sont passées à `1.0.1-alpha.1`. La construction utilise les sources présentes dans le dépôt et Electron 45.0.0, sans changement des dépendances.

Vérifications locales réalisées pour cette version :

- Compilation du contrôleur et du lanceur x64 réussie.
- Dossier autonome, ZIP portable et installateur NSIS générés ; version de l'installateur et empreintes du fichier `SHA256SUMS` vérifiées. NSIS a nécessité une exécution hors du bac à sable après une erreur de chargement de DLL système.
- 34 tests de protocole natif, test DPAPI avec données fictives et inspection du profil embarqué réussis, sans connexion universitaire.
- 49 tests JavaScript, 9 cas CAS sans soumission automatique, 39 contrôles navigateur et 7 contrôles Mail sur boucle locale réussis.
- 46 contrôles de préparation OpenVPN réussis, sans installation.
- 35 contrôles du paquet réussis : intégrité, version, architecture x64, contenu embarqué et rejet de corruption.
- ZIP extrait dans un chemin avec espaces et accents : les 110 fichiers passent le contrôle d'intégrité et `MyNEIGE.exe --check` réussit avec Node.js/npm retirés du `PATH` ; OpenVPN est détecté prêt sur ce poste.

Les tests Electron et DPAPI ont été exécutés hors du bac à sable après des échecs liés aux restrictions de cet environnement. Les précontrôles WFP avec UAC, le parcours avec VPN réel, l'installation/désinstallation et la recette sur Windows propre ne sont pas rejoués pour cette construction. Les résultats historiques ci-dessous ne constituent pas une validation de ces scénarios sur cette version.

## Vérifications locales de la première livraison

- 30 tests JavaScript et 27 tests de protocole natif réussis.
- 46 vérifications de préparation OpenVPN réussies : détection, refus, annulation, redémarrage et erreurs, sans installation d’OpenVPN pendant ces tests.
- 24 contrôles du contenu livré réussis : empreintes, profil embarqué, architecture, métadonnées, rejet de corruption et de chemins sortant du paquet.
- Précontrôle du paquet autonome réussi avec UAC : WFP IPv4/IPv6/UDP et enfants, sandbox, proxy authentifié, coffre, CAS, navigation, téléchargements et annulation. Aucun identifiant fourni, aucun VPN universitaire contacté.
- 18 contrôles de l’installateur final réussis : installation silencieuse, réinstallation, raccourcis français, refus pendant activité, désinstallation et conservation d’un fichier non installé. L’installation de recette a été retirée.
- ZIP final extrait dans un chemin avec espaces et accents : `MyNEIGE.exe --check` réussit avec Node.js/npm retirés du PATH. Les imports des exécutables natifs ne contiennent pas de dépendance au redistribuable MSVC.

Ces contrôles s’exécutent sur le poste de développement. Ils ne démontrent pas encore la recette sur un PC/une VM Windows propre, ni un nouveau parcours de connexion universitaire avec le paquet. Ces deux essais restent nécessaires pour élargir la diffusion de l’Alpha. Les binaires et l’installateur ne sont pas signés.

## Périmètre

Première livraison : **MyNEIGE 1.0.0-alpha.1 pour Windows 11 x64**. Les autres versions de Windows et architectures restent à qualifier. Le testeur n’installe ni Node.js, ni npm, ni Visual Studio. Electron embarque son moteur JavaScript et Chromium ; le lanceur et le contrôleur C++ sont compilés en code natif.

Le paquet contient l’interface, le runtime Electron épinglé, le contrôleur (dont une copie protégée sert d’auxiliaire de coffre), les icônes, le manifeste de version, LICENSE, les notices des dépendances et le profil VPN. Aucun identifiant, journal de développement ou contenu de `.local`, `state`, `.git` ou `tests` n’entre dans la livraison.

## Choix des formats

| Format | Intérêt pour l’Alpha | Contraintes propres à MyNEIGE |
| --- | --- | --- |
| Installateur NSIS `.exe` | **Format recommandé** : raccourcis, installation dans un emplacement protégé, désinstallation et remplacement de version maîtrisés. | Installation avec UAC ; arrêt de la session avant mise à jour ou désinstallation. |
| Archive ZIP avec lanceur `.exe` | Variante secondaire, simple à extraire et à remplacer pour un petit groupe de testeurs. | Élévation au lancement, staging protégé et OpenVPN/TAP toujours nécessaires ; données locales conservées sur le PC. |
| Exécutable portable auto-extractible | Un seul fichier à transmettre. | Extraction supplémentaire à chaque lancement, puis staging MyNEIGE ; mêmes prérequis et droits. À différer jusqu’à validation du ZIP. |

Un mode « portable » signifie ici que MyNEIGE ne nécessite pas son propre installateur. Il ne peut pas garantir un fonctionnement sans administrateur ou sans installation système : le contrôleur utilise WFP et un adaptateur TAP. OpenVPN Community reste un prérequis installé. Pour l’Alpha, conserver sa détection et son installation officielle avec vérification de signature et d’empreinte, déjà présentes. L’application est autonome vis-à-vis des outils de développement, mais le premier équipement en OpenVPN peut nécessiter Internet et un redémarrage.

## Choix d’implémentation

1. **Construire un dossier applicatif reproductible.** Sur Windows x64, installer les dépendances verrouillées avec `npm ci`, compiler les deux exécutables avec Visual Studio Build Tools et le SDK Windows, puis préparer Electron et les ressources. Le runtime MSVC est lié statiquement avec `/MT`. Les outils de construction ne sont pas livrés.
2. **Créer un vrai lanceur utilisateur.** Le `.exe` démarre sans élévation et orchestre les scripts Windows fournis pour vérifier OpenVPN, demander l’UAC au contrôleur et présenter les erreurs utiles. L’interface Electron et le navigateur restent à intégrité moyenne avec leur sandbox. L’entrée JavaScript attend toujours le canal du superviseur et la quarantaine réseau préalable.
3. **Distinguer fichiers installés et données modifiables.** `BrowserPilot::prepare` utilise `resources/runtime` dans le paquet et garde le chemin de développement en repli. Le chemin du runtime protégé reste identique pour les contrôles du coffre. Les scripts OpenVPN détectent le contrôleur livré et ne tentent aucune compilation. Le cache navigateur est placé dans le dossier du véritable utilisateur interactif, même si l’UAC utilise un autre compte administrateur. Le dossier d’installation ne reçoit pas `.local/browser-data`.
4. **Préserver le contrat de sécurité.** Préparer et contrôler les binaires dans un emplacement protégé avant leur lancement ; poser les filtres WFP sur les chemins réellement exécutés, y compris l’auxiliaire ; conserver les Jobs, les contrôles de filiation et le nettoyage après crash. Un renommage ou déplacement du runtime concerne aussi ces contrôles. Les métadonnées et LICENSE doivent rester accessibles après staging.
5. **Empaqueter avec NSIS personnalisé.** Le lanceur natif est le point d’entrée des raccourcis ; NSIS installe les composants dans l’emplacement protégé. Un dossier non archivé permet de vérifier le parcours complet. ASAR reste différé : le staging copie un arbre de fichiers ; les exécutables et le profil restent hors archive.
6. **Soigner la livraison.** Appliquer l’icône et les ressources de version aux exécutables et raccourcis ; inclure les licences tierces ; produire une empreinte SHA-256 et des notes de version. Prévoir la signature Authenticode des exécutables et de l’installateur. Si l’Alpha privée est distribuée sans signature, documenter cet état sans promettre l’absence d’alertes Windows. Mises à jour manuelles pour cette première Alpha.
7. **Définir la désinstallation.** Le lanceur, l’installation et la session native doivent être arrêtés avant suppression des fichiers. Le nettoyage récupère uniquement les ressources appartenant à MyNEIGE. Un raccourci et l’option `--reset-user-data` proposent la suppression des données du compte et du coffre avec confirmation ; la désinstallation les conserve par défaut. OpenVPN et les VPN tiers sont conservés.

## Recette avant remise aux testeurs

Utiliser une VM Windows propre sans Node.js, npm ni Build Tools, avec un compte utilisateur standard et une élévation autorisée. Vérifier installation, premier démarrage avec/sans OpenVPN, refus UAC, annulation d’installation et redémarrage requis. Tester également un chemin contenant espaces et accents et une seconde installation par-dessus l’Alpha précédente.

Rejouer les précontrôles IPv4/IPv6/UDP, enfants, sandbox et proxy sur les **binaires livrés**. Vérifier connexion réelle, CAS, navigation, PDF, téléchargements, coffre et « À propos ». Rejouer perte du VPN, crash et récupération, fermeture et désinstallation ; contrôler qu’aucune sortie directe n’est possible pendant ces transitions. Les tests locaux du dépôt ne remplacent pas cette recette du paquet.

Pour le ZIP, ajouter extraction dans un répertoire utilisateur, relocalisation entre deux sessions et lancement sur une seconde machine équipée des prérequis. Les identifiants DPAPI et Windows Hello restent propres au compte et à la machine ; ils ne doivent pas être présentés comme transportables.

## Formats disponibles et limites

Le [signalement des mises à jour](UPDATES.md) par API est préparé, avec révision dans `package.json` et toast, mais temporairement désactivé en attendant un hébergement compatible. Le menu Aide affiche l’annonce de la fonctionnalité à venir et un lien vers le site. L’installation reste manuelle. Le nouvel installateur exécute d’abord le désinstalleur précédent, puis copie la nouvelle version ; le désinstalleur précédent nettoie les fichiers de son inventaire. La recette de ce parcours nécessite deux paquets et reste distincte des résultats historiques ci-dessus.

La construction produit le **dossier standalone, l’installateur NSIS Windows x64 et l’archive ZIP issue du même dossier**, sans profil embarqué. Le portable mono-fichier, les mises à jour automatiques et Linux ne sont pas pris en charge. La publication et la diffusion aux testeurs sont des étapes distinctes.

## Références techniques

- [Electron — Distribution Overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview) : empaquetage des ressources et du runtime, signature et publication.
- Contraintes du dépôt : [architecture Windows](ARCHITECTURE_WINDOWS.md), [guide de développement](DEVELOPMENT.md), `BrowserPilot::prepare` dans `native/windows/poc/browser.cpp`, lancement dans `scripts/start-browser.ps1` et contrôle du coffre dans `native/windows/poc/vault.cpp`.
