# Plan d’exécution — MyNEIGE, navigateur universitaire avec VPN isolé

Révision : 23 octobre 2026.

**Statut : GO initial pour le pilote Windows, puis GO pour poursuivre J1 et commencer J2. Interface finale, packaging et Linux différés.**

Extension J2 autorisée le 23 octobre : réutiliser temporairement les identifiants VPN pour préremplir la vraie page CAS. Validation du formulaire laissée à l’utilisateur ; aucune soumission automatique. Détails : [docs/CAS_PREFILL.md](docs/CAS_PREFILL.md).

Extension J2 suivante : téléchargements Chromium dans la session protégée, choix de destination, suivi/annulation, menu natif Précédent/Suivant/Accueil et avertissement de connexion. [Contrat et tests](docs/J2_NAVIGATION_DOWNLOADS.md).

Extension J2 autorisée ensuite : enregistrement facultatif DPAPI par utilisateur, réutilisation après vérification native Windows Hello et suppression sans déverrouillage ; préparation et installation assistées d’OpenVPN Community lorsqu’il manque. [Implémentation et recette](docs/J2_CREDENTIALS_SETUP.md). Le contrôle Hello applicatif ne constitue pas une liaison cryptographique de la clé DPAPI à Hello.

Recette de cette extension : enregistrement réel puis réutilisation après Windows Hello, VPN et CAS sans ressaisie VPN confirmés par l’utilisateur sur deux lancements ; fermeture propre des deux sessions. Suppression de l’enregistrement réel sans demande Hello et désactivation du bouton de connexion Hello confirmées par l’utilisateur ; suppression DPAPI également vérifiée avec données fictives. Précontrôle WFP et régressions navigateur réussis. Détection du moteur installé, paquet officiel et faux paquet testés ; installation sur Windows propre et UAC avec un autre administrateur encore à qualifier.

Retour de recette installation : proposition absent/incomplet corrigée après un essai suivant désinstallation ; erreurs détaillées, progression MSI et commande d’installation dédiée ajoutées. Vingt-deux contrôles PowerShell du parcours passent sans exécuter de MSI. La nouvelle installation réelle reste à confirmer séparément.

Les signalements concernent un autre PC. Le journal suivant a permis de reproduire un défaut réel du téléchargement neuf sous Windows PowerShell 5.1 : redirection du serveur `.org` vers `.net` refusée par le script. Adresse canonique corrigée ; test sans cache ajouté, avec téléchargement et validation SHA-256/Authenticode réels (28 contrôles réussis ici), sans exécution du MSI. La confirmation de l’installation complète sur le second poste reste ouverte.

Le code du pilote et son mode d’emploi figurent dans [README.md](README.md) et [docs/POC_WINDOWS.md](docs/POC_WINDOWS.md). Les résultats réellement obtenus sont consignés dans [docs/POC_STATUS.md](docs/POC_STATUS.md). Un prototype compilé ne vaut pas démonstration d’isolation complète.

Le pilote crée un TAP dédié, applique sa quarantaine avant OpenVPN et contrôle les sorties par WFP et liaison explicite des sockets. Le mode console utilise WinHTTP ; le début de J2 ajoute un formulaire et une session Electron protégée. Relais et Electron utilisent désormais des jetons restreints de niveau moyen. Le packaging reste différé.

**Résultat au 23 octobre : VPN réel, DNS UDP/TCP et HTTPS APPIGS `302` ; captures physique/TAP, application témoin simultanée, perte/restauration de la route propre, arrêt VPN/relais et crash brutal du contrôleur exécutés. Précontrôle Electron IPv4/IPv6/UDP, enfant, sandbox et authentification du proxy par Chromium réussis. Les 53 tests de protocole natifs/JavaScript passent, ainsi que le test natif DPAPI avec données fictives ; neuf scénarios CAS et douze vérifications de navigation/téléchargements passent dans Chromium, dont sous WFP. J2 : préremplissage réel CAS, accès APPIGS après clic manuel, menus et enregistrement d’un fichier exporté en pop-up confirmés par l’utilisateur ; avertissement de connexion ajouté et vérifié visuellement. La clôture complète de J1 reste conditionnée aux cas non exécutés, notamment R7.**

