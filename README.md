# MyNEIGE — pilote Windows

Prototype pour étudier un accès APPIGS via un VPN universitaire limité à l’application : contrôleur C++/Win32, relais CONNECT/DNS et début d’interface Electron. Interface finale, packaging et Linux différés.

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

Le menu **Université** ouvre ENT, Annuaire (VPN), Gestionnaire de projets (VPN), E-UAPV/Moodle et EDT dans la fenêtre principale APPIGS, avec la même session et toujours via le tunnel. Le logo MyNEIGE est associé aux fenêtres Electron, y compris au formulaire et aux pop-ups. Le lanceur natif embarque les ressources ; après cette mise à jour, exécuter `npm run poc:build` avant `npm start`. L’icône intégrée de l’exécutable et les raccourcis installés restent prévus au packaging J3.

L’enregistrement des identifiants est facultatif : protection Windows DPAPI, réutilisation après vérification Windows Hello et bouton de suppression sans déverrouillage. `npm run credentials:forget` permet aussi la suppression lorsque le pilote est fermé. Au démarrage, OpenVPN Community est vérifié ; s’il manque, MyNEIGE propose son téléchargement vérifié et son installation avec UAC. Voir [le fonctionnement et les limites](docs/J2_CREDENTIALS_SETUP.md).

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
