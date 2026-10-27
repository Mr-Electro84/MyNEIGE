# Identifiants Windows et préparation d’OpenVPN

Ce guide décrit l’enregistrement facultatif des identifiants, leur réutilisation après vérification Windows Hello et la préparation d’OpenVPN. Les commandes ci-dessous concernent le développement ; les points d’entrée des paquets sont décrits dans le [guide utilisateur](ALPHA_TESTER.md).

## Utilisation

`npm start` vérifie d’abord OpenVPN Community, `tapctl` et la présence du paquet TAP dans le magasin de pilotes Windows. Aucun adaptateur ni service TAP déjà actif n’est exigé à cette étape. Si une installation compatible existe, elle est réutilisée. Si OpenVPN manque ou si une désinstallation a laissé une installation incomplète, une boîte **MyNEIGE — Installer OpenVPN** propose le téléchargement officiel et l’installation/réparation du moteur et du pilote TAP avec UAC. Le téléchargement utilise la connexion habituelle du poste, avant toute saisie des identifiants universitaires. Les fichiers de version ou signature incompatibles restent signalés ; ils ne sont pas remplacés automatiquement.

L’installation peut aussi être demandée explicitement, sans lancer de session VPN :

```powershell
npm run openvpn:install
```

Cette commande réutilise le même parcours et laisse une installation déjà compatible intacte. Un MSI local peut être fourni avec `scripts/openvpn-setup.ps1 -Install -Package ...`.

Dans le formulaire local :

- L’option **Enregistrer mes identifiants sur cet ordinateur** est désactivée par défaut. L’enregistrement n’a lieu qu’après confirmation de la connexion VPN. Une copie temporaire destinée à cet enregistrement expire après trois minutes si la connexion n’aboutit pas.
- Au lancement suivant, **Se connecter avec Windows Hello** demande une vérification Windows. Seul le résultat natif `Verified` permet la lecture du coffre et le démarrage du VPN. Le mot de passe enregistré ne revient pas dans les champs du formulaire local. CAS conserve son préremplissage à usage unique et le clic manuel.
- Si Hello est indisponible, la saisie manuelle reste disponible ; la réutilisation enregistrée et un nouvel enregistrement sont désactivés dans l’interface. Aucun passage automatique de Hello à une lecture silencieuse du coffre.
- **Supprimer mes identifiants enregistrés** reste disponible indépendamment de l’état du VPN et de Hello. L’action annule une lecture Hello en cours, supprime l’enregistrement et invalide les copies en attente contrôlées par l’application. Elle ne change pas le mot de passe ENT et ne déconnecte pas une session déjà ouverte.

Si le démarrage est bloqué par un prérequis, le coffre peut être supprimé sans OpenVPN, sans élévation et sans Hello :

```powershell
npm run credentials:forget
```

Utiliser le bouton du formulaire si une session est actuellement ouverte ; la commande indépendante est prévue lorsque le pilote est fermé. Après suppression, un nouvel enregistrement exige à nouveau un choix explicite.

## Protection et identité

Le coffre `%LOCALAPPDATA%\MyNEIGE\credentials.dpapi` contient identifiant et mot de passe chiffrés ensemble par DPAPI, dans la portée de l’utilisateur Windows. Aucun mode machine partagé. Répertoire avec DACL explicite, fichier borné, refus des liens de réanalyse au niveau du coffre, vérification du format après déchiffrement et remplacement atomique lors de l’écriture. Les diagnostics ne contiennent ni identifiant, ni mot de passe, ni contenu chiffré.

Le composant natif `myneige-vault.exe` est copié dans le répertoire de session protégé en écriture et placé sous une quarantaine WFP sans permis réseau. Il n’accepte que statut, enregistrement, suppression et déverrouillage. Il vérifie son parent Electron protégé ; la fenêtre fournie pour Hello doit appartenir à ce parent. L’échange s’effectue par les seuls pipes standard hérités du processus, sans secret dans les arguments ni l’environnement. La file JavaScript de sérialisation ne conserve pas les réponses de lecture.

La vérification utilise l’interop de bureau `IUserConsentVerifierInterop` ; le PIN et les données biométriques sont traités par Windows, jamais par MyNEIGE. Le code vise Windows 11. Annulation, fenêtre invalide, indisponibilité et erreur empêchent la lecture. Les opérations IPC du coffre sont réservées au document principal du formulaire local ; aucune nouvelle API n’est exposée au site universitaire ou aux pop-ups.

**Limite du modèle choisi :** Hello est une vérification applicative précédant DPAPI. Cette construction ne prétend pas lier cryptographiquement la clé DPAPI à une nouvelle validation Hello. Un logiciel exécuté sous le même utilisateur peut chercher à déchiffrer un coffre accessible ou à lire les secrets pendant leur utilisation. La suppression est logique ; l’effacement de toutes les copies mémoire, sauvegardes, dumps et traces physiques du disque n’est pas garanti.

