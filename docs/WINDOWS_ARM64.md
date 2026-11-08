# Windows ARM64 avec émulation x64

Le code prend en charge le lancement de MyNEIGE x64 sur Windows 11 ARM64 grâce à l'émulation fournie par Windows. Cette combinaison reste **expérimentale, à qualifier sur un poste ARM64**. Aucun essai réel ARM64 ni aucune validation de son isolation réseau ne sont encore consignés ici.

| Système hôte | MyNEIGE, Electron, coffre et relais | OpenVPN Community, tapctl et pilote TAP |
| --- | --- | --- |
| Windows 11 x64 Intel/AMD | x64 natif | AMD64 |
| Windows 11 ARM64 | x64 sous émulation | ARM64 natif |

Il ne s'agit pas d'une distribution native ARM64. Le nom `win-x64` et le champ `architecture: x64` du manifeste décrivent toujours les exécutables MyNEIGE. Les anciennes distributions doivent être reconstruites pour intégrer ces changements ; installer OpenVPN ARM64 ne supprime pas leurs anciens blocages.

## Préparation d'OpenVPN

Le lanceur et la préparation utilisent `IsWow64Process2` pour identifier le système natif, indépendamment de l'architecture du processus PowerShell et de ses variables d'environnement. Les chemins système utilisent `Sysnative` lorsqu'il est accessible pour éviter la redirection d'un interpréteur 32 bits. La recherche et la réparation d'OpenVPN consultent explicitement les vues 64 et 32 bits du registre.

Sur ARM64, les exécutables OpenVPN et `tapctl` doivent être ARM64. Un moteur d'une autre architecture est signalé comme incompatible, sans remplacement automatique. Les contrôles de signature, d'éditeur et de version du contrôleur restent obligatoires. Le pilote TAP doit être disponible dans le magasin de pilotes Windows ; aucun adaptateur n'est créé pendant cette vérification.

L'installation proposée après accord utilise les références suivantes, depuis `https://swupdate.openvpn.net/community/releases/`, sans redirection :

| Hôte | MSI épinglé | SHA-256 |
| --- | --- | --- |
| x64 | `OpenVPN-2.7.8-I001-amd64.msi` | `1EA61A3056905B90607D4B0F084C04E5CF3043E07CF192D9CD44B0474F29CC49` |
| ARM64 | `OpenVPN-2.7.8-I001-arm64.msi` | `6FC0E8899CC5275EE297FB837BC84AA2BC49F8EF96D7AD93EE3FEE1E7163A25C` |

L'empreinte et la signature Authenticode de l'éditeur OpenVPN Inc. sont vérifiées avant le lancement du MSI et de nouveau sur sa copie protégée. Les fonctionnalités `OpenVPN,Drivers,Drivers.TAPWindows6` sont sélectionnées ; OpenVPN Connect, Wintun ou DCO seuls ne remplacent pas TAP. L'UAC, l'annulation, le redémarrage requis et la vérification finale conservent le même parcours que sur x64.

Le 8 novembre 2026, le MSI ARM64 a été téléchargé depuis la source officielle : son empreinte ci-dessus et sa signature Authenticode valide ont été vérifiées. La lecture de sa base MSI confirme la plateforme `Arm64` et les fonctionnalités OpenVPN et TAP attendues. **Le MSI n'a pas été exécuté.**

