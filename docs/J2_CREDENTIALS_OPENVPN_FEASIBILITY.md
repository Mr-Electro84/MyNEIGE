# Faisabilité J2 — identifiants enregistrés et préparation d’OpenVPN

Rapport du 23 octobre 2026. Analyse du dépôt et des documentations Microsoft, Node.js, IRTF et OpenVPN. **Proposition en attente du GO ; aucune fonctionnalité implémentée, aucun identifiant enregistré, aucun téléchargement ni installation exécuté pour cette étude.**

## Verdict et recommandation

Les deux extensions sont techniquement réalisables dans le pilote Windows existant : enregistrement facultatif et supprimable des identifiants VPN/CAS ; détection et téléchargement d’OpenVPN Community lorsqu’il manque.

Pour le pilote Windows, je recommande **DPAPI en portée utilisateur, accompagné d’une vérification Windows Hello avant chaque réutilisation**, avec saisie manuelle si Hello est indisponible. Cela limite la gestion de clés propre à MyNEIGE et évite un nouveau mot de passe à mémoriser. Le Gestionnaire d’identifiants Windows constitue une autre solution de stockage possible, avec les mêmes réserves sur la vérification Hello.

Cette recommandation suppose d’accepter que Hello soit un contrôle effectué par l’application. **DPAPI + une invite Hello ne constitue pas un coffre dont la clé serait cryptographiquement inaccessible sans Hello.** Si cette dernière propriété est exigée, une conception de clés liée au matériel et à une présence utilisateur imposée par le fournisseur cryptographique doit faire l’objet d’une preuve distincte ; elle n’est pas démontrée par ce rapport. Le coffre à mot de passe maître reste une alternative pertinente pour disposer d’un secret indépendant de la session Windows.

## Comparaison des deux options

| Critère | Coffre AES-256 avec mot de passe maître | Stockage Windows + vérification Hello |
| --- | --- | --- |
| Déverrouillage normal | Saisie du mot de passe maître. | Dialogue Windows : PIN, empreinte ou visage selon configuration. |
| Gestion des clés | Dérivation, paramètres, format du coffre et migrations à concevoir. | DPAPI gère la protection au repos ; MyNEIGE contrôle le parcours de réutilisation. |
| Copie du fichier chiffré | Attaque hors ligne possible contre le mot de passe maître ; sa robustesse et la dérivation comptent. | Protection normalement liée au compte Windows et au poste ; pas de portabilité à promettre. |
| Autre programme sous le même utilisateur | Sans la clé ou le mot de passe maître, il ne suffit pas d’ouvrir le fichier ; un logiciel malveillant peut toutefois intercepter un déverrouillage ou lire la mémoire. | La seule invite Hello de MyNEIGE n’empêche pas ce programme de demander directement le déchiffrement DPAPI d’un fichier accessible. |
| Oubli ou indisponibilité | Pas de récupération du coffre sans mécanisme prévu ; suppression et nouvelle saisie ENT possibles. | Hello absent, politique restrictive ou protection Windows indisponible : saisie ENT manuelle et possibilité de supprimer l’enregistrement. |
| Linux ultérieur | Format éventuellement réutilisable, après conception et qualification. | Backend Windows spécifique ; une autre implémentation sera nécessaire. |
| Charge pour J2 | Plus importante : MyNEIGE devient responsable d’un petit coffre de mots de passe. | Plus limitée, mais intégration native Hello et identité utilisateur à qualifier. |

Les deux options doivent récupérer le mot de passe en clair en mémoire pour OpenVPN et le préremplissage CAS actuels. Un simple hachage ne convient donc pas. Aucune ne supprime le risque d’un poste compromis pendant l’utilisation.

### Si le mot de passe maître est retenu

Utiliser des primitives éprouvées, sans réimplémenter AES : **AES-256-GCM**, dérivation par **Argon2id** ou **scrypt**, sel aléatoire et nonce unique par chiffrement. Le fichier contiendrait une version de format, les paramètres de dérivation, le sel, le nonce, le texte chiffré et le tag d’authentification ; aucun mot de passe maître ni clé en clair. Les métadonnées pertinentes seraient authentifiées et les paramètres lus seraient bornés avant allocation ou calcul.

La dérivation doit être calibrée sur le matériel cible, exécutée sans bloquer l’interface, et favoriser une phrase secrète longue. Un mot de passe maître faible reste faible malgré « AES-256 ». Un délai dans l’interface ne protège pas contre une attaque hors ligne sur une copie du coffre. Changement du mot de passe maître : déchiffrer puis rechiffrer avec de nouveaux paramètres aléatoires, par remplacement atomique. Mot de passe oublié : supprimer l’enregistrement et ressaisir les identifiants ENT.

