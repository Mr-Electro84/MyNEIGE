# MyNEIGE 1.1.0-alpha.1 — Alpha Windows

Développeur : **Matra DevProd**. Révision de livraison : **3**. Licence du programme : Apache 2.0, texte intégral dans `LICENSE`. Les notices Electron et Chromium sont indiquées dans `THIRD-PARTY-NOTICES.txt`.

## Démarrer

Windows 11 x64 (Intel/AMD), connexion Internet et accès à une élévation administrateur sont nécessaires. Ce paquet ne contient aucun profil VPN ; chaque utilisateur doit importer son propre profil. Les anciens paquets retirés ne doivent plus être redistribués. Node.js, npm, Visual Studio et NSIS ne sont pas nécessaires pour l’utiliser.

- **Installateur** : exécuter le fichier `setup.exe` et accepter l’installation avec UAC. Lancer ensuite **MyNEIGE** depuis le menu Démarrer.
- **ZIP portable** : extraire **toute** l’archive dans un dossier local, puis ouvrir `MyNEIGE.exe`. Ne pas lancer l’exécutable directement depuis l’archive ni déplacer seulement ce fichier.

Lancer MyNEIGE normalement, sans « Exécuter en tant qu’administrateur ». Le programme vérifie OpenVPN Community et TAP ; si nécessaire, il propose de télécharger et d’installer le paquet officiel vérifié. Cette préparation peut demander Internet, l’UAC et un redémarrage. Une autre élévation démarre le contrôleur réseau ; l’interface reste non administratrice. Refuser une élévation ou annuler une installation ne démarre pas de tunnel.

Dans le formulaire local, importer son propre fichier OpenVPN obtenu personnellement sur le site officiel de la DOSI, puis saisir les identifiants. Le [guide du profil personnel](VPN_PROFILE.md) décrit sa gestion. Après validation du tunnel, le navigateur universitaire s’ouvre. Le CAS peut être prérempli ; cliquer soi-même sur « SE CONNECTER ». L’enregistrement des identifiants est facultatif et leur réutilisation nécessite Windows Hello. Les identifiants mémorisés sont liés au compte et au PC, même avec le ZIP portable.

Le menu **Aide → À propos…** affiche la version. Fermer le formulaire met fin à la session. Les sources actuelles prévoient une session de **deux heures** : cinq minutes avant la fin, un avertissement local propose **Prolonger de deux heures** ou **Terminer la session**. La prolongation ouvre un nouveau délai de deux heures à compter du clic accepté, sans recharger les pages ni reconnecter le VPN. Fermer l’avertissement ne prolonge rien. Sans prolongation, le VPN, toutes les pages et les téléchargements s’arrêtent ; un écran local explique l’expiration et invite à relancer MyNEIGE. Enregistrer son travail avant l’échéance : les saisies non enregistrées peuvent être perdues. Les anciens paquets peuvent encore appliquer la limite de 30 minutes ; ces changements nécessitent un paquet reconstruit.

L’application est une Alpha : la compatibilité avec la veille, les changements de réseau et les VPN tiers reste à qualifier. Les versions ne se mettent pas à jour automatiquement.

## Vérifications et diagnostics

Depuis PowerShell, dans le dossier du programme :

```powershell
Start-Process .\MyNEIGE.exe -ArgumentList '--check' -Wait -PassThru
Start-Process .\MyNEIGE.exe -ArgumentList '--browser-test' -Wait -PassThru
```

`--check` contrôle les fichiers et OpenVPN, sans UAC, tunnel ni modification réseau. Son code de sortie est 0 si prêt, 4 si OpenVPN manque, 5 s’il est incomplet, 6 s’il est incompatible et 1 en cas d’erreur. `--browser-test` demande une élévation et teste localement le confinement WFP et le navigateur, sans envoyer d’identifiants ni contacter le VPN universitaire.

Diagnostics : `%LOCALAPPDATA%\MyNEIGE\logs` ; journaux protégés de session : `%PROGRAMDATA%\MyNEIGE-Logs`. Ils n’enregistrent pas de mots de passe, mais peuvent contenir des adresses réseau. Relire les fichiers avant de les transmettre. Le cache navigateur et le téléchargement de préparation OpenVPN sont également placés sous `%LOCALAPPDATA%\MyNEIGE`.

## Remplacer ou désinstaller

La vérification des mises à jour dans l’application est à venir. **Aide → Vérifier les mises à jour** affiche cette annonce et un bouton **Voir le site web**, qui ouvre le site MyNEIGE dans votre navigateur par défaut. Cette action fonctionne aussi avant la connexion universitaire. Aucun appel automatique à l’API de version n’est effectué actuellement. Voir les [détails des mises à jour](UPDATES.md).

Fermer MyNEIGE avant toute mise à jour. Lancer le nouvel installateur : il désinstalle d’abord l’ancienne version avec son propre inventaire de fichiers, puis installe la nouvelle, en conservant les données locales et les identifiants enregistrés. Pour le ZIP, remplacer le dossier complet. L’installateur refuse d’intervenir pendant une session. Ne pas réutiliser les anciens paquets contenant la configuration retirée.

Pour effacer les données locales **avant de désinstaller**, utiliser **MyNEIGE → MyNEIGE - Effacer les données locales** dans le menu Démarrer, ou :

```powershell
Start-Process .\MyNEIGE.exe -ArgumentList '--reset-user-data' -Wait
```

Une confirmation précède la suppression du profil VPN personnel, des identifiants mémorisés, caches, diagnostics utilisateur et paquets OpenVPN téléchargés. Les fichiers enregistrés depuis les sites universitaires, les journaux système protégés et les données des autres comptes sont conservés. Pour supprimer seulement les identifiants : `--forget-credentials`.

La désinstallation conserve les données utilisateur par défaut et ne supprime pas OpenVPN ni les autres VPN. Pour le ZIP, effacer le dossier extrait après avoir fermé l’application ; si une session a subi un crash, lancer le contrôleur `bin\myneige-controller.exe cleanup` avec élévation avant de retirer les fichiers afin de récupérer les protections résiduelles appartenant à MyNEIGE.

## Provenance de cette Alpha

Cette construction est **non signée** : Windows peut afficher des alertes de provenance. Comparer l’empreinte SHA-256 au fichier fourni par le développeur, reçu par un canal de confiance. Le manifeste de fichiers détecte les corruptions ; il ne remplace pas une signature de l’éditeur.
