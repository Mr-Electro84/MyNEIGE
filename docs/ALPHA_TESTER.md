# MyNEIGE 1.0.0-alpha.1 — Alpha Windows

Développeur : **Matra DevProd**. Licence du programme : Apache 2.0, texte intégral dans `LICENSE`. Les notices Electron et Chromium sont indiquées dans `THIRD-PARTY-NOTICES.txt`.

## Démarrer

Windows 11 x64 (Intel/AMD), connexion Internet et accès à une élévation administrateur sont nécessaires. Cette Alpha embarque le profil VPN de l’Université d’Avignon. Node.js, npm, Visual Studio et NSIS ne sont pas nécessaires pour l’utiliser.

- **Installateur** : exécuter le fichier `setup.exe` et accepter l’installation avec UAC. Lancer ensuite **MyNEIGE** depuis le menu Démarrer.
- **ZIP portable** : extraire **toute** l’archive dans un dossier local, puis ouvrir `MyNEIGE.exe`. Ne pas lancer l’exécutable directement depuis l’archive ni déplacer seulement ce fichier.

Lancer MyNEIGE normalement, sans « Exécuter en tant qu’administrateur ». Le programme vérifie OpenVPN Community et TAP ; si nécessaire, il propose de télécharger et d’installer le paquet officiel vérifié. Cette préparation peut demander Internet, l’UAC et un redémarrage. Une autre élévation démarre le contrôleur réseau ; l’interface reste non administratrice. Refuser une élévation ou annuler une installation ne démarre pas de tunnel.

Saisir les identifiants dans le formulaire local. Après validation du tunnel, le navigateur universitaire s’ouvre. Le CAS peut être prérempli ; cliquer soi-même sur « SE CONNECTER ». L’enregistrement des identifiants est facultatif et leur réutilisation nécessite Windows Hello. Les identifiants mémorisés sont liés au compte et au PC, même avec le ZIP portable.

Le menu **Aide → À propos…** affiche la version. Fermer le formulaire met fin à la session, limitée à 30 minutes. L’application est une Alpha : la compatibilité avec la veille, les changements de réseau et les VPN tiers reste à qualifier. Les versions ne se mettent pas à jour automatiquement.

## Vérifications et diagnostics

Depuis PowerShell, dans le dossier du programme :

```powershell
Start-Process .\MyNEIGE.exe -ArgumentList '--check' -Wait -PassThru
Start-Process .\MyNEIGE.exe -ArgumentList '--browser-test' -Wait -PassThru
```

`--check` contrôle les fichiers et OpenVPN, sans UAC, tunnel ni modification réseau. Son code de sortie est 0 si prêt, 4 si OpenVPN manque, 5 s’il est incomplet, 6 s’il est incompatible et 1 en cas d’erreur. `--browser-test` demande une élévation et teste localement le confinement WFP et le navigateur, sans envoyer d’identifiants ni contacter le VPN universitaire.

Diagnostics : `%LOCALAPPDATA%\MyNEIGE\logs` ; journaux protégés de session : `%PROGRAMDATA%\MyNEIGE-Logs`. Ils n’enregistrent pas de mots de passe, mais peuvent contenir des adresses réseau. Relire les fichiers avant de les transmettre. Le cache navigateur et le téléchargement de préparation OpenVPN sont également placés sous `%LOCALAPPDATA%\MyNEIGE`.

## Remplacer ou désinstaller

Fermer MyNEIGE avant toute mise à jour. Installer la nouvelle Alpha par-dessus l’ancienne, ou remplacer le dossier du ZIP complet. L’installateur refuse d’intervenir pendant une session. Conserver une copie du paquet précédent pour revenir à une version antérieure en cas de problème.

Pour effacer les données locales **avant de désinstaller**, utiliser **MyNEIGE → MyNEIGE - Effacer les données locales** dans le menu Démarrer, ou :

```powershell
Start-Process .\MyNEIGE.exe -ArgumentList '--reset-user-data' -Wait
```

Une confirmation précède la suppression des identifiants mémorisés, caches, diagnostics utilisateur et paquets OpenVPN téléchargés. Les fichiers enregistrés depuis les sites universitaires, les journaux système protégés et les données des autres comptes sont conservés. Pour supprimer seulement les identifiants : `--forget-credentials`.

La désinstallation conserve les données utilisateur par défaut et ne supprime pas OpenVPN ni les autres VPN. Pour le ZIP, effacer le dossier extrait après avoir fermé l’application ; si une session a subi un crash, lancer le contrôleur `bin\myneige-controller.exe cleanup` avec élévation avant de retirer les fichiers afin de récupérer les protections résiduelles appartenant à MyNEIGE.

## Provenance de cette Alpha

Cette construction est **non signée** : Windows peut afficher des alertes de provenance. Comparer l’empreinte SHA-256 au fichier fourni par le développeur, reçu par un canal de confiance. Le manifeste de fichiers détecte les corruptions ; il ne remplace pas une signature de l’éditeur.
