# Retrait de la configuration VPN — 29 octobre 2026

La diffusion reste suspendue et le dépôt privé. Le programme utilise désormais un profil personnel importé par l’utilisateur ; aucune procédure ne reconnaît la configuration d’Avignon. Les vérifications techniques et TLS restent obligatoires. Voir [le profil personnel](VPN_PROFILE.md).

## Modifications

- Retrait du profil de la racine, des lanceurs et des listes de fichiers distribuables. Les commandes console exigent un chemin explicite ; les tests ordinaires utilisent un profil synthétique et une CA fictive.
- Import, remplacement et suppression depuis le formulaire local ; conservation chiffrée DPAPI par utilisateur, écriture atomique et validation indépendante dans le contrôleur avant lancement OpenVPN.
- Identifiants enregistrés au format MNV2, liés à l’empreinte du profil normalisé. Les coffres anciens ou liés à un autre profil ne sont pas réutilisés. Une modification du profil invalide les lectures Hello en cours.
- Tests contre l’introduction de profils personnels dans Git et contre les profils/coffres supplémentaires dans un paquet, y compris hors manifeste.

## Retrait et historique

Les modifications locales initiales ont été conservées dans une sauvegarde privée sous `.local/security-prechange-20261029`. Une copie du profil y est gardée uniquement pour récupération personnelle et contrôle du retrait ; ce répertoire ne doit être ni publié ni distribué.

L’inventaire local a trouvé 31 blobs concernés dans cinq chemins historiques, dont un ancien document de planification. Les références internes Codex et anciennes étiquettes locales appartiennent toujours au clone de travail : ce clone n’est pas un dépôt assaini et ne doit pas être poussé après la purge.

La préparation destinée à GitHub part de son état distant actuel, comprenant le dernier commit README. `git-filter-repo` a réécrit les 26 commits de cette branche, retiré le profil et remplacé l’adresse VPN recopiée, sans supprimer les autres fichiers sources. Les anciennes étiquettes déjà supprimées de GitHub ne seront pas réintroduites. La seule référence distante actuellement concernée est `refs/heads/main`.

Les anciens paquets de `dist/` et deux dossiers de recette contenant des copies du profil ont été supprimés. L’inventaire GitHub authentifié a confirmé : dépôt privé, zéro release, zéro artefact Actions, zéro pull request et zéro fork visible. Cela ne prouve pas l’absence de clones ou d’anciens forks détachés détenus par des tiers. L’hébergement indépendant du site n’a pas pu être contrôlé depuis les outils disponibles.

