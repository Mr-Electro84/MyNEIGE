# État de validation du pilote Windows

23 octobre 2026. Les essais de l’agent concernent la machine de développement et les scénarios effectivement exécutés ; les retours utilisateur d’un autre poste sont identifiés séparément. J1 dispose maintenant de captures et d’une décision d’architecture ; sa recette complète reste ouverte. J2 a commencé, sans interface finale ni packaging.

## Résultats acquis

- Compilation MSVC x64 C++20, `/W4 /WX`, SDK Windows 26100 ; 27 tests de protocole natifs et 26 tests JavaScript réussis (53 au total), plus le test natif du coffre DPAPI avec données fictives.
- Connexion universitaire réelle : certificat serveur vérifié, `CONNECTED`, IPv4, passerelle et deux DNS poussés ; attente de `IpDadStatePreferred` avant autorisation du relais.
- DNS APPIGS UDP et TCP via le tunnel ; HEAD HTTPS avec certificat vérifié, réponse `302`, sondes répétées. La console ne suit pas les redirections et ne collecte pas de corps de page.
- Proxy sans secret refusé (`407`) ; autre exécutable explicitement lié au TAP refusé (`WSAEACCES` 10013).
- Suppression de la seule route créée par le pilote : requête bloquée ; restauration : HTTPS `302` retrouvé. L’interface physique n’est pas désactivée.
- Arrêt OpenVPN puis relais : requêtes bloquées ; nettoyage et comparaison routes/DNS à la référence réussis.
- Crash réel du contrôleur, code 86 : enfants terminés par Job, récupération ciblée et ancien port proxy fermé.
- Relais et Electron de niveau moyen, non administrateurs ; image non modifiable et contrôleur non terminable par la sonde restreinte.
- Précontrôle Electron réel : TCP IPv4/IPv6 refusé, UDP absent de récepteurs positivement testés, enfant confiné, renderer sans Node et permis proxy seul.

## Captures J1

Preuves dans `.local/j1/`, exclu de Git. Ne pas publier sans examen. Pktmon capture au plus 96 octets par paquet, avec filtres DNS/443/STUN/ICMP ; les ports éphémères management/proxy ne sont pas sélectionnés. Les exports sont associés aux GUID des Miniport, sans prendre les filtres NDIS pour des cartes physiques. Les trames Wi-Fi natives mal étiquetées Ethernet par l’export sont décodées explicitement.

| Exécution locale | Preuves et limites |
| --- | --- |
| `20261023-000127-73c87e44` | Deux TAP de GUID différents, LUID/index réutilisés par Windows ; session normale puis crash contrôleur. Observations : web 33, DNS UDP/TCP 1/6 sur TAP ; transport VPN physique 80 ; zéro flux physique interdit identifié. Témoin ordinaire non positivement capturé : analyse globale incomplète pour R2, malgré les preuves acquises de crash/récupération. |
| `20261023-001633-f49f96ae` | Témoin `curl` visible après fermeture seulement ; ne valide pas R2 pendant le VPN. Analyse incomplète. |
| `20261023-001914-985e7eec` | Fenêtre stable 30 s ; web 47 et DNS UDP/TCP 3/1 sur TAP ; transport OpenVPN physique 104. `curl` vers la même destination : 3 observations physiques pendant le VPN actif, zéro sur TAP. Zéro flux physique interdit identifié ; routes/DNS restaurés, zéro événement/buffer de capture perdu, sortie native 0. Analyse `passed_for_observed_scope`. |

Ces comptes sont des observations par composant, pas un comptage dédupliqué des échanges. Le témoin `curl` utilise la route habituelle, sans proxy ni adresse/interface source forcée ; seul son port source est choisi pour rapprocher la capture. Son accès direct à APPIGS expire sans réponse : la preuve concerne son chemin physique, pas l’accessibilité publique du site.

L’analyse exige des contrôles positifs web, DNS, transport VPN et témoin pendant la session. Les ensembles incomplets gardent un code d’analyse non nul. Ces captures ne permettent pas de conclure sur les transitions non exécutées.

## Matrice de recette