## 1. Verdict et état de la validation

Le projet est techniquement faisable, avec une intégration réseau spécifique à chaque plateforme. Le profil fourni rend crédible une connexion par identifiant et mot de passe sans certificat client. Il ne prouve ni le fonctionnement actuel du serveur, ni les droits du compte, ni l’accès au site cible.

L’exigence la plus difficile reste l’isolation : un proxy Node.js utilisant `localAddress` avec `route-nopull` ne suffit pas à la démontrer. Le premier jalon après GO sera une preuve de fonctionnement réseau, avant l’interface complète et le packaging.

L’analyse initiale repose sur la lecture du dépôt, l’extraction locale des métadonnées du certificat et la documentation technique. L’état des essais du pilote est désormais suivi séparément dans le rapport de validation ; les observations statiques ci-dessous ne sont pas des résultats de connexion.

État au démarrage : Electron 45.0.0 et Node 24.22.1 présents, OpenVPN absent. État actuel : moteur signé OpenVPN Community 2.7.8-I001 et TAP installés, runtime Electron 45.0.0 épinglé, séparation des privilèges et confinement initial Electron implémentés. Aucun installateur applicatif.

## 2. Analyse du profil fourni

Fichier source : `VPN_Universite_Avignon.ovpn`, à conserver intact.

SHA-256 du fichier analysé : `69869F29FBFE23A7A583C304065ACAB39A2189B5756EEFD7F27BCC1D5BC2DE2E`.

### 2.1 Observations locales confirmées

| Élément | Contenu observé | Conséquence |
| --- | --- | --- |
| Interface | `dev tun` | Tunnel IP de niveau 3. Un pilote Windows nommé TAP peut néanmoins porter ce mode TUN. |
| Serveur | `remote vpn.example.test 443 tcp-client` | OpenVPN sur TCP 443 ; ce port ne signifie pas que le service est HTTPS. |
| Mode | `tls-client`, `client` | Le serveur peut fournir des options après connexion. |
| Identifiants | `auth-user-pass`, sans argument | Saisie dynamique prévue, sans fichier de mots de passe référencé. |
| Certificat client | Aucun bloc/fichier `cert`, `key` ou `pkcs12` | Compatible avec l’absence de certificat client ; à confirmer avec le serveur. |
| Indication additionnelle | `setenv CLIENT_CERT 0` | Variable personnalisée cohérente avec cette intention ; elle ne désactive pas une exigence serveur. |
| Autorité | Bloc `<ca>` intégré | Certificat public d’autorité présent ; aucune clé privée ni mot de passe dans le fichier. |
| Vérification du pair | `remote-cert-tls server` | Vérification du rôle serveur prévue ; aucun nom X.509 précis n’est explicitement fixé. |
| Chiffrement annoncé | `ncp-ciphers AES-128-GCM:AES-128-CBC`, `cipher AES-128-CBC`, `auth SHA256` | Ancienne nomenclature ; prévoir une normalisation contrôlée. Le chiffrement négocié reste inconnu. |
| Reconnexion | `persist-tun`, `persist-key`, `resolv-retry infinite` | Prévoir annulation et délais applicatifs ; une interface présente ne signifie pas un tunnel opérationnel. |
| Routes et DNS | Aucun DNS, route, passerelle ou `redirect-gateway` explicite | Ces paramètres peuvent être poussés par le serveur. |
| Autres éléments | Aucun script, plugin, compression, `tls-auth` ou `tls-crypt` déclaré | Aucune dépendance externe de ce type visible ; ne pas en inventer. |

### 2.2 Certificat d’autorité