Références : [Argon2 — RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html), [primitives cryptographiques Node.js, dont scrypt et GCM](https://nodejs.org/api/crypto.html). Le choix exact de bibliothèque et les paramètres restent à fixer et tester après GO.

### Si le stockage Windows est retenu

DPAPI permet de protéger un petit document contenant identifiant et mot de passe sous le compte de l’utilisateur, avec contrôle d’intégrité. Proposition : fichier versionné hors du dépôt, dans le répertoire local de données de cet utilisateur, avec ACL adaptées et écriture atomique. Ne pas utiliser `CRYPTPROTECT_LOCAL_MACHINE`, qui élargit la possibilité de déchiffrement aux autres utilisateurs du poste. [Microsoft : CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata).

Le Gestionnaire d’identifiants est une alternative via `CredWrite`/`CredRead`/`CredDelete`, avec une cible propre à MyNEIGE. Une entrée générique n’impose pas automatiquement Hello et sa taille est bornée ; les limites actuelles des champs du pilote nécessiteraient donc une vérification de compatibilité. Le fichier DPAPI évite cette limite spécifique et permet de chiffrer ensemble le nom de compte et le mot de passe. [Microsoft : CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw), [CredReadW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw).

Hello serait appelé dans le composant natif par `IUserConsentVerifierInterop::RequestVerificationForWindowAsync`, avec le HWND de l’interface locale. Seul le résultat `Verified` autoriserait la lecture et la réutilisation du secret ; annulation, indisponibilité et erreur ne doivent jamais déclencher une lecture de secours silencieuse. MyNEIGE ne collecte ni PIN Windows ni données biométriques. Cette API de bureau est documentée à partir du build 22000 : le pilote actuel Windows 11 entre dans ce périmètre ; Windows 10 demanderait une autre qualification, avec saisie manuelle comme solution disponible. [Microsoft : interop Hello pour applications de bureau](https://learn.microsoft.com/en-us/windows/win32/api/userconsentverifierinterop/nf-userconsentverifierinterop-iuserconsentverifierinterop-requestverificationforwindowasync), [disponibilité et résultats de vérification](https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.ui.userconsentverifier?view=winrt-26100).

**Point d’intégration identifié dans le code :** le lanceur élève d’abord le contrôleur, puis le formulaire est créé avec un jeton restreint dérivé de ce contrôleur (`scripts/start-browser.ps1`, `native/windows/poc/security.cpp`). Cela retire les droits administrateur actifs, mais ne restitue pas l’identité initiale si l’UAC a été validée avec un autre compte. Le stockage, la vérification Hello et la suppression devront fonctionner sous le compte interactif d’origine, avec contrôle du SID et du canal IPC. Un compte standard assisté par un autre administrateur doit être couvert par la recette. Les droits administrateur nécessaires au VPN restent distincts du déverrouillage Hello.

## Parcours et suppression proposés

1. Saisie ENT habituelle, avec option « Enregistrer mes identifiants sur cet ordinateur », désactivée par défaut. Ne persister que les identifiants d’une authentification VPN confirmée, sans boucle automatique en cas d’échec.
2. Au prochain lancement, action « Se connecter avec mes identifiants enregistrés » : vérification Hello, récupération dans le composant de confiance, puis flux VPN existant. Le mot de passe enregistré ne revient pas dans le renderer local pour être affiché ou prérempli.
3. Après validation du tunnel, même préremplissage CAS à usage unique et durée limitée. Le clic CAS reste manuel, conformément au périmètre déjà validé.
4. Si Hello ou le coffre est indisponible, proposer la saisie ENT sans réutilisation silencieuse du secret enregistré. Une modification du mot de passe ENT exige une nouvelle saisie et un remplacement explicite de l’enregistrement.
5. Action « Supprimer mes identifiants enregistrés » accessible hors VPN, sans devoir connaître le mot de passe maître ni réussir Hello. Supprimer uniquement les données MyNEIGE, désactiver toute réutilisation en attente et effacer au mieux les copies temporaires contrôlées par l’application. Une suppression en échec doit être annoncée comme telle.

La suppression empêche les réutilisations futures par MyNEIGE ; elle ne change pas le mot de passe ENT et ne révoque pas rétroactivement une session VPN/CAS déjà ouverte. La déconnexion reste une action distincte, qui peut être proposée à côté. Il s’agit d’une suppression logique : aucune garantie d’effacement de toutes les sauvegardes, copies SSD, dumps ou copies mémoire du système ne serait annoncée. Aucun secret, nom de compte ou contenu du coffre dans les diagnostics, arguments de processus ou variables d’environnement.

Les opérations du coffre doivent être réservées au formulaire local de confiance et au composant natif. Les pages universitaires et leurs pop-ups n’obtiennent aucune nouvelle API de stockage, lecture, suppression ou installation. L’IPC doit autoriser une action précise et un résultat de vérification à usage unique, et non accepter un booléen « Hello réussi » fourni par le renderer.

## Détection, téléchargement et installation d’OpenVPN

Une base existe déjà : `scripts/prepare-openvpn.ps1` télécharge OpenVPN Community 2.7.8-I001 x64, compare une empreinte SHA-256 épinglée, vérifie la signature Authenticode et l’éditeur, puis peut installer moteur et TAP avec UAC. Le contrôleur vérifie aussi les exécutables signés et leur version. Il manque l’orchestration de ces opérations depuis le parcours de démarrage.

Le pilote cible **OpenVPN Community**, avec `openvpn.exe`, `tapctl.exe` et TAP. OpenVPN Connect ne constitue pas un remplacement du moteur attendu. Le site officiel fournit plusieurs architectures ; cela ne rend pas automatiquement MyNEIGE compatible ARM64 ou x86. [OpenVPN Community](https://openvpn.net/community/).

Parcours proposé, avant saisie ou déverrouillage des identifiants :

1. Détecter une installation compatible par emplacements connus et informations d’installation, puis vérifier les fichiers attendus, leur version, architecture et signature. La simple présence d’un programme nommé OpenVPN ou d’une commande dans le `PATH` ne suffit pas.
2. Si une installation compatible existe, la réutiliser sans la modifier. Si une installation incompatible, incomplète ou tierce existe, expliquer le problème ; ne pas la mettre à niveau ou l’écraser silencieusement.
3. En cas d’absence, proposer la préparation automatique : téléchargement HTTPS depuis une source officielle admise, version et empreinte issues de métadonnées de confiance. Ne pas choisir arbitrairement « latest » ni accepter un hash fourni uniquement à côté d’un paquet non authentifié.
4. Vérifier le paquet complet et sa signature ; transférer l’artefact validé dans un emplacement protégé pour l’installation élevée, en évitant les substitutions de fichier et chemins redirigés. Revérifier l’artefact effectivement exécuté par le composant privilégié.
5. Si l’installation est incluse dans le GO, annoncer l’ajout du moteur et du pilote TAP, puis demander l’UAC nécessaire. Conserver la sélection de composants minimale déjà qualifiée, sans GUI ni service automatique ajouté par défaut. Pas de redémarrage forcé ; traiter explicitement annulation, installation concurrente, erreur et redémarrage requis.
6. Revérifier les exécutables et le pilote après installation. Démarrer ensuite le parcours VPN protégé habituel. Une installation terminée ne prouve pas une connexion universitaire.

Microsoft documente les options MSI et le code 3010 comme installation réussie nécessitant un redémarrage : [options msiexec](https://learn.microsoft.com/en-us/windows/win32/msi/standard-installer-command-line-options), [codes de résultat](https://learn.microsoft.com/en-us/windows/win32/msi/error-codes).

**Conséquence réseau :** le téléchargement initial ne peut pas passer par un VPN dont le moteur manque encore. Il utilisera donc la connexion habituelle du poste, dans une phase de préparation distincte, sans identifiants universitaires. Le navigateur universitaire reste sous sa politique actuelle ; aucun domaine OpenVPN ni permis réseau général n’est ajouté à sa quarantaine. Une option d’installation depuis un MSI local préalablement vérifié permettrait le cas hors ligne.

La version du script est une référence de recette, pas une politique de maintenance éternelle. Le catalogue officiel consulté le 23 octobre propose aussi la révision 2.7.8-I002 : son adoption demanderait une nouvelle empreinte de confiance et une qualification avant modification du paquet retenu. Aucune version n’a été changée ici. [Catalogue officiel OpenVPN](https://build.openvpn.net/downloads/releases/).

## Jalons de réalisation proposés après GO

| Sous-jalon J2 proposé | Résultat attendu |
| --- | --- |
| Identité utilisateur et stockage | Compte initial préservé malgré l’UAC ; stockage facultatif ; tests avec secrets fictifs et profils Windows distincts. |
| Déverrouillage et réutilisation | Hello réel sur le poste, annulation/absence/erreur bloquantes pour la lecture enregistrée ; VPN puis CAS selon le parcours existant. |
| Oubli et remplacement | Suppression disponible même coffre verrouillé, état persistant cohérent après relancement, changement de mot de passe et écritures interrompues traités. |
| Préparation OpenVPN | Détection, téléchargement vérifié et, si autorisée, installation UAC sans modification silencieuse d’une installation existante. |
| Recette d’intégration | Régressions CAS/menus/pop-ups/téléchargements et WFP ; VM Windows propre pour l’absence d’OpenVPN et l’installation, au lieu de désinstaller le moteur du poste actuel. |

À valider en particulier : confidentialité sur disque/journaux, coffre altéré ou tronqué, impossibilité de contourner Hello via l’IPC de l’application, refus d’un autre compte Windows, UAC avec autre administrateur, suppression sans Hello, échec d’authentification VPN sans répétition, faux paquet/signature/version, téléchargement interrompu et absence de redémarrage forcé. Le contrôle Hello applicatif n’est pas présenté comme une défense contre un malware du même utilisateur.

Ce rapport établit la faisabilité et les limites du choix proposé ; il ne revendique aucun essai exécuté de stockage ou de Windows Hello. L’interface finale et le packaging restent différés. L’implémentation attend le GO et le choix du mode de stockage ; le téléchargement seul et l’installation assistée sont deux périmètres distincts.