Le mode navigateur sélectionne le compte du shell du bureau interactif, vérifie qu’il appartient à la même session Windows et utilise son SID pour les ACL de session. Quand l’UAC utilise le même compte, le jeton restreint reste dérivé du contrôleur ; sinon la création du travailleur utilise le jeton interactif retenu. L’environnement des travailleurs est reconstruit pour leur utilisateur. En cas d’impossibilité de lire ou utiliser ce jeton, le lancement échoue ; aucun coffre du compte administrateur n’est utilisé en secours. Le cas avec un autre administrateur doit encore être qualifié sur une session Windows correspondante et n’est pas déclaré acquis par un essai avec le même compte.

## Préparation d’OpenVPN

`scripts/openvpn-setup.ps1` est le flux commun du lanceur et de l’ancien point d’entrée `prepare-openvpn.ps1` :

Avant de rechercher OpenVPN, le script vérifie le protocole du pilote natif MyNEIGE (`setup-capabilities`). Au lancement avec `npm start` ou `npm run openvpn:install`, un exécutable absent ou ancien déclenche une recompilation, puis une nouvelle vérification, avant tout téléchargement ou MSI/UAC. Les outils C++ Visual Studio et le SDK Windows restent requis pour cette version de développement. Une erreur de compilation arrête la préparation. `-CheckOnly`, `-Diagnose` et le travailleur élevé ne compilent jamais : ils indiquent de lancer `npm run poc:build` si nécessaire. Une ancienne copie de `.local/poc/myneige-poc.exe` ne peut donc plus être confondue avec une signature OpenVPN invalide. Une mise à jour des scripts doit inclure aussi les sources natives.

1. Recherche dans les emplacements connus, les informations d’installation et les valeurs officielles `exe_path`/`bin_dir` du registre OpenVPN ; validation native de la signature, de l’éditeur et de la version de `openvpn.exe` et `tapctl.exe`. Contrôle en lecture seule du magasin de pilotes avec SetupAPI : seuls les identifiants matériels exacts `tap0901` ou `root\tap0901` sont admis. Aucun adaptateur n’est créé par ce contrôle. États distincts : prêt, absent, incomplet, incompatible. Une entrée de désinstallation résiduelle n’est plus assimilée à un binaire incompatible. OpenVPN Connect seul ne remplace pas le moteur Community et n’empêche pas sa proposition d’installation.
2. Sur Windows x64, téléchargement HTTPS sans redirection depuis l’adresse canonique `swupdate.openvpn.net`, fichier provisoire unique et validation avant renommage. L’ancien hôte `.org` renvoie une redirection vers `.net` ; son refus déclenche une exception opaque avec Windows PowerShell 5.1. La référence reste **2.7.8-I001**, déjà qualifiée, avec empreinte SHA-256 épinglée et signature Authenticode ; pas de sélection automatique d’une version « latest ».
3. Installation élevée depuis une copie revérifiée dans un répertoire administratif protégé sous `ProgramData\MyNEIGE-Setup`. Le moteur et TAP sont sélectionnés ; aucune GUI ni service automatique ajouté par défaut. Une installation devenue compatible entre-temps est réutilisée. La réparation forcée n’est sélectionnée que si le code produit du MSI vérifié correspond exactement au produit déjà enregistré. La progression MSI et ses dialogues d’erreur sont visibles.
4. Attente de la fin du MSI, traitement des codes d’erreur et du redémarrage requis ; `/norestart` interdit le redémarrage forcé. Le parent non élevé effectue la vérification finale et conserve son message détaillé ; un succès du MSI n’est pas assimilé à lui seul à l’état prêt. Le paquet de staging est retiré ; le journal MSI reste dans le répertoire administratif pour diagnostic.

