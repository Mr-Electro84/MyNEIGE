# Distribution Alpha Windows

Statut : **GO reçu et implémentation réalisée** pour Windows 11 x64. Le profil VPN universitaire est embarqué à la demande du développeur. Le lanceur natif, le dossier autonome, le ZIP et l’installateur NSIS sont construits localement ; la publication reste une étape distincte.

## Construire et utiliser

```powershell
npm ci
npm run dist:win
npm run test:dist
```

Prérequis de construction : Windows x64, Node.js/npm, Visual Studio Build Tools C++/SDK Windows et NSIS (`makensis.exe` sur PATH ou installation standard). Pour une installation NSIS personnalisée : `powershell -NoProfile -File scripts/build-distribution.ps1 -NsisPath 'C:\chemin\makensis.exe'`. `npm run dist:dir` produit le dossier et le ZIP sans installateur. Les deux exécutables natifs utilisent le runtime MSVC statique (`/MT`), avec icône et ressources de version.

Sorties sous `dist` : dossier `MyNEIGE-1.0.0-alpha.1-win-x64`, archive `MyNEIGE-1.0.0-alpha.1-win-x64-portable.zip`, installateur `MyNEIGE-1.0.0-alpha.1-win-x64-setup.exe` et `MyNEIGE-1.0.0-alpha.1-win-x64-SHA256SUMS.txt`. Le paquet inclut un guide `LIRE-MOI.md` issu du [guide testeur](ALPHA_TESTER.md), les notices tierces et un manifeste SHA-256 par fichier. Il est actuellement **non signé**.

Le lanceur `MyNEIGE.exe`, à intégrité normale, utilise un seul Windows PowerShell 5.1 fourni avec Windows. Les empreintes du paquet sont vérifiées par le contrôleur natif ; la préparation OpenVPN s'exécute dans le même processus PowerShell, puis l'UAC démarre directement le contrôleur. Celui-ci écrit ses diagnostics dans un répertoire administratif protégé. Electron reste non administrateur ; ses binaires sont réutilisés depuis un cache protégé et reliés au staging propre à chaque session, avec les contrôles WFP existants. Aucun Node.js/npm ni compilation du programme chez le testeur. Les données utilisateur sont sous `%LOCALAPPDATA%\MyNEIGE`, les diagnostics administratifs sous `%PROGRAMDATA%\MyNEIGE-Logs`. Le ZIP conserve ces dépendances système et emplacements de données ; il ne s’agit pas d’une application sans traces. Voir [les corrections et mesures de démarrage](STARTUP_PERFORMANCE.md).

L’installateur utilise l’emplacement fixe protégé `%ProgramFiles%\MyNEIGE`, crée les raccourcis du menu Démarrer et une entrée de désinstallation. Il conserve OpenVPN et les données utilisateur ; un raccourci séparé propose leur suppression avec confirmation **avant** désinstallation. L’installateur et le lanceur se verrouillent mutuellement ; les sessions natives sont aussi réservées pendant la copie/suppression. La désinstallation récupère les seules protections MyNEIGE résiduelles et supprime une liste explicite de fichiers, sans suppression récursive du dossier d’installation.

La construction utilise **NSIS directement**, déjà installé sur le poste, et le runtime Electron épinglé. Aucun electron-builder n’est nécessaire pour ce premier format au lanceur natif. La proposition ci-dessous conserve les contraintes et choix qui ont guidé l’implémentation ; la recette sur VM propre reste à effectuer avant diffusion élargie.

## Vérifications locales

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

## Décision proposée

Le GO couvre le **dossier standalone, l’installateur NSIS Windows x64 et l’archive ZIP issue du même dossier**, avec profil embarqué. Le portable mono-fichier, les mises à jour automatiques et Linux restent différés. La publication et la diffusion aux testeurs sont des étapes distinctes.

## Références techniques

- [Electron — Distribution Overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview) : empaquetage des ressources et du runtime, signature et publication.
- [electron-builder v26 — Target Selection Guide](https://www.electron.build/v26/docs/targets/) : formats Windows et cas d’usage.
- [electron-builder — NSIS et portable](https://www.electron.build/docs/nsis/) : options d’installation et cible portable. Consulter la documentation correspondant à la version stable épinglée lors du GO.
- Contraintes du dépôt : [architecture Windows](ARCHITECTURE_WINDOWS.md), [plan de packaging](../PLAN.md), `BrowserPilot::prepare` dans `native/windows/poc/browser.cpp`, lancement dans `scripts/start-browser.ps1` et contrôle du coffre dans `native/windows/poc/vault.cpp`.
