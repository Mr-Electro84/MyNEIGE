# MyNEIGE — pilote réseau Windows

Prototype en console pour étudier un accès APPIGS via un VPN universitaire limité à l’application. L’interface Electron et le packaging sont différés.

Essai réel réussi sur Windows : VPN, DNS du tunnel et réponse HTTPS APPIGS `302`, sondes répétées, blocages et nettoyage. L’absence de fuite par captures et le parcours ENT/CAS restent à valider ; voir [le rapport](docs/POC_STATUS.md).

```powershell
npm run poc:build
npm test
npm run poc:inspect
```

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