Le pilote TAP officiel peut être seulement préparé dans le magasin Windows : son installateur utilise `SetupCopyOEMInf`. Le service `tap0901` et la copie du fichier sous `System32\drivers` peuvent être absents avant la création du premier adaptateur. Le programme vérifie maintenant le paquet réellement disponible ; la création et la validation de l’adaptateur dédié restent effectuées ensuite par le contrôleur VPN. [Source du pilote TAP officiel](https://github.com/OpenVPN/tap-windows6/blob/master/msm/installation.c).

L’installation OpenVPN est une modification persistante du poste. Elle n’est pas supprimée à la fermeture d’une session MyNEIGE. Les règles réseau du navigateur universitaire ne reçoivent aucun permis supplémentaire pour ce téléchargement d’amorçage.

Commandes de diagnostic sans installation :

```powershell
powershell -NoProfile -File scripts/openvpn-setup.ps1 -CheckOnly
powershell -NoProfile -File scripts/openvpn-setup.ps1 -Diagnose
powershell -NoProfile -File scripts/openvpn-setup.ps1 -VerifyOnly -Package chemin-du-paquet.msi
powershell -NoProfile -File scripts/test-openvpn-setup.ps1
# Integration reseau : nouveau dossier vide, telechargement reel, aucun MSI execute
powershell -NoProfile -File scripts/test-openvpn-setup.ps1 -FreshDownload
```

`-CheckOnly` renvoie 0 pour une installation compatible, 4 en cas d’absence, 5 pour une installation incomplète et 6 pour des fichiers incompatibles. `-VerifyOnly` compare le paquet à la référence épinglée et vérifie sa signature. Le test de faux MSI ne lance aucune installation.

`-Diagnose` ne lance ni MSI ni VPN : il affiche l’état, le chemin du moteur, le nombre de moteurs trouvés/validés, un éventuel `tapctl` manquant, le résultat du contrôle natif et le fichier INF TAP trouvé. Il permet de distinguer une absence réelle du moteur, un refus de signature/version et une absence du paquet pilote.

Une réponse d’aide/code 2, un échec de chargement ou une réponse native inattendue provoquent une erreur du vérificateur MyNEIGE ; seuls le code 0 et le marqueur exact `OPENVPN_COMPATIBLE` valident le contrôle. Un refus réel de signature/version reste bloquant. Les erreurs stderr sont normalisées pour Windows PowerShell 5.1 sans perdre le message natif.

Le lanceur reçoit un résultat JSON structuré : il affiche la cause réelle d’un échec et l’étape concernée. Le diagnostic de préparation est `.local/browser/openvpn-preparation.txt` ; en cas d’exception, il comprend aussi le numéro de ligne et le type d’exception. Une annulation est distinguée d’un échec ; un redémarrage demandé par MSI empêche le démarrage du VPN jusqu’au redémarrage de Windows. Le contrôle d’architecture utilise l’API `RuntimeInformation.OSArchitecture`, sans dépendre d’une valeur facultative du registre d’environnement.

## Vérifications et limites de recette

- Compilation MSVC `/W4 /WX` ; 27 tests de protocole et 26 tests Node.
- Test natif DPAPI avec données fictives, dans un répertoire temporaire distinct du coffre utilisateur : aller-retour, refus d’un fichier altéré, suppression et suppression répétée. Aucune lecture du coffre réel dans ce test.
- Tests Node du transport natif : sérialisation, refus Hello sans lecture de secours, validation stricte des réponses, secrets transmis par stdin seulement, arrêt et absence de rétention de réponse dans la file.
- Précontrôle WFP : appel réel du statut de l’auxiliaire depuis le formulaire, réponse limitée aux indicateurs d’existence/disponibilité ; régressions CAS, navigation, pop-ups, téléchargements et proxy exécutées.
- Préparation : installation existante reconnue, paquet officiel en cache vérifié et faux MSI refusé.
- Régression du parcours d’installation : 23 contrôles PowerShell sur la machine de développement, avec effets simulés pour l’absence, les restes de désinstallation, tapctl/TAP manquants, OpenVPN Connect seul, les fichiers incompatibles, la proposition puis l’installation, les annulations avant téléchargement et pendant MSI/UAC, les erreurs de téléchargement/MSI, le redémarrage requis et la vérification finale. Le résultat d’erreur structuré et les métadonnées de diagnostic sont vérifiés via un vrai sous-processus ; le code produit du MSI en cache est lu réellement, sans installation.
- Avec `-FreshDownload`, cinq contrôles supplémentaires passent (28 au total ici) : absence initiale de MSI dans un dossier unique, téléchargement neuf par le vrai script sous Windows PowerShell 5.1, résultat `Downloaded`, empreinte et signature valides, absence de fichier partiel. Les fichiers de test sont supprimés. Aucune installation ni élévation UAC n’est déclenchée par cet essai.
- Après correction du contrôle TAP : 33 contrôles sans réseau passent sous Windows PowerShell 5.1 sur le poste de développement. Ils incluent l’interrogation réelle du magasin de pilotes en lecture seule, les identifiants TAP exacts et le refus d’identifiants voisins, la reconnaissance du paquet installé sans condition d’adaptateur/service actif, et la conservation de la cause d’un échec de validation après MSI. `-Diagnose` renvoie `Ready`, avec le paquet TAP et le contrôle natif réussi. Ces tests ne réinstallent pas OpenVPN.
- Après correction de la compatibilité scripts/exécutable : 48 contrôles passent sous Windows PowerShell 5.1. Les quinze ajouts couvrent le pilote ancien/absent, la recompilation simulée suivie d’une nouvelle vérification, son échec, l’absence de compilation en diagnostic et pour un pilote actuel, le refus des réponses natives inattendues, le vrai protocole du binaire recompilé et le rejet natif réel d’un fichier fictif non signé. Compilation MSVC, 27 tests natifs et 26 tests Node réussis ; diagnostic réel `Ready`. Aucune installation ni connexion VPN pendant cette validation. La recompilation automatique sur le second PC reste à confirmer.

Le test natif DPAPI doit tourner dans le compte utilisateur normal : un bac à sable ajoutant un SID de restriction peut refuser les ACL privées du répertoire temporaire. Les essais réels Hello et la conservation entre deux lancements sont suivis dans [POC_STATUS.md](POC_STATUS.md). Une installation fraîche sur machine/VM dépourvue d’OpenVPN, l’annulation UAC, le code MSI 3010 et l’UAC avec un autre administrateur restent des scénarios distincts ; le moteur existant n’est pas désinstallé pour les simuler.
