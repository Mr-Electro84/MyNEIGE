# MyNEIGE — pilote Windows

Prototype pour étudier un accès APPIGS via un VPN universitaire limité à l’application : contrôleur C++/Win32, relais CONNECT/DNS et début d’interface Electron. Interface finale, packaging et Linux différés.

Essais réels : VPN, DNS UDP/TCP du tunnel, HTTPS APPIGS `302`, pertes de route/VPN/relais et crash du contrôleur ; formulaire Electron et page CAS affichée. Captures et limites : [rapport](docs/POC_STATUS.md). Le parcours ENT authentifié complet reste à valider.

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

La navigation ne démarre qu’après validation du tunnel. Le formulaire reçoit les identifiants VPN localement ; le site peut demander ensuite une connexion ENT distincte. La session s’arrête à la fermeture du formulaire ou après 30 minutes.

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
