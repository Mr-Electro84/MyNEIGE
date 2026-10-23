# J2 — identifiants Windows et préparation d’OpenVPN

23 octobre 2026. Extension autorisée après le [rapport de faisabilité](J2_CREDENTIALS_OPENVPN_FEASIBILITY.md). Interface pilote, sans packaging.

## Utilisation

`npm start` vérifie d’abord OpenVPN Community, `tapctl` et la présence du pilote TAP. Si une installation compatible existe, elle est réutilisée. Si OpenVPN manque, une boîte propose le téléchargement officiel et l’installation du moteur et du pilote TAP avec UAC. Le téléchargement utilise la connexion habituelle du poste, avant toute saisie des identifiants universitaires. Une installation existante incompatible est signalée ; elle n’est ni remplacée ni mise à niveau silencieusement.

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

1. Recherche dans les emplacements connus et les informations d’installation ; validation native de la signature, de l’éditeur et de la version de `openvpn.exe` et `tapctl.exe`. Contrôle de présence du fichier du pilote TAP.
2. Sur Windows x64, téléchargement HTTPS sans redirection depuis le serveur officiel, fichier provisoire unique et validation avant renommage. La référence reste **2.7.8-I001**, déjà qualifiée, avec empreinte SHA-256 épinglée et signature Authenticode ; pas de sélection automatique d’une version « latest ».
3. Installation élevée depuis une copie revérifiée dans un répertoire administratif protégé sous `ProgramData\MyNEIGE-Setup`. Le moteur et TAP sont sélectionnés ; aucune GUI ni service automatique ajouté par défaut. Une installation devenue compatible entre-temps est réutilisée.
4. Attente de la fin du MSI, traitement des codes d’erreur et du redémarrage requis ; `/norestart` interdit le redémarrage forcé. Nouvelle vérification avant le lancement VPN. Le paquet de staging est retiré ; le journal MSI reste dans le répertoire administratif pour diagnostic.

L’installation OpenVPN est une modification persistante du poste. Elle n’est pas supprimée à la fermeture d’une session MyNEIGE. Les règles réseau du navigateur universitaire ne reçoivent aucun permis supplémentaire pour ce téléchargement d’amorçage.

Commandes de diagnostic sans installation :

```powershell
powershell -NoProfile -File scripts/openvpn-setup.ps1 -CheckOnly
powershell -NoProfile -File scripts/openvpn-setup.ps1 -VerifyOnly -Package chemin-du-paquet.msi
powershell -NoProfile -File scripts/test-openvpn-setup.ps1
```

`-CheckOnly` renvoie 0 pour une installation compatible et 4 en cas d’absence ; une installation incompatible est une erreur. `-VerifyOnly` compare le paquet à la référence épinglée et vérifie sa signature. Le test de faux MSI ne lance aucune installation. `-Install -Package ...` permet une préparation à partir d’un MSI local vérifié.

## Vérifications et limites de recette

- Compilation MSVC `/W4 /WX` ; 27 tests de protocole et 26 tests Node.
- Test natif DPAPI avec données fictives, dans un répertoire temporaire distinct du coffre utilisateur : aller-retour, refus d’un fichier altéré, suppression et suppression répétée. Aucune lecture du coffre réel dans ce test.
- Tests Node du transport natif : sérialisation, refus Hello sans lecture de secours, validation stricte des réponses, secrets transmis par stdin seulement, arrêt et absence de rétention de réponse dans la file.
- Précontrôle WFP : appel réel du statut de l’auxiliaire depuis le formulaire, réponse limitée aux indicateurs d’existence/disponibilité ; régressions CAS, navigation, pop-ups, téléchargements et proxy exécutées.
- Préparation : installation existante reconnue, paquet officiel en cache vérifié et faux MSI refusé.

Le test natif DPAPI doit tourner dans le compte utilisateur normal : un bac à sable ajoutant un SID de restriction peut refuser les ACL privées du répertoire temporaire. Les essais réels Hello et la conservation entre deux lancements sont suivis dans [POC_STATUS.md](POC_STATUS.md). Une installation fraîche sur machine/VM dépourvue d’OpenVPN, l’annulation UAC, le code MSI 3010 et l’UAC avec un autre administrateur restent des scénarios distincts ; le moteur existant n’est pas désinstallé pour les simuler.