| ID | État au 23 octobre |
| --- | --- |
| R1 | HEAD APPIGS et certificat réussis, chemin TAP capturé, zéro sortie directe correspondante identifiée. Navigation complète distincte. |
| R2 | Réussi pendant le scénario stable 30 s : `curl` simultané physique, aucun paquet témoin sur TAP. |
| R3 | Comparaisons natives pendant la session et routes/DNS avant/après réussies. Le code ne configure aucun proxy système ; recette de toutes les applications tierces non exhaustive. |
| R4 | UDP et TCP réels liés et capturés sur TAP ; TCP forcé pour l’essai, sans troncature naturelle provoquée sur le DNS réel. |
| R5 | Arrêt réel OpenVPN et perte/restauration de la route propre : blocage observé/capturé. Transfert volumineux prolongé non testé. |
| R6 | Arrêt relais et crash contrôleur exécutés ; enfants morts, récupération et fermeture du port vérifiées. Crash Electron à chaque étape encore à couvrir. |
| R7 | Partiel : perte de route propre testée. Changement physique de réseau, veille et VPN tiers non exécutés. |
| R8 | Blocage réel TCP IPv4/IPv6 et UDP, enfant Electron, contrôles positifs. API WebRTC/HTTP3 et scénarios média à compléter ; IPv6 hôte conservé. |
| R9 | Proxy sans secret refusé ; management secret/PID, pipe Electron authentifié par PID. Campagne adverse exhaustive du pipe à compléter. |
| R10 | GUID renouvelés entre sessions, anciens enfants/ports fermés ; IP VPN différentes observées entre recettes. Changement effectif des DNS et reprise interactive complète non qualifiés. |
| R11 | Parseurs/classement d’erreurs testés avec données fictives ; pas de campagne réelle de mauvais mots de passe/MFA ni de contournement TLS. |
| R12 | VPN réel, préremplissage des deux champs CAS et accès APPIGS après clic manuel confirmés par l’utilisateur. Popups, challenges/MFA et captures du parcours navigateur à compléter. |
| R13/R14 | Crash contrôleur et récupération propres acquis ; autres étapes, concurrence et reprise à compléter. |
| R15 | Différé avec packaging J3. |
| R16 | Aucun fichier/argument de credentials ni trace management brute volontairement produit. Caches Chromium sous `.local/` ; aucune garantie d’effacement de toutes les copies mémoire/OS. |

## Début de J2

Formulaire local, bridge limité, pipe authentifié par PID et session web séparée implémentés. Les images Electron sont copiées dans un répertoire de session protégé ; la quarantaine précède le démarrage de l’arbre de processus. Le preload isolé CAS de l’extension J2 n’expose aucune API au site ; sandbox, isolation de contexte et TLS restent actifs. Le seul permis réseau est le proxy TCP local de la session avec secret éphémère.

L’essai local complet passe : réponse `407`, authentification du proxy et début TLS réellement reçus, puis fermeture volontaire du transport sans serveur distant. Il couvre une correction nécessaire : la règle de résolution Chromium doit exclure l’adresse numérique du proxy `127.0.0.1`, sans ajouter de permis WFP.

L’essai réel via formulaire établit le VPN et obtient le HEAD HTTPS `302`, puis charge CAS : `BROWSER_PAGE host=cas.univ-avignon.fr status=200`. L’utilisateur confirme que la page CAS est affichée et indique n’avoir pas testé la connexion ENT. Un statut APPIGS `200` est également observé dans les diagnostics, mais il ne démontre pas à lui seul un parcours authentifié : aucune page étudiante ni donnée de compte n’a été inspectée. Domaines observés : `www.appigs.univ-avignon.fr`, `cas.univ-avignon.fr` ; navigation/ressources annexes : `dosi.univ-avignon.fr`, `services.univ-avignon.fr` (une réponse `404`) et `stats-web2.univ-avignon.fr`. Leur nécessité pour le parcours authentifié n’est pas établie.