- Sujet et émetteur : `CN=Openvpn_CA, C=FR, S=Avignon, L=Avignon, O=Universite Avignon`.
- Période déclarée : du 27 juin 2020 à 13:38:06 UTC au 25 juin 2030 à 13:38:06 UTC.
- Clé publique RSA de 3072 bits ; signature `sha256RSA` ; contrainte d’autorité présente.
- Aucune clé privée associée dans le fichier.

Au 22 octobre 2026, la date actuelle est comprise dans cette période. Cela n’atteste ni la provenance du profil, ni la validité du certificat effectivement présenté par le serveur, ni sa non-révocation. Conserver les vérifications TLS. Un éventuel `verify-x509-name` demandera le nom attendu fourni par une source universitaire fiable ; ne pas l’inventer à partir du nom DNS.

### 2.3 Inconnues à lever au premier jalon

- Disponibilité du serveur et droits du compte VPN ; éventuel second facteur/challenge.
- Versions et chiffrements acceptés, IP, topologie et passerelle attribuées.
- DNS, routes et autres paramètres poussés, y compris lors des reconnexions.
- Résolution et accès à APPIGS ; éventuelles restrictions aux seules ressources universitaires.
- Redirections, domaines et parcours de connexion web ENT/CAS.

## 3. Contrat fonctionnel et réseau

1. URL initiale : `https://www.appigs.univ-avignon.fr/extranet/etu_suivi.html`.
2. Les requêtes web de la fenêtre protégée et leur résolution DNS passent dans le VPN.
3. Les autres applications conservent leur routage effectif et leur DNS habituel, y compris lorsqu’elles visitent le même site universitaire.
4. La perte du VPN ou du proxy bloque les requêtes et ferme les flux existants, sans repli direct.
5. Le proxy local refuse les clients non autorisés par la session MyNEIGE.
6. Le transport OpenVPN vers le serveur utilise nécessairement le réseau physique. La résolution initiale du serveur VPN est un trafic d’amorçage distinct du DNS de navigation ; elle peut utiliser le DNS habituel avant création du tunnel.
7. Aucun changement du proxy système, du DNS global, ni remplacement/suppression des routes par défaut physiques. Aucune route universitaire prioritaire ajoutée dans la table partagée de l’hôte.
8. Des ressources propres au VPN sont nécessaires : interface, filtrage et éventuellement routes transitoires. Une table de routage entièrement inchangée n’est pas promise par une architecture utilisant une interface VPN système.

La garantie vise l’acheminement applicatif et l’absence de détournement des autres applications. Elle ne prétend pas résister à un administrateur local hostile capable de modifier le système.

### Périmètre proposé

- Windows d’abord ; Windows 11 x64 proposé comme référence compte tenu de l’environnement actuel.
- Linux conservé dans le périmètre, avec un jalon et une distribution LTS de recette distincts.
- Connexion VPN et connexion web séparées : le formulaire fournit les identifiants à OpenVPN ; le site peut ensuite demander une connexion ENT/CAS dans la fenêtre protégée.
- Aucune connexion web automatique ni réutilisation des cookies d’un navigateur externe promise.
- Aucun secret dans le code, les arguments de processus, l’environnement, les fichiers temporaires ou les journaux.
- Aucun accès Internet général promis si le VPN ne l’autorise pas ; une destination requise mais inaccessible produit une erreur, sans secours direct.

## 4. Moteur OpenVPN et profil d’exécution

### Versions et compatibilité

Cibler un OpenVPN Community maintenu et corrigé, avec 2.7 comme branche de départ proposée ; figer la version exacte après essai. Wintun et `--windows-driver` ont été retirés dans cette branche : le pilote sera choisi et testé avec le moteur retenu [S1]. CBC peut empêcher l’emploi de DCO ; prévoir le pilote de repli compatible.

Conserver la branche Electron 45 du dépôt, sélectionner ses correctifs maintenus et verrouiller les dépendances au démarrage du développement. Ne pas revenir à Electron 33 ni figer les anciennes versions du plan initial.

