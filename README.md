# MyNEIGE — pilote Windows

Version **1.0.0-alpha.1** pour tester un accès APPIGS via un VPN universitaire limité à l’application : contrôleur C++/Win32, relais CONNECT/DNS et interface Electron. Distribution standalone Windows 11 x64 ; Linux différé.

Le menu **Aide → À propos…**, disponible dans le formulaire et les fenêtres de navigation, affiche la version, le développeur **Matra DevProd** et la licence **Apache 2.0**. Le texte intégral figure dans [LICENSE](LICENSE).

Après `npm ci`, **`npm run dist:win`** compile le lanceur et le contrôleur puis produit le dossier autonome, le ZIP portable, l’installateur NSIS et les empreintes SHA-256 sous `dist`. Visual Studio C++/SDK Windows et NSIS sont requis sur le poste de construction ; aucun outil de développement n’est requis chez le testeur. Le profil VPN est embarqué pour cette Alpha. Voir [la construction et les limites de validation](docs/ALPHA_DISTRIBUTION.md) et [le guide testeur](docs/ALPHA_TESTER.md). `npm run test:dist` vérifie le contenu livré. Les paquets sont actuellement non signés.

Essais réels : VPN, DNS UDP/TCP du tunnel, HTTPS APPIGS `302`, pertes de route/VPN/relais et crash du contrôleur ; préremplissage CAS et accès APPIGS après clic manuel confirmés. Captures et limites de la recette : [rapport](docs/POC_STATUS.md).

```powershell
npm run poc:build
npm test
npm run poc:inspect
```

Début de J2, après installation des dépendances Electron épinglées (`npm ci`) :

```powershell
npm run browser:test  # Précontrôle local, sans identifiants, avec UAC
npm start            # Contrôleur élevé, formulaire et navigateur non administrateurs
```

La navigation ne démarre qu’après validation du tunnel. Les mêmes identifiants sont préremplis une seule fois sur la page CAS vérifiée ; vous cliquez vous-même sur « SE CONNECTER ». La copie temporaire expire après 3 minutes. Voir [le pilote de préremplissage J2](docs/CAS_PREFILL.md). La session s’arrête à la fermeture du formulaire ou après 30 minutes.

Le menu **Navigation** propose Précédent, Suivant et Accueil APPIGS. Les téléchargements demandent où enregistrer le fichier ; **Fichiers → Téléchargements** (`Ctrl+J`) affiche leur état et permet l’annulation. Aucun fichier n’est ouvert automatiquement. L’écran de connexion affiche un avertissement d’utilisation. Voir [ces ajouts J2](docs/J2_NAVIGATION_DOWNLOADS.md).

Le menu **Université** ouvre ENT, Annuaire (VPN), Gestionnaire de projets (VPN), E-UAPV/Moodle, EDT, **Mail** (PARTAGE) et **Nextcloud** dans la fenêtre principale APPIGS, avec la même session et toujours via le tunnel. Les serveurs RENATER sont admis pour la messagerie. Le logo MyNEIGE est associé aux fenêtres Electron, y compris au formulaire et aux pop-ups, aux exécutables natifs et aux raccourcis NSIS. Après une modification native, exécuter `npm run poc:build` avant `npm start`.

Les pages de tous les sites universitaires peuvent intégrer des lecteurs **YouTube**, y compris dans des activités **H5P**. Les ressources de lecture passent par le VPN ; l'accès direct à YouTube et les pop-ups externes restent refusés. Voir [les autorisations, tests et limites de la recette](docs/EMBEDDED_CONTENT.md).

L’enregistrement des identifiants est facultatif : protection Windows DPAPI, réutilisation après vérification Windows Hello et bouton de suppression sans déverrouillage. `npm run credentials:forget` permet aussi la suppression lorsque le pilote est fermé. Au démarrage, OpenVPN Community est vérifié ; s’il manque, MyNEIGE propose son téléchargement vérifié et son installation avec UAC. Voir [le fonctionnement et les limites](docs/J2_CREDENTIALS_SETUP.md).

Le démarrage réutilise un cache Electron protégé, vérifie les empreintes du paquet en code natif et évite deux processus PowerShell intermédiaires. Les chemins de session WFP restent distincts. Voir [les mesures et la validation](docs/STARTUP_PERFORMANCE.md).

Pour lancer seulement l’installation/préparation d’OpenVPN : `npm run openvpn:install`. Une installation incomplète après désinstallation peut également déclencher la proposition d’installation/réparation. En cas d’échec, le lanceur affiche la cause et indique le diagnostic local.

Le test du filtrage Windows nécessite une console administrateur :

```powershell
powershell -NoProfile -File scripts/test-wfp.ps1 -Elevate
```

Les tests réels nécessitent OpenVPN Community signé, son pilote compatible et une saisie locale des identifiants. Ne pas transmettre de mot de passe dans le chat ou les arguments.

Pour ouvrir la console de l’essai réel après préparation des dépendances :

```powershell
npm run poc:live
```

Voir [le guide du pilote](docs/POC_WINDOWS.md), [son état de validation](docs/POC_STATUS.md) et [le plan](PLAN.md). Un test de protocole réussi ne démontre pas l’isolation réseau réelle.