Fermeture réelle du formulaire : processus arrêtés, requêtes après perte VPN puis relais bloquées, nettoyage et comparaison finale du réseau réussis, sortie `0`. Diagnostics : `.local/browser/live-session.txt`, `.local/browser/exit-code.txt`. Le précontrôle local complet est dans `.local/poc/browser-test.txt`. Les captures J1 ci-dessus concernent le mode console ; une capture complète du parcours navigateur/CAS reste à acquérir.

La politique provisoire de navigation admet HTTPS/WSS 443 pour `univ-avignon.fr` et ses sous-domaines. Les domaines exacts du parcours doivent être identifiés avant resserrement. Permissions et ouvertures externes refusées ; téléchargements admis dans la même session après contrôle de provenance et redirections. Le préremplissage autorisé en J2 est plus strict : origine CAS exacte et service APPIGS uniquement ; le clic reste manuel.

### Extension J2 — préremplissage CAS

Implémentation et contrat dans [CAS_PREFILL.md](CAS_PREFILL.md). Les cinq tests Node supplémentaires passent. Neuf scénarios Chromium passent avec les mêmes fenêtres, preload et gestion IPC que le pilote réel : remplissage et caractères spéciaux, conservation des champs cachés/cookies, zéro soumission automatique, renderer sans Node/bridge, refus d’autres origines/services/actions, de saisies existantes, de doublons, d’un état de flux absent et des sous-cadres, annulation et non-réutilisation après rechargement. Exécutés via `browser:test` sous WFP (sortie 0), puis via le lanceur sans UAC `test:cas` (sortie 0). Aucun compte réel utilisé par ces tests ; aucun jeton du HTML utilisateur copié dans les fixtures.

L’essai réel atteint CAS `200`, produit `BROWSER_CAS_PREFILL status=PREFILLED`, puis APPIGS `200`. Le contenu des champs n’est pas lu par le diagnostic. L’utilisateur confirme explicitement les deux champs préremplis et l’accès APPIGS après son clic sur « SE CONNECTER ». Le parcours normal VPN → CAS prérempli → clic manuel → APPIGS est donc acquis sur cette machine. Fermeture réelle : pertes VPN/relais bloquées, nettoyage et comparaison réseau réussis, sortie `0`. Les diagnostics locaux sont `.local/browser/live-session.txt` et `.local/browser/exit-code.txt` ; le profil source reste inchangé.

### Extension J2 — menus, fichiers et avertissement

[Contrat et mode d’emploi](J2_NAVIGATION_DOWNLOADS.md). Menu natif Précédent/Suivant/Accueil APPIGS, raccourcis et suivi des téléchargements ajoutés aux fenêtres protégées. Sauvegarde par Chromium avec destination choisie ; prise en charge HTTPS et `blob` de même origine, contrôle des redirections et noms proposés, annulation sur fermeture/blocage, aucune ouverture automatique. L’avertissement de connexion est affiché avant les champs et a été vérifié visuellement sans identifiants.

Six tests Node supplémentaires passent. Les douze vérifications Chromium passent : historique précédent/suivant, accueil dans la même session, téléchargement fictif HTTPS avec contenu comparé et magasin de cookies conservé, suivi, fichier `blob`, annulation d’un transfert réel en cours ; POST vers un nouveau pop-up, préparation d’une fenêtre vide par JavaScript, réutilisation d’une fenêtre nommée, maintien de sa session et de son isolation, refus des ouvertures hors politique. Réussite sans UAC (`test:browser`), puis sous WFP (`browser:test`, code 0). Le test utilise des réponses locales interceptées et des fichiers sous `.local/` ; il ne prouve pas la transmission des cookies à un serveur distant. Le préremplissage CAS est aussi retesté sous WFP, avec ses neuf scénarios réussis.

La recette réelle confirme le fonctionnement des menus et l’enregistrement d’un fichier exporté par APPIGS dans un pop-up séparé. Après correction du contrôleur de fenêtres, le journal observe `BROWSER_DOWNLOAD status=STARTED`, puis `COMPLETED` ; l’utilisateur confirme explicitement « Oui, fichier enregistré avec succès ». Aucun contenu de fichier universitaire n’a été inspecté. La session a ensuite été fermée proprement (sortie 0), avec blocage des requêtes après arrêt du VPN puis du relais et nettoyage final réussi. Diagnostics locaux : `.local/browser/live-session.txt` et `.local/browser/exit-code.txt`.