### Normalisation contrôlée

Produire un profil dérivé sans secret, sans modifier la source. Charger uniquement des directives admises ; aucun script/plugin/import arbitraire exécuté avec des privilèges.

| Élément | Traitement prévu |
| --- | --- |
| `ncp-ciphers` | Remplacer par `data-ciphers AES-128-GCM:AES-128-CBC` en conservant initialement la liste fournie. |
| `cipher AES-128-CBC` | Ne pas compter sur cette directive seule pour la négociation moderne. |
| Compatibilité ancienne | Fallback explicite uniquement si un diagnostic prouve sa nécessité ; aucun abaissement automatique de sécurité. |
| CA et rôle serveur | Préserver les vérifications ; aucune option ignorant les erreurs TLS. |
| Persistance | Adapter au contrôleur et invalider les flux à chaque génération de tunnel. |

Les différences de négociation sont documentées dans [S2]. Un `AUTH_FAILED` peut aussi résulter d’un désaccord de chiffrement : ne pas afficher systématiquement « mot de passe incorrect ».

### Routes et DNS poussés

Distinguer collecte des paramètres et application à l’OS. `route-nopull` refuse certaines options utiles ; `route-noexec` laisse le contrôleur gérer les routes [S2]. Leur combinaison exacte dépendra de la plateforme.

- Recueillir les paramètres nécessaires en mémoire par un mécanisme supporté, sans conserver de traces brutes susceptibles de contenir des secrets.
- Ne pas inventer DNS ou passerelle lorsque les options ont été écartées ; obtenir une configuration fiable ou bloquer avec un diagnostic.
- Empêcher l’application à l’hôte des options DNS modernes et anciennes, redirections et scripts incompatibles. Les filtres de push ne suffisent pas comme frontière de sécurité [S2].
- Linux peut appliquer les routes dans son espace privé. Windows confie les changements admis au contrôleur réseau.

## 5. Architecture réseau

```text
Formulaire local Electron
    -> IPC limité -> contrôleur -> canal management OpenVPN protégé

Fenêtre web, session Electron dédiée
    -> proxy HTTP local authentifié
    -> relais et résolveur DNS dans le périmètre réseau isolé
    -> interface VPN -> serveur universitaire -> APPIGS / ENT / CAS

Autres applications -> réseau et DNS habituels
Transport extérieur OpenVPN -> réseau physique -> vpn-etus:443/TCP
```

Electron reste non privilégié. Un auxiliaire distinct prépare et supervise le réseau ; relais et résolveur utilisent les droits minimaux possibles. Le contenu web n’accède jamais au contrôle VPN ni à une commande système.

### 5.1 Windows : prototype natif obligatoire

Choix proposé : auxiliaire C++/Win32 construit avec le SDK Windows pour le contrôle réseau, WFP et les sockets du relais. Ce travail dépasse les modules JavaScript du plan initial.

La sélection par adresse source dépend du modèle d’hôte et des routes disponibles [S3]. `IP_UNICAST_IF` choisit une interface de sortie [S4] ; il ne crée pas de route.

Le prototype doit démontrer :

1. Identification de l’interface par son identité système et son IP, sans choisir la première adresse privée rencontrée.
2. Sockets web/DNS liées à l’adresse et l’interface VPN, sans retry physique.
3. Route utilisable par ces sockets sans détourner l’hôte. Une route VPN supplémentaire de moindre priorité est une piste à tester, pas une solution acquise : elle reste globale et ne doit jamais devenir un secours pour les autres applications.
4. Filtrage WFP autorisant uniquement les composants prévus dans le tunnel et interdisant au relais/DNS la sortie physique [S5]. Ne pas confondre identité d’exécutable et identité d’une instance/session.
5. Processus réseau Electron limités au proxy local, sans sortie Internet directe. Démarrage sous restrictions et identification des enfants inclus dans le prototype.
6. Protections installées avant navigation ; flux fermés avant retrait des règles. Un crash du contrôleur ne doit pas libérer un processus survivant capable de sortir directement.
7. Comportement inchangé des applications tierces lors des changements réseau, pertes de route et reconnexions.

