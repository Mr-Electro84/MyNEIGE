# MyNEIGE - Votre université, simplement

MyNEIGE rassemble les services de l’Université d’Avignon dans une application Windows : **APPIGS, ENT, Moodle, emploi du temps, Mail, Nextcloud, annuaire et gestionnaire de projets**.

L’application démarre le VPN universitaire et facilite la connexion aux services depuis une même fenêtre. Vos autres applications continuent d’utiliser leur connexion Internet habituelle.

**Version actuelle : 1.0.2-alpha.1 · Windows 11 x64 (Intel / AMD) · Licence Apache 2.0**

## Ce que propose MyNEIGE

- **Une seule saisie pour démarrer** : vos identifiants servent à ouvrir le VPN, puis à préremplir la page de connexion universitaire pour APPIGS. Vous gardez la main sur le clic « SE CONNECTER ».
- **Vos services réunis** : le menu Université permet de passer d’un service à l’autre dans la même session.
- **Windows Hello, si vous le souhaitez** : enregistrez vos identifiants, chiffrés localement par Windows, puis réutilisez-les après vérification par Windows Hello. La saisie manuelle reste disponible et l’enregistrement peut être supprimé à tout moment.
- **Une navigation pratique** : précédent, suivant, retour à APPIGS, consultation des PDF et téléchargements avec choix de destination. La fenêtre **Fichiers → Téléchargements** (`Ctrl+J`) affiche le nom, le poids, la date et la progression, avec ouverture du fichier, localisation dans son dossier et annulation des transferts en cours.
- **Les liens externes dans votre navigateur** : les liens HTTP/HTTPS vers les domaines hors de la liste de navigation MyNEIGE s’ouvrent dans votre navigateur par défaut, avec sa connexion et sa session habituelles.
- **Les contenus de cours intégrés** : prise en charge des lecteurs YouTube autorisés, y compris dans les activités H5P.
- **La vérification des mises à jour est à venir** : **Aide → Vérifier les mises à jour** affiche une annonce avec un bouton **Voir le site web**, pour consulter les versions proposées sur le site MyNEIGE. L’installation reste manuelle ; le nouvel installateur désinstalle d’abord la version précédente. Voir le [fonctionnement des mises à jour](docs/UPDATES.md).

### Comment fonctionne le VPN ?

Les services protégés et les pages d’authentification universitaires passent par le VPN. Mail/PARTAGE, RENATER et les lecteurs externes autorisés utilisent la connexion Internet habituelle. Ces exceptions sont définies explicitement : un service protégé ne bascule jamais vers une connexion directe après un échec du VPN.

MyNEIGE préserve le routage et le DNS des autres applications, sans modifier le proxy système ni les routes par défaut de votre connexion physique.

## Utiliser l’application

Il vous faut **Windows 11 x64**, une connexion Internet, un compte universitaire disposant des droits d’accès nécessaires et la possibilité d’accepter une demande de droits administrateur Windows (UAC).

Si vous disposez d’un paquet MyNEIGE fourni par le développeur :

1. Installez la version `.exe`, ou extrayez **tout** le ZIP portable dans un dossier local et ouvrez `MyNEIGE.exe`.
2. Lancez l’application normalement. Si OpenVPN Community manque, MyNEIGE propose son installation et vous demande votre accord.
3. Saisissez vos identifiants universitaires, ou réutilisez ceux enregistrés avec Windows Hello.
4. Une fois le VPN prêt, confirmez la connexion sur la page universitaire préremplie, puis utilisez le menu Université.

