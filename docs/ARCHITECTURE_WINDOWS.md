# Architecture Windows

MyNEIGE associe un contrôleur C++/Win32, le filtrage WFP et une interface Electron. Les choix initiaux ont été validés par des essais contrôlés le 23 octobre 2026, puis complétés par les évolutions décrites ci-dessous. La qualification sur cette machine ne vaut pas homologation sur tous les réseaux Windows.

## Frontières retenues

Le contrôleur élevé possède le TAP dédié, la route, les règles WFP et les Jobs. Il valide les signatures OpenVPN/tapctl et reconstruit le profil depuis une liste de directives admises. Aucun script fourni par le profil n’est exécuté. Son objet processus est protégé contre la terminaison et l’injection par le travailleur de niveau moyen.

Le relais et Electron utilisent un jeton de niveau moyen, sans appartenance administrateur active ni privilèges administratifs conservés. Les images et sources sont copiées dans un répertoire de session appartenant aux administrateurs ; le compte de session dispose seulement de lecture/exécution. Une autre application Electron utilisant le binaire du dépôt n’est donc pas placée sous les règles de cette session.

Le relais VPN est bloqué par défaut en IPv4/IPv6. Ses connexions DNS et web protégées exigent l’adresse source et l’interface VPN vérifiées. Une route de métrique 60000 rend ces sockets liées utilisables ; les autres exécutables sont interdits sur le TAP. Depuis la décision du 25 octobre 2026, il délègue les seuls domaines publics autorisés à un second relais natif, image distincte `public-relay.exe`, via un port local authentifié. Ce second relais revérifie la liste publique avant résolution, et WFP le limite à l'adresse et à l'interface du réseau habituel sélectionné avant le tunnel. Il ne reçoit aucun permis sur le VPN. Aucun DNS hôte ni proxy système n’est configuré. Voir [le routage explicite et sa validation](EMBEDDED_CONTENT.md).

L’identité d’une génération comprend GUID, nom aléatoire, LUID, index et adresse. Les essais ont montré que Windows réutilise le même LUID/index après destruction et recréation d’un TAP : ils ne suffisent pas seuls. Les sockets revérifient cette identité ; une reconnexion exige une nouvelle session et une nouvelle validation.

Electron démarre après sa quarantaine WFP. Tous ses enfants utilisant l’image protégée sont couverts ; le Job ferme l’arbre de processus. Le seul permis réseau est TCP vers `127.0.0.1` et le port proxy de cette session. Le permis temporaire du précontrôle est supprimé avant toute navigation. UDP, IPv6 et les autres sorties directes restent bloqués.

La règle Chromium de résolution refuse tous les noms, avec une exclusion pour l’adresse numérique du proxy `127.0.0.1`. Cette exclusion est nécessaire au fonctionnement du proxy lui-même ; elle n’ajoute aucun permis WFP et ne concerne aucune destination web distante. Les noms protégés sont résolus par le relais VPN sur les DNS du tunnel ; les seuls noms publics autorisés sont résolus par le relais public sur les DNS du réseau habituel, avec sockets liées à cette interface. Un échec ne change jamais de catégorie de routage.

Le formulaire local possède un preload limité. La fenêtre universitaire utilise une autre session en mémoire, sans Node, avec sandbox, isolation de contexte et vérification TLS. Le préremplissage CAS utilise un preload isolé : aucune API ni aucun bridge n’est exposé au site. Son IPC ne délivre qu’une fois les identifiants au document principal CAS attendu, après validation du VPN. Aucun contenu distant ne peut soumettre une commande VPN par le bridge du formulaire. Les permissions restent refusées. Les téléchargements utilisent Chromium dans cette même session, avec contrôle d’origine/redirections, choix de sauvegarde, annulation et aucune ouverture automatique. Le menu natif de navigation est contrôlé par le processus principal, sans bridge de navigation exposé au site.

## Canaux et secrets

OpenVPN utilise un management inversé local, secret aléatoire transmis par pipe hérité et contrôle du PID du pair TCP. Les échanges sont sérialisés et bornés ; les notifications brutes ne sont pas journalisées.

Le contrôleur crée avant Electron un pipe nommé aléatoire, à instance unique, refusant les clients distants. Il vérifie le PID du client contre le processus qu’il supervise avant de transmettre une commande ou un secret. Le nom public du pipe est le seul paramètre de contrôle passé en argument. Identifiants VPN et secret proxy éphémère passent dans ce canal, sans fichier de credentials ni sortie standard. Le codage hexadécimal est un cadrage, pas un chiffrement : la protection repose sur le pipe et son authentification.