Références : [émulation Windows](https://learn.microsoft.com/en-us/windows/arm/overview), [architecture native des pilotes](https://learn.microsoft.com/en-us/windows/arm/faq), [IsWow64Process2](https://learn.microsoft.com/en-us/windows/win32/api/wow64apiset/nf-wow64apiset-iswow64process2) et [archives officielles OpenVPN](https://build.openvpn.net/downloads/releases/).

## Développement et construction

La construction conserve la cible MSVC x64 et le runtime Electron x64. La préparation des binaires sur un poste x64 reste le parcours de référence ; la compilation depuis un poste ARM64 n'est pas qualifiée.

Depuis les sources, utiliser Node.js x64 ou sélectionner explicitement Electron x64 avant l'installation des dépendances, notamment avec Node.js ARM64 :

```powershell
$env:ELECTRON_INSTALL_ARCH = 'x64'
npm ci
npm run poc:build
npm start
```

Le lancement de développement et la construction des distributions refusent un runtime Electron d'une autre architecture. Le contrôle de construction vérifie également que les composants natifs MyNEIGE restent x64. Les dépendances SSH et terminal utilisent leur chemin JavaScript ; les accélérateurs `.node` ne sont pas copiés dans le runtime applicatif.

Une construction standalone, ZIP ou installateur nécessite toujours l'accord explicite préalable du développeur, conformément à [AGENTS.md](../AGENTS.md).

## Tests et recette ARM64

Tests de développement, sans compte universitaire ni installation :

```powershell
npm test
powershell -NoProfile -File scripts/test-windows-platform.ps1
powershell -NoProfile -File scripts/test-openvpn-setup.ps1
```

Le premier test ciblé exerce la détection native réelle, les décisions x64/ARM64 et le refus de Windows 10/x86, la lecture d'en-têtes PE synthétiques et malformés, le choix des références MSI et le maintien d'Electron x64. Le second simule les parcours d'installation ARM64, l'annulation, le redémarrage et l'échec du contrôle final, sans lancer de MSI. `-Arm64Package <chemin>` permet de vérifier un MSI ARM64 déjà téléchargé et son refus comme paquet AMD64. Ces simulations ne constituent pas une exécution sous émulation ARM64.

Sur un poste Windows 11 ARM64, effectuer ensuite la recette :

1. Vérifier le diagnostic `architecture_hote=Arm64` depuis le lanceur, y compris si PowerShell est émulé. Tester une installation OpenVPN absente, son annulation, son installation consentie et sa reconnaissance au lancement suivant.
2. Vérifier que le moteur et `tapctl` sont ARM64, que le TAP dédié est créé puis retiré, et qu'un OpenVPN x64 préexistant produit une erreur explicite.
3. Lancer `npm start`, importer un profil personnel et vérifier la saisie manuelle, Windows Hello facultatif et le préremplissage CAS sans soumission automatique.
4. Exécuter les précontrôles WFP et les tests navigateur/SSH adaptés, puis une connexion VPN réelle. Contrôler par capture le DNS et le web protégés, le terminal pédagogique, les exceptions publiques et l'absence de repli direct après perte du VPN, d'un relais ou du contrôleur.
5. Vérifier que les autres applications conservent leurs routes et leur DNS habituels, puis qualifier la fermeture, la récupération après incident, la veille et les changements de réseau.

Consigner séparément les résultats des tests automatisés, du lancement local et de la recette VPN ARM64. Aucun paquet distribuable n'a été construit pour cette adaptation.

## Validation locale du 8 novembre 2026

Sur le poste Windows x64 :

- `npm test` réussi : compilation des composants natifs x64, séparation des relais, 42 tests natifs, coffre DPAPI et profil synthétiques, 11 contrôles de manifeste fictif et 114 tests JavaScript. La suite inclut les tests de plateforme et de préparation OpenVPN.
- 31 contrôles de plateforme réussis depuis Windows PowerShell 5.1 64 bits, puis depuis son interpréteur 32 bits. Les scénarios ARM64 utilisent des décisions et en-têtes PE fictifs ; l'hôte réel demeure x64.
- Tests de préparation OpenVPN réussis, y compris les scénarios ARM64 simulés et la vérification du vrai MSI ARM64 sans installation. Le nombre de contrôles varie selon la présence du pilote TAP et d'un MSI déjà en cache.
- Diagnostics réels 64 et 32 bits : état `Ready`, même moteur signé et même fichier INF TAP. Un défaut de packing du contrôle SetupAPI a été corrigé selon `setupapi.h` : pack(1) dans un processus 32 bits, pack(8) dans un processus 64 bits.
- Prétraitement NSIS `/PPO` réussi : développement des conditions AMD64/ARM64, sans génération d'exécutable ou de distribution.
- `npm start` vérifié jusqu'au formulaire local, champs d'identifiants vides, puis fermeture normale avec code 0. Aucun déverrouillage Hello, aucune saisie d'identifiants et aucune connexion VPN pendant cet essai.

La recette sur Windows ARM64, l'installation effective de son MSI et les captures prouvant l'isolation réseau restent à effectuer.