Le premier essai avait révélé l’échec des exports en pop-up : le contrôleur recréait ces fenêtres avec `loadURL`, ce qui perdait les POST et le lien avec la page d’origine. La correction conserve la création native Chromium tout en appliquant la session et les protections du pilote. Les cinq scénarios de pop-up ajoutés couvrent cette régression. Cette première session avait été fermée proprement (sortie 0).

### Extension J2 — identifiants Windows et préparation d’OpenVPN

[Fonctionnement et limites](J2_CREDENTIALS_SETUP.md). Enregistrement facultatif des identifiants après connexion VPN confirmée, protection DPAPI en portée utilisateur, lecture précédée d’une vérification native Windows Hello, suppression sans déverrouillage et commande indépendante `credentials:forget`. Auxiliaire natif protégé en écriture et sans permis réseau ; opérations réservées au formulaire local.

Le test natif avec données fictives réussit : aller-retour DPAPI, refus d’un fichier altéré et suppression répétée. Cinq tests Node supplémentaires réussissent. Le précontrôle WFP vérifie l’appel réel du statut natif depuis le formulaire, sans aucun retour d’identifiants ; CAS et les douze scénarios de navigation/téléchargements passent aussi (sortie 0). La détection d’OpenVPN existant, la vérification du MSI officiel en cache et le refus d’un faux MSI sont exécutés avec succès, sans nouvelle installation.

Premier essai utilisateur : enregistrement confirmé explicitement, puis fermeture du formulaire ; fin propre de la session, blocage après arrêt VPN/relais et sortie 0. Au second lancement, l’utilisateur confirme la demande Windows Hello puis le fonctionnement VPN/CAS sans ressaisie des identifiants VPN. CAS produit `PREFILLED` et APPIGS répond 200. Cette seconde session est également fermée proprement, avec blocage après arrêt VPN/relais et sortie 0. L’utilisateur confirme ensuite explicitement la recette du bouton de suppression : message de suppression sans demande Hello et bouton de connexion Hello désactivé. Le parcours réel enregistrement → réutilisation après Hello → suppression est donc confirmé sur cette machine. Aucun identifiant ni contenu du coffre réel n’a été lu par l’agent. Le test natif de suppression avec données fictives est également acquis ; aucun nouveau lancement après suppression n’est revendiqué par cette confirmation.

Installation fraîche sur VM sans OpenVPN, redémarrage requis et annulation du MSI/UAC non exécutés. Le lancement retient l’identité du bureau interactif plutôt que celle d’un autre administrateur saisi pour l’UAC ; ce cas avec deux comptes distincts reste à qualifier. Aucun succès n’est attribué à ces scénarios sur la seule base des tests locaux.

Après essai utilisateur suivant une désinstallation, la capture montre un arrêt générique sans proposition d’installation. Le parcours a été corrigé : états absent/incomplet/incompatible séparés, proposition d’installation pour les deux premiers, détection d’architecture indépendante du registre d’environnement, transmission structurée de la cause et de l’étape d’erreur, progression MSI visible et commande `npm run openvpn:install`. Les 22 contrôles PowerShell couvrent l’orchestration avec effets simulés, plus un vrai refus de faux MSI avec résultat JSON et la lecture du code produit du paquet officiel en cache. L’installation compatible présente dans l’environnement de l’agent est toujours reconnue. L’utilisateur indique avoir déjà réinstallé OpenVPN et reporte le nouvel essai d’absence ; le correctif n’est donc pas encore confirmé par une nouvelle installation réelle.

L’utilisateur précise ensuite que les deux signalements d’installation concernent un autre PC. Le changement de chemin du dépôt sur la capture n’est pas retenu comme cause. Son nouveau journal échoue au début du téléchargement. Reproduction exacte sur la machine de développement sous Windows PowerShell 5.1 : l’adresse `swupdate.openvpn.org` provoque `InvalidOperationException` avec « L’opération n’est pas valide en raison de l’état actuel de l’objet » lorsque la redirection est interdite. La réponse HTTP observée séparément est un 301 vers `swupdate.openvpn.net`. L’adresse canonique `.net` télécharge directement le MSI dont l’empreinte correspond à la référence.