Le formulaire vide ses champs après soumission. Les buffers natifs sont effacés au mieux. Le préremplissage CAS conserve une copie en buffers dans le processus principal Electron pendant 3 minutes maximum à compter de la saisie. Elle est effacée lors de sa délivrance unique au preload CAS, d’une fermeture, d’un blocage ou d’une expiration. Les champs DOM restent renseignés pour le clic manuel puis sont vidés au départ de la page. Aucune garantie d’effacement de toutes les copies JavaScript ou de la pagination Windows n’est revendiquée. Les scripts de CAS peuvent lire les champs remplis, comme lors d’une saisie manuelle. Voir [CAS_PREFILL.md](CAS_PREFILL.md).

L’enregistrement explicite après authentification VPN utilise un coffre DPAPI par utilisateur, un auxiliaire natif sans réseau et une vérification Windows Hello dans cet auxiliaire avant lecture. Le formulaire local ne reçoit pas le mot de passe enregistré. La suppression n’exige aucun déverrouillage et invalide les réutilisations en attente ; les sessions déjà connectées restent distinctes. Le contrôle Hello applicatif n’est pas une liaison cryptographique de la clé DPAPI à une nouvelle présence utilisateur. Le compte du bureau interactif est retenu pour les travailleurs et leurs ACL ; une élévation avec un autre administrateur ne doit pas conduire à utiliser son coffre en secours. Voir [J2_CREDENTIALS_SETUP.md](J2_CREDENTIALS_SETUP.md) pour la recette et ses limites.

## Arrêt et récupération

Les Jobs sont fermés et leur extinction vérifiée avant retrait des filtres. Un crash du contrôleur tue ses enfants ; la politique WFP persistante conserve le blocage jusqu’à récupération. Le journal protégé identifie uniquement le TAP créé par cette session. La récupération ne supprime ni VPN tiers ni règles étrangères.

Une variation réseau, un changement d’identité ou une sortie de `CONNECTED` bloque la session. Il n’existe pas de secours physique ni de reconnexion automatique utilisant les anciennes adresses.

## Limites du choix

Les relais transportent HTTPS/WSS sur 443, avec DNS IPv4 UDP/TCP lié à l'interface de chaque catégorie. Les quotas VPN et public sont indépendants, de 32 flux CONNECT chacun ; l'entrée du relais principal reste bornée à 80 connexions, en incluant les en-têtes en attente. Le mode console est limité à APPIGS ; le navigateur autorise les domaines universitaires et les [services publics explicitement listés](EMBEDDED_CONTENT.md). Electron restreint les dépendances pédagogiques au contexte iframe/page universitaire approprié. Toute autre destination, adresse locale, schéma ou port est refusé.

IPv6 applicatif est bloqué ; IPv6 de l’hôte reste actif. Les sondes UDP ne constituent pas un test complet des API WebRTC ou HTTP/3. La veille, un changement physique de réseau, un VPN tiers, les conflits de sous-réseaux, le MFA et le parcours ENT/CAS complet restent des éléments de recette. Le lanceur natif, le ZIP portable et l’installateur NSIS sont décrits dans le [guide de distribution](ALPHA_DISTRIBUTION.md). Le contrôleur est élevé à chaque lancement ; il n’est pas installé comme service permanent.

## Références techniques

- [Microsoft : jetons restreints](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens), [CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken).
- [Microsoft : identité du client d’un pipe nommé](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid).
- [Microsoft : IP_UNICAST_IF](https://learn.microsoft.com/en-us/windows/win32/winsock/ipproto-ip-socket-options).
- [Electron : sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), [sessions et proxy](https://www.electronjs.org/docs/latest/api/session).
- [Chromium : blocage de résolution et exclusion du proxy](https://new.chromium.org/developers/design-documents/network-stack/socks-proxy/).

Les preuves exécutées et leurs limites figurent dans [POC_STATUS.md](POC_STATUS.md).

## Profil personnel

Le formulaire local importe un profil fourni par l’utilisateur. Un auxiliaire sans élévation le valide et conserve sa copie chiffrée DPAPI sous le compte interactif. Le contrôleur valide indépendamment le contenu transmis par son pipe authentifié avant de lancer OpenVPN. Aucune configuration d’Avignon n’est reconnue ou embarquée ; TLS reste vérifié avec la CA importée. L’empreinte du profil normalisé lie les identifiants mémorisés à ce profil. Voir [VPN_PROFILE.md](VPN_PROFILE.md).