Si ce modèle échoue, revoir l’isolation avant de développer l’interface complète. Un compartiment réseau Windows distinct constitue une alternative à étudier, dont l’intégration OpenVPN reste à prouver. Ne pas dégrader la solution en routes globales prioritaires par destination et ne pas présenter l’alternative comme déjà validée.

### 5.2 Linux : espace réseau privé

Placer OpenVPN, relais et résolveur dans un espace réseau dédié avec ses routes et règles propres [S6]. Electron reste dans son espace habituel.

- Donner au transport OpenVPN un accès restreint au serveur, sans déplacer l’interface physique de l’utilisateur.
- Relier Electron au relais par un pont local contrôlé et protégé par permissions/authentification.
- Si une liaison dédiée nécessite transfert/NAT, documenter uniquement les règles ajoutées ; ne pas vider les règles existantes.
- Autoriser web/DNS par le tunnel et le seul transport VPN par l’amorçage. Aucun secours web/DNS par l’amorçage.
- Conserver le DNS hôte. Le contrôleur prépare/nettoie l’environnement avec les privilèges nécessaires ; le relais n’est pas maintenu root sans nécessité.
- Pas de capacités globales sur un binaire situé dans un répertoire modifiable par l’utilisateur.

### 5.3 Proxy et DNS

- Proxy HTTP explicite sur `127.0.0.1`, port libre par exécution ; supprimer les ports fixes 8085/7505.
- Authentification avec secret éphémère de session, distinct du mot de passe ENT ; aucun transfert de ce secret à la destination.
- HTTPS/WSS par `CONNECT`, TLS conservé entre Chromium et le site. HTTP/WS seulement si nécessaires, avec limites et délais.
- Chromium transmet les noms au proxy HTTP [S7]. Le relais les résout par un résolveur dédié dans le tunnel, jamais par résolution système implicite.
- Obtenir les DNS du serveur ou d’une configuration fiable. Aucun DNS public de secours pour les domaines internes ; gérer UDP et TCP et invalider le cache à la reconnexion.
- Refuser les destinations locales de contrôle et les ports non nécessaires ; vérifier aussi les adresses après résolution.
- IPv4 seul acceptable pour le premier jalon si IPv6 applicatif est bloqué et la limite documentée. Ne pas désactiver IPv6 sur l’hôte.

## 6. Authentification et cycle de vie

### Saisie et canal de contrôle

- Formulaire local identifiant/mot de passe, annulation et erreurs explicites.
- `contextBridge` limité à la soumission/annulation, validation de l’émetteur IPC et des tailles. Aucun bridge privilégié sur le site distant.
- Secrets uniquement en mémoire et via un IPC local authentifié avec permissions adaptées.
- Management protégé : socket Unix restreinte sur Linux ; boucle locale authentifiée et amorçage protégé sur Windows. `127.0.0.1` seul ne suffit pas.
- Lancement en attente puis libération après connexion du contrôleur. Étudier `management-client` pour l’arrêt sur perte de contrôle, sans le confondre avec une authentification.
- Sérialiser les identifiants avec l’échappement du protocole ; rejeter les caractères de contrôle permettant une injection.
- Ne pas stocker les identifiants OpenVPN sur disque ; redemander une saisie si réauthentification nécessaire. Pour l’extension J2 autorisée, garder une seule copie en mémoire du processus principal pendant 3 minutes maximum, consommée une seule fois pour CAS après validation du VPN. Détecter les challenges et expliquer ceux qui ne sont pas pris en charge.
- Effacer les champs et relâcher les références rapidement ; aucune promesse d’effacement de toutes les copies JavaScript, de la pagination OS ou d’un dump. Pas de traces/dumps applicatifs contenant des secrets.