Correction : adresse canonique utilisée, refus des redirections maintenu, vérifications SHA-256/signature inchangées et diagnostic enrichi du type et de la ligne de l’exception. Le nouveau test `test-openvpn-setup.ps1 -FreshDownload` part d’un dossier vide et appelle le vrai script sous Windows PowerShell 5.1, sans utiliser le MSI en cache : téléchargement terminé, empreinte attendue, signature valide et nettoyage des fichiers partiels réussis. Les 28 contrôles passent sur ce poste ; aucun MSI n’a été exécuté. L’installation complète sur le second PC reste à confirmer après ce correctif.

Retour suivant du second PC : le téléchargement réussit, le MSI atteint son code de réussite, puis le contrôle affiche « Moteur ou pilote TAP absent apres installation ». L’utilisateur confirme qu’OpenVPN apparaît dans les applications installées. Le journal ne prouve donc pas une absence du produit ; le blocage est la vérification après MSI. Un défaut du contrôle est identifié : il exigeait un service TAP et un fichier sous `System32\drivers`, alors que le paquet peut être seulement préparé dans le magasin de pilotes Windows.

Correction : interrogation SetupAPI du magasin de pilotes sans création d’adaptateur, avec correspondance exacte des identifiants TAP ; prise en compte des chemins `exe_path`/`bin_dir` du registre OpenVPN. Les contrôles natifs de signature/version sont conservés. La validation finale a lieu dans le parent et préserve le détail du composant en échec au lieu de remonter seulement le code 1 du travailleur élevé. Nouveau mode `-Diagnose` sans installation ni VPN. Sous Windows PowerShell 5.1, les 33 contrôles passent sur le poste de développement et le diagnostic réel renvoie `Ready`, contrôle natif 0 et INF TAP présent. L’utilisateur reporte son nouvel essai ; la reconnaissance et le démarrage sur le second PC après ce dernier correctif restent à confirmer.

Nouveau retour du second PC (« erreurs post installation OpenVPN bis ») : le détail indique `controle_natif=2` et reproduit l’aide de MyNEIGE. Ce résultat révèle un exécutable natif qui ne reconnaît pas la commande `openvpn-check`, et non un échec de vérification cryptographique établi. Les scripts mis à jour utilisaient une ancienne compilation sous `.local/poc`, non reconstruite par le simple lancement du programme.

Correction : protocole explicite de compatibilité scripts/pilote, vérifié avant la détection et avant toute installation. `npm start` et `npm run openvpn:install` reconstruisent un pilote absent/ancien, puis vérifient le nouveau binaire ; les modes diagnostic et le travailleur élevé restent sans compilation. Une réponse native inattendue produit désormais une erreur MyNEIGE distincte d’un refus de signature OpenVPN. Les contrôles de signature, éditeur, version et empreinte restent actifs. Capture stderr adaptée aux objets ErrorRecord de PowerShell 5.1.

Validation locale : compilation MSVC réussie, 48 contrôles de préparation sous Windows PowerShell 5.1, 27 tests natifs et 26 tests Node réussis. Les scénarios d’ancien pilote/reconstruction/échec de compilation sont simulés ; le protocole du nouveau binaire et le refus d’un fichier fictif non signé sont exercés réellement. Le diagnostic de l’installation existante renvoie `Ready`, `OPENVPN_COMPATIBLE` et le paquet TAP présent. Aucun MSI ni VPN lancé pour cette validation. La confirmation après mise à jour et recompilation sur le second PC reste attendue.

### Extension J2 — menu Université et logo Electron

Le GO utilisateur couvre les cinq liens universitaires et l’association du logo fourni aux fenêtres Electron. Le menu Université charge les adresses exactes ENT, Annuaire (VPN), Gestionnaire de projets (VPN), E-UAPV/Moodle et EDT dans le WebContents principal initialement ouvert sur APPIGS, y compris lorsqu’il est déclenché depuis un pop-up. Cookies, historique, session et protections sont conservés. Les mentions VPN sont informatives ; aucun accès direct ni élargissement des domaines autorisés n’a été introduit.