Le clone préparé est `.local/security-publication-preview`. La publication forcée reste soumise à accord après présentation du résultat ; elle devra utiliser un verrou sur le SHA distant attendu et uniquement la branche `main`, jamais un push miroir du clone de travail. Après publication, vérifier depuis un nouveau clone du dépôt distant et remplacer les anciens clones. Les vues mises en cache relèvent, si nécessaire et selon ses critères d’éligibilité, du support GitHub. [Procédure officielle](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

## Vérifications exécutées et incident Defender clôturé

Avant la détection antivirus : compilation MSVC `/W4 /WX` réussie ; `npm test` réussi avec 41 tests natifs, coffre DPAPI fictif, inspection du profil fictif et 88 tests Node. Tests Electron réussis : CAS (9 scénarios, aucune soumission automatique), navigation (48 contrôles), cycle de session avec rendu logiciel, et import/annulation/refus/suppression/relecture/verrouillage du profil avec stockage simulé. Le précontrôle WFP et Electron a réussi après récupération des seules protections MyNEIGE résiduelles : IPv4/IPv6, UDP, enfants, sandbox, proxy, CAS, téléchargements et cycle de session. Aucun de ces résultats ne constitue une preuve d’isolation sur un VPN réel.

L’inspection en lecture seule du fichier personnel conservé a confirmé sa compatibilité technique, sans connexion. `npm start` a lancé le contrôleur et Electron, mais la recette d’import et de connexion réels n’a pas pu être achevée.

Defender a détecté `Trojan:Win32/Bearfoos.A!ml` sur l’auxiliaire de coffre puis sur le contrôleur de développement. Le contrôle en lecture seule rapporte `ActionSuccess=true`, `ThreatStatusID=3`, `IsActive=false` et `DidThreatExecute=true` ; le dernier champ indique que le fichier détecté a été exécuté, sans établir ce qu’il aurait fait de malveillant. Les deux fichiers étaient des copies du même contrôleur compilé, l’auxiliaire n’étant pas encore un exécutable distinct. Aucun processus MyNEIGE correspondant n’était encore actif lors de cette vérification.

Aucune exclusion, désactivation de protection, restauration ou soumission de fichier à un service externe n’a été effectuée. Une détection heuristique ne suffit pas à conclure à un faux positif. Microsoft propose une soumission en tant que développeur pour obtenir une analyse ; aucune n’a été nécessaire pour clôturer cet incident. [FAQ développeurs Microsoft](https://learn.microsoft.com/en-us/defender-xdr/developer-faq).

Au moment de la détection, les compilations et exécutions natives avaient été suspendues. Les vérifications statiques et les 91 tests JavaScript finaux avaient réussi sans exécuter les composants concernés. Le test de paquet distingue explicitement un refus natif attendu d’une impossibilité d’exécuter le contrôleur ; un blocage antivirus ne peut pas être compté comme un succès.

### Mise à jour du 30 octobre 2026 — résolution confirmée

L’utilisateur confirme que la redéfinition des fonctions du coffre et leur séparation dans un exécutable dédié ont permis de lever l’alerte Windows Defender. Le coffre conserve ses fonctions de protection locale des données et d’authentification Windows Hello, sans embarquer les fonctions de tunnel, de filtrage WFP ou de lancement de processus du contrôleur.

**L’incident Defender est clôturé.** Cette résolution repose sur la correction du périmètre du coffre et sur la confirmation de l’utilisateur ; elle ne constitue pas une qualification rétroactive de la détection initiale comme faux positif par Microsoft.

Cette clôture concerne uniquement l’alerte antivirus. Les validations fonctionnelles et réseau avec le profil personnel (connexion réelle, Hello, changements de profil et pertes VPN/relais) restent à suivre séparément. Aucune nouvelle distribution n’a été construite.

### Récidive du 2 novembre 2026 — séparation absente des sources

Pendant le développement du terminal SSH, Defender a de nouveau détecté `Trojan:Win32/Bearfoos.A!ml` sur la copie `myneige-vault.exe` d’une session, puis sur `.local/poc/myneige-poc.exe`. Le contrôle CIM en lecture seule a ensuite rapporté `ActionSuccess=true`, `ThreatStatusID=3` et `IsActive=false`. `DidThreatExecute=true` n’établit pas une activité malveillante particulière.

L’audit de l’état courant a révélé que `BrowserPilot::prepare` copiait toujours l’image du contrôleur sous le nom du coffre. Le commit de clôture du 30 octobre ne modifiait que cette documentation. Un ancien binaire de coffre distinct et son journal de compilation subsistaient dans `.local`, mais ses sources et les scripts de raccordement n’étaient pas présents dans le dépôt courant. Cette incohérence explique que la séparation annoncée ne soit pas effective ; elle n’établit pas à elle seule la cause du classement antivirus.

Après accord explicite du mainteneur, le correctif rétablit des sources versionnées sous `native/windows/vault/`, avec seulement les utilitaires locaux, le hachage et la validation du profil sous `native/windows/shared/`. Le contrôleur ne contient plus les points d’entrée du coffre. `scripts/build-vault.ps1` utilise une liste fermée de sources et contrôle les imports pour refuser sockets, WFP, WinHTTP et lancement de processus. Le staging exige ce vrai binaire et refuse une empreinte identique à celle du contrôleur. Les deux vérificateurs de manifeste exigent aussi le coffre séparé.

Les fichiers détectés n’ont été ni restaurés ni relancés. Aucun réglage Defender, exclusion, désactivation ou envoi du binaire à un service externe n’a été effectué. Les nouvelles compilations correspondent à ces sources corrigées. Les tests exécutés avant la récidive restent des preuves fonctionnelles limitées ; ils ne clôturent pas cet incident. Les contrôles effectués après correction sont consignés dans le guide de développement, sans qualification de faux positif par Microsoft.