Référence protocolaire : [S8].

### États et supervision

```text
INACTIF -> PREREQUIS -> SAISIE -> DEMARRAGE -> AUTHENTIFICATION_VPN
    -> VPN_CONNECTE -> VALIDATION_RESEAU -> PRET -> NAVIGATION
Toute erreur/perte -> BLOQUE -> NETTOYAGE -> SAISIE ou INACTIF
Annulation/fermeture -> BLOCAGE_DES_FLUX -> NETTOYAGE -> ARRET
```

- Attendre `CONNECTED` puis valider réseau/DNS avant chargement distant ; IP ou message d’ouverture TUN insuffisant.
- Associer sockets, cache et paramètres à une génération de tunnel, invalidée à chaque reconnexion.
- Distinguer refus d’identifiants, crypto, TLS, serveur absent, DNS, refus du site et challenge ; délais bornés et pas de boucle sur mauvais mot de passe.
- Arrêt normal par `signal SIGTERM` management ; `kill` ne termine pas le client OpenVPN [S8]. Prévoir supervision OS et arrêt forcé du seul processus de la session.
- Fermer les flux avant routes et filtres ; retirer uniquement les ressources créées. Couvrir crash Electron, auxiliaire, OpenVPN et reprise au lancement suivant.
- Un pilote installé peut rester présent ; aucun tunnel actif, relais accessible ou ressource transitoire inutile ne doit subsister.

## 7. Intégration Electron et web