Icône Windows multi-résolution générée depuis le PNG source, script reproductible fourni et icône appliquée au formulaire et aux fenêtres protégées. Les ressources sont copiées dans le staging natif protégé en lecture seule. Nom applicatif et identité de barre des tâches définis ; aucun packaging ni modification des ressources intégrées de `electron.exe`.

Validation du 23 octobre 2026 : compilation MSVC, 27 tests natifs, 26 tests Node et test DPAPI avec données fictives réussis (`npm test`, sortie 0). Neuf scénarios CAS sans soumission automatique et 22 vérifications Chromium réussis (`test:cas` et `test:browser`, sorties 0). Les dix ajouts Chromium contrôlent l’icône lisible, les cinq destinations exactes dans le même WebContents/session, l’historique entre services, le refus sans VPN, le ciblage du principal depuis un pop-up et le refus après sa fermeture. Précontrôle `browser:test` également réussi sous WFP (sortie 0), en utilisant les ressources et le code copiés par le contrôleur natif ; aucune connexion VPN ni compte universitaire utilisés.

La première exécution des tests dans le bac à sable de l’agent empêchait le démarrage d’Electron et le nettoyage du dossier temporaire DPAPI ; les commandes ont ensuite été exécutées avec succès hors de ce bac à sable, sans désactiver la sandbox Chromium ni les protections du pilote. Vérification visuelle sur une page fictive locale : logo présent dans la barre de titre, menu Université et cinq libellés présents. Accès réel aux cinq services, parcours SSO associés et affichage des regroupements/épinglages de barre des tâches encore à confirmer par l’utilisateur. Le PNG d’origine a été conservé.

## Environnement et intégrité

- Windows x64 build 26200.9457 ; MSVC 14.44, SDK 10.0.26100.0 ; Electron 45.0.0 épinglé.
- OpenVPN Community 2.7.8-I001 x64 et TAP ; OpenVPN/tapctl signés par OpenVPN Inc., version observée 2.7.8.0. Aucune GUI OpenVPN ni service automatique sélectionné.
- MSI vérifié SHA-256 : `1EA61A3056905B90607D4B0F084C04E5CF3043E07CF192D9CD44B0474F29CC49`.
- Profil source inchangé SHA-256 : `69869F29FBFE23A7A583C304065ACAB39A2189B5756EEFD7F27BCC1D5BC2DE2E`.

## Décision et suite

Poursuivre le modèle natif, conformément à la [décision d’architecture](ARCHITECTURE_WINDOWS.md). Les captures contrôlées soutiennent sa faisabilité sur cette machine. **J1 n’est pas déclaré entièrement clos** tant que ses scénarios critiques ouverts ne sont pas exécutés ou que leur exclusion n’est pas décidée explicitement. Le nouveau GO autorise le début expérimental de J2 ; interface finale, packaging et Linux restent différés.

### Recette restante avant clôture complète de J1

Sur une machine disponible pour interrompre son réseau, répéter les relevés/captures physique et TAP avant, pendant et après chaque cas : changement Wi-Fi/Ethernet, disparition de la route physique, veille/reprise, puis coexistence avec un VPN tiers réellement configuré. Vérifier un témoin ordinaire vers la même destination et des requêtes DNS UDP/TCP neuves. Critères : blocage MyNEIGE avant toute sortie directe, aucune utilisation du TAP par le témoin, aucune modification persistante des paramètres étrangers, reprise uniquement après une nouvelle session validée. Un échec de disponibilité du témoin imposé par le changement physique doit être distingué d’un détournement de son trafic.

Ces manipulations n’ont pas été exécutées sur le poste courant ; aucun succès ne leur est attribué. Compléter aussi R10 avec paramètres DNS réellement différents et, en J2, le parcours ENT manuel avec captures, popups et refus de destinations hors politique. Un VPN tiers et un réseau de remplacement doivent être disponibles pour ces essais ; le pilote ne les crée ni ne les configure à la place de l’utilisateur.