Les paquets prêts à l’emploi ne nécessitent ni Node.js ni outils de compilation. Ils ne sont pas inclus dans un clone du dépôt. Le [site de présentation](https://my-neige.42web.io/) présente les formats proposés ; ses liens de téléchargement nécessitent un hébergement avec les paquets correspondants.

Consultez le [guide d’utilisation de l’Alpha](docs/ALPHA_TESTER.md) pour l’installation, les diagnostics, les mises à jour et la désinstallation.

### Limites de cette Alpha

- Les sessions durent **deux heures**, renouvelables depuis l’avertissement affiché cinq minutes avant la fin. Sans prolongation, les pages et le VPN sont fermés ; un écran local explique la fin de session. Fermer le formulaire MyNEIGE termine aussi la session.
- Les paquets actuels sont **non signés** et peuvent déclencher une alerte de provenance Windows. Les mises à jour sont manuelles.
- La compatibilité avec la veille, les changements de réseau et les autres VPN reste à qualifier. La validation sur un PC ou une VM Windows propre reste à compléter avant une diffusion élargie.
- Aucune version macOS, Linux ou Windows ARM n’est proposée actuellement.

Le code de développement peut contenir des améliorations absentes d’un paquet déjà construit. Les résultats et les limites des essais sont détaillés dans les [rapports de validation](docs/DEVELOPMENT.md#résultats-et-limites-de-validation).

## Exécuter le projet depuis les sources

Cette procédure lance la **version de développement** sur votre ordinateur.

### Prérequis

- Windows 11 x64 et Windows PowerShell 5.1, fourni avec Windows.
- Git, pour cloner le dépôt, ou une copie complète des sources.
- Node.js et npm, pour installer les dépendances et lancer les scripts du projet.
- Visual Studio 2022 ou ses Build Tools, avec les **outils C++ MSVC x64/x86** et le **SDK Windows 10/11**, pour compiler le composant natif.
- Pour une connexion réelle : un compte universitaire compatible et l’accès à une élévation administrateur. OpenVPN Community et son pilote TAP sont vérifiés au lancement ; leur installation peut être proposée s’ils manquent. OpenVPN Connect ne remplace pas le moteur Community attendu.

### Installation et lancement

Dans un terminal PowerShell ouvert normalement, sans le lancer en administrateur :

```powershell
git clone https://github.com/Mr-Electro84/MyNEIGE.git
cd MyNEIGE
npm ci
npm run poc:build
npm start
```

`npm ci` installe les dépendances verrouillées, dont Electron. `npm run poc:build` compile le contrôleur réseau local ; il faut le relancer après une modification du code natif. `npm start` prépare OpenVPN, demande l’élévation du contrôleur réseau et ouvre l’interface. L’interface et le navigateur restent sans droits administrateur.

Saisissez vos identifiants uniquement dans le formulaire local. Pour terminer, fermez le formulaire MyNEIGE.

### Vérifier son environnement

Les tests de base peuvent être exécutés sans compte universitaire et sans connexion au VPN :

```powershell
npm test
```

Cette commande recompile le contrôleur, exécute les tests natifs et JavaScript, teste le coffre avec des données fictives et inspecte le profil VPN. Elle ne démontre pas à elle seule l’isolation réseau réelle.

Les tests du navigateur, les recettes nécessitant UAC, les diagnostics et les commandes avancées figurent dans le [guide de développement](docs/DEVELOPMENT.md).

## Comprendre le code et contribuer

L’interface repose sur **Electron et JavaScript**, et le contrôle du VPN et du réseau sur **C++/Win32**. Les scripts de développement sont écrits principalement en PowerShell.

| Dossier | Contenu |
| --- | --- |
| `src/` | Interface, navigation, règles de contenu et intégration Electron. |
| `native/windows/` | Contrôleur Windows, relais réseau et protection des identifiants. |
| `scripts/` | Compilation, lancement, tests et préparation des distributions. |
| `tests/` | Tests automatisés et données fictives. |
| `docs/` | Guides techniques, architecture et rapports de validation. |

Pour commencer, consultez le [guide de développement](docs/DEVELOPMENT.md) et les [consignes du projet](AGENTS.md). Les priorités sont la stabilité, les performances, puis l’amélioration progressive de l’interface. Les commentaires et la documentation sont principalement en français. Discutez avec le mainteneur avant d’engager une modification d’envergure.

Vous pouvez [signaler un problème ou proposer une amélioration](https://github.com/Mr-Electro84/MyNEIGE/issues). Indiquez votre version de Windows, la version de MyNEIGE, les étapes de reproduction et le résultat attendu. Ne publiez jamais de mot de passe, de cookie de session ou de données personnelles ; relisez les diagnostics avant de les partager.

Les informations de construction des paquets sont regroupées dans le [guide de distribution](docs/ALPHA_DISTRIBUTION.md).

## Utilisation de l'IA

Le développement du projet repose sur une (forte) utilisation de l'IA, notamment l'agent OpenAI Codex notamment pour la génération du code du projet et la validation technique théorique des fonctionnalités.

## Licence

MyNEIGE est développé par **Matra DevProd** et distribué sous licence [Apache 2.0](LICENSE). La version et la licence sont également accessibles dans **Aide → À propos…**.