- Session de navigation dédiée non persistante, séparée du formulaire local.
- Proxy fixe unique avant chargement, sans PAC/autodétection ni `DIRECT`. Vérifier `resolveProxy()` et fermer les anciennes connexions lors des changements [S9].
- Traiter les exceptions implicites de proxy, WS/WSS, popups et nouveaux contenus ; bloquer les URL locales de contrôle et schémas non admis.
- Empêcher UDP non proxyfié, WebRTC et QUIC non couverts. Les options Chromium complètent le filtrage OS sans le remplacer.
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true` ; vérifications TLS conservées [S10].
- Installer la protection avant tout processus susceptible d’émettre. Tester séparément le développement utilisant un `electron.exe` partagé pour ne pas bloquer d’autres projets.
- Déterminer les domaines admis à partir des redirections réelles ; les domaines CAS et ressources annexes sont encore inconnus.
- Garder les fenêtres de connexion nécessaires dans la session protégée ; aucune ouverture externe automatique.
- Téléchargements HTTPS universitaires et `blob` de même origine dans la session protégée, avec sauvegarde choisie par l’utilisateur, suivi et annulation. L’ouverture dans une application tierce sort du périmètre et n’est pas automatique.

## 8. Organisation et packaging prévus

Arborescence cible, partiellement matérialisée pour le pilote Windows et à ajuster après sa recette :

```text
PLAN.md
VPN_Universite_Avignon.ovpn      # source intacte
package.json / package-lock.json
src/main/                       # orchestration, IPC, sessions, fenêtres, états
src/preload/                    # formulaire local et remplissage CAS isolé, sans API exposée au site
src/renderer/                   # connexion et états
native/windows/                 # Win32, WFP, contrôle réseau
native/linux/                   # espace réseau et privilèges
network/                        # relais/résolveur selon prototype
resources/config/               # profil dérivé sans secret
resources/bin/win/x64/
resources/bin/linux/x64/
tests/                          # protocole, états et intégration réseau
docs/                           # décisions, recette et installation
```

- Ressources en développement depuis la racine applicative (`app.getAppPath()`), puis `process.resourcesPath` en paquet. Le chemin `../../resources` depuis `src/main` du plan initial était incorrect.
- Configurer `electron-builder` après preuve réseau. Binaires et profils hors `app.asar`, sélection par OS/architecture, sans duplication inutile.
- Windows : NSIS et installation contrôlée du pilote/auxiliaire dans un emplacement protégé. Le format portable reste conditionnel ; il ne supprime pas les droits ni le pilote requis.
- Linux : paquet installé d’abord pour gérer l’auxiliaire et ses droits ; AppImage conditionnelle aux prérequis. Jamais d’interface Electron root ni de sandbox désactivée.
- Vérifier intégrité, provenance et notices des binaires ; prévoir signature de distribution. Pas de binaire non vérifié téléchargé au lancement.
- Vérifier le périmètre de redistribution du profil universitaire avant publication.
- Pilote : exclusions Git ajoutées, licence npm alignée sur LICENSE et test factice remplacé par la compilation et les tests natifs. Aucun packaging ajouté.

## 9. Jalons et portée du GO

| Jalon | Travail | Condition de sortie |
| --- | --- | --- |
| J0 — Préparer | SDK, versions corrigées, profil dérivé, privilèges, pilote, saisie locale | Prérequis documentés ; aucun secret conservé. |
| J1 — Prouver Windows | Prototype réel : OpenVPN, routage, WFP, relais et DNS | Rapport nettoyé, essais R1 à R10, décision d’architecture écrite. Corriger ici si l’isolation échoue, avant J2. |
| J2 — Naviguer | Formulaire, session, cycle de vie, APPIGS et ENT/CAS | Parcours réel validé, domaines requis identifiés, aucune fuite de transition. |
| J3 — Durcir Windows | Crashs, reprise, réauthentification et packaging | Recette et installation reproductibles sur machine propre. |
| J4 — Porter Linux | Espace privé, contrôle, relais et droits | Même contrat réseau et recette sur une distribution définie. |
| J5 — Livrer | Paquets, documentation et limites | Liste des OS/fonctions réellement validés et preuves de recette. |

L’utilisateur saisira les identifiants localement lors des essais. Aucun mot de passe à communiquer dans le chat. Aucune charge/date ferme avant le verdict J1.

État : J0 réalisé ; preuves contrôlées J1 acquises et décision dans [docs/ARCHITECTURE_WINDOWS.md](docs/ARCHITECTURE_WINDOWS.md). J1 n’est pas déclaré intégralement clos : veille, changement physique de réseau, VPN tiers et changements effectifs de DNS restent à qualifier. J2 : formulaire, IPC authentifié, session et confinement, préremplissage CAS et accès APPIGS après clic manuel confirmés. Compléter la recette des fenêtres annexes, erreurs, challenges et captures navigateur. Aucun démarrage du packaging.

## 10. Recette et preuves attendues

Le GO couvre le pilote Windows et le début de J2. Les scénarios ci-dessous restent des exigences de recette ; seuls ceux explicitement marqués exécutés dans le rapport sont acquis. Le HEAD WinHTTP, les sondes Electron locales et une navigation ENT complète constituent des preuves distinctes.

Relever routes IPv4/IPv6, DNS, interfaces, règles MyNEIGE et processus avant/pendant/après. Capturer simultanément interfaces physique et VPN sur une machine d’essai. Minimiser et nettoyer les captures avant partage ; ne jamais publier de capture contenant une authentification ou un token.

| ID | Scénario | Résultat exigé |
| --- | --- | --- |
| R1 | Connexion et accès APPIGS | Serveur vérifié ; web dans le tunnel, aucune connexion directe vers le site sur l’interface physique. |
| R2 | Application tierce vers la même destination simultanément | Chemin habituel conservé ; comparaison d’IP publique seule insuffisante. |
| R3 | Applications et DNS hôte | Routes effectives, résolveurs et proxy système conservés. |
| R4 | DNS applicatif non en cache | Tunnel uniquement ; couvrir UDP et TCP. Le DNS d’amorçage du serveur VPN est identifié séparément. |
| R5 | Coupure VPN/arrêt OpenVPN pendant transfert | Flux fermés, nouvelles requêtes bloquées, aucune sortie web/DNS directe pendant la transition. |
| R6 | Crash proxy/contrôleur | Navigation bloquée ; aucun processus survivant libéré vers Internet. |
| R7 | Changement réseau, perte de route physique, veille et VPN tiers | Aucun détournement des autres applications ni fuite MyNEIGE. |
| R8 | IPv6, WebRTC, HTTP/3/QUIC | Prise en charge protégée prouvée ou blocage applicatif, sans désactiver IPv6 hôte. |
| R9 | Client tiers du proxy/management | Refus sans identité/secret de session. |
| R10 | Reconnexion avec nouvelle IP/interface/DNS | Flux et cache précédents invalidés ; validation avant reprise. |
| R11 | Refus d’identifiants, crypto/TLS invalides, serveur absent | Erreurs distinctes, délais bornés et annulation ; aucun contournement TLS. |
| R12 | ENT/CAS, popups et challenge | Parcours protégé et limites documentés. |
| R13 | Fermeture et crash forcé à chaque étape | Pas de VPN orphelin actif ni relais accessible ; nettoyage et récupération de l’état hôte. |
| R14 | Double instance et reprise après crash | Propriété des ressources respectée ; aucun VPN tiers arrêté ou reconfiguré. |
| R15 | Installation/désinstallation sur machine propre | Prérequis et chemins corrects, ressources propres retirées sans toucher aux VPN tiers. |
| R16 | Fichiers, arguments, logs et caches produits | Aucun secret volontairement persisté ni trace brute management. |

Automatiser les tests utiles : lignes management fragmentées, échappement des identifiants, erreurs/challenges, normalisation, transitions et authentification du proxy. Les mocks ne remplacent pas les preuves réseau réelles.

## 11. Conditions de validation finale

- Profil source intact et compatible avec un moteur maintenu ; aucune clé client inventée.
- Contrôles TLS conservés et paramètres réseau réellement connus.
- Scénarios critiques réussis sur chaque OS annoncé, incluant les transitions et applications tierces.
- Limites du VPN, de l’ENT et des paquets explicitement documentées.
- Aucune isolation multiplateforme déclarée acquise sur la base d’un seul accès web Windows.

Le serveur, les paramètres poussés et l’accès HTTPS via le relais sont validés par essais réels. Les captures acquises portent sur des scénarios contrôlés sur cette machine. Les transitions restantes conditionnent la clôture complète de J1 ; le nouveau GO permet le début expérimental de J2. Le packaging attend J3.

## 12. Références

Consultées le 22 octobre 2026 ; les choix de conception restent soumis aux essais ci-dessus.

- [S1 — OpenVPN 2.7 : changements Windows et retrait de Wintun](https://github.com/OpenVPN/openvpn/releases/tag/v2.7.0).
- [S2 — Manuel OpenVPN 2.7](https://openvpn.net/community-docs/community-articles/openvpn-2-7-manual.html).
- [S3 — Microsoft : interfaces et modèle d’hôte](https://learn.microsoft.com/en-us/windows/win32/api/netioapi/ns-netioapi-mib_ipinterface_row).
- [S4 — Microsoft : options Winsock, IP_UNICAST_IF](https://learn.microsoft.com/en-us/windows/win32/winsock/ipproto-ip-socket-options).
- [S5 — Microsoft : WFP, applications et utilisateurs](https://learn.microsoft.com/en-us/windows/win32/fwp/permitting-and-blocking-applications-and-users).
- [S6 — Linux : espaces réseau](https://man7.org/linux/man-pages/man8/ip-netns.8.html).
- [S7 — Chromium : proxy, CONNECT et résolution des noms](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md).
- [S8 — OpenVPN : interface management](https://openvpn.net/community-docs/management-interface.html).
- [S9 — Electron : sessions](https://www.electronjs.org/docs/latest/api/session) et [configuration proxy](https://www.electronjs.org/docs/latest/api/structures/proxy-config).
- [S10 — Electron : sécurité](https://www.electronjs.org/docs/latest/tutorial/security).
