# Décision d’architecture Windows — pilote J1/J2

23 octobre 2026. Décision : poursuivre l’expérimentation C++/Win32 + WFP + Electron. La qualification sur cette machine ne vaut pas homologation sur tous les réseaux Windows.

## Frontières retenues

Le contrôleur élevé possède le TAP dédié, la route, les règles WFP et les Jobs. Il valide les signatures OpenVPN/tapctl et reconstruit le profil depuis une liste de directives admises. Aucun script fourni par le profil n’est exécuté. Son objet processus est protégé contre la terminaison et l’injection par le travailleur de niveau moyen.

Le relais et Electron utilisent un jeton de niveau moyen, sans appartenance administrateur active ni privilèges administratifs conservés. Les images et sources sont copiées dans un répertoire de session appartenant aux administrateurs ; le compte de session dispose seulement de lecture/exécution. Une autre application Electron utilisant le binaire du dépôt n’est donc pas placée sous les règles de cette session.

Le relais est bloqué par défaut en IPv4/IPv6. Ses connexions DNS et web exigent l’adresse source et l’interface VPN vérifiées. Une route de métrique 60000 rend ces sockets liées utilisables ; les autres exécutables sont interdits sur le TAP. Aucun DNS hôte ni proxy système n’est configuré. Ce modèle doit encore être éprouvé lors des changements de réseau et en coexistence avec un autre VPN.

L’identité d’une génération comprend GUID, nom aléatoire, LUID, index et adresse. Les essais ont montré que Windows réutilise le même LUID/index après destruction et recréation d’un TAP : ils ne suffisent pas seuls. Les sockets revérifient cette identité ; une reconnexion exige une nouvelle session et une nouvelle validation.

Electron démarre après sa quarantaine WFP. Tous ses enfants utilisant l’image protégée sont couverts ; le Job ferme l’arbre de processus. Le seul permis réseau est TCP vers `127.0.0.1` et le port proxy de cette session. Le permis temporaire du précontrôle est supprimé avant toute navigation. UDP, IPv6 et les autres sorties directes restent bloqués.

La règle Chromium de résolution refuse tous les noms, avec une exclusion pour l’adresse numérique du proxy `127.0.0.1`. Cette exclusion est nécessaire au fonctionnement du proxy lui-même ; elle n’ajoute aucun permis WFP et ne concerne aucune destination web distante. La résolution des destinations CONNECT appartient au relais lié au VPN.

Le formulaire local possède un preload limité. La fenêtre universitaire utilise une autre session en mémoire, sans Node, avec sandbox, isolation de contexte et vérification TLS. L’extension J2 ajoute un preload isolé de préremplissage CAS : aucune API ni aucun bridge n’est exposé au site. Son IPC ne délivre qu’une fois les identifiants au document principal CAS attendu, après validation du VPN. Aucun contenu distant ne peut soumettre une commande VPN par le bridge du formulaire. Les permissions restent refusées. Les téléchargements utilisent Chromium dans cette même session, avec contrôle d’origine/redirections, choix de sauvegarde, annulation et aucune ouverture automatique. Le menu natif de navigation est contrôlé par le processus principal, sans bridge de navigation exposé au site.

## Canaux et secrets

OpenVPN utilise un management inversé local, secret aléatoire transmis par pipe hérité et contrôle du PID du pair TCP. Les échanges sont sérialisés et bornés ; les notifications brutes ne sont pas journalisées.

Le contrôleur crée avant Electron un pipe nommé aléatoire, à instance unique, refusant les clients distants. Il vérifie le PID du client contre le processus qu’il supervise avant de transmettre une commande ou un secret. Le nom public du pipe est le seul paramètre de contrôle passé en argument. Identifiants VPN et secret proxy éphémère passent dans ce canal, sans fichier de credentials ni sortie standard. Le codage hexadécimal est un cadrage, pas un chiffrement : la protection repose sur le pipe et son authentification.

Le formulaire vide ses champs après soumission. Les buffers natifs sont effacés au mieux. L’extension J2 conserve une copie en buffers dans le processus principal Electron pendant 3 minutes maximum à compter de la saisie. Elle est effacée lors de sa délivrance unique au preload CAS, d’une fermeture, d’un blocage ou d’une expiration. Les champs DOM restent renseignés pour le clic manuel puis sont vidés au départ de la page. Aucune garantie d’effacement de toutes les copies JavaScript ou de la pagination Windows n’est revendiquée. Les scripts de CAS peuvent lire les champs remplis, comme lors d’une saisie manuelle. Voir [CAS_PREFILL.md](CAS_PREFILL.md).

## Arrêt et récupération

Les Jobs sont fermés et leur extinction vérifiée avant retrait des filtres. Un crash du contrôleur tue ses enfants ; la politique WFP persistante conserve le blocage jusqu’à récupération. Le journal protégé identifie uniquement le TAP créé par cette session. La récupération ne supprime ni VPN tiers ni règles étrangères.

Une variation réseau, un changement d’identité ou une sortie de `CONNECTED` bloque la session. Il n’existe pas de secours physique ni de reconnexion automatique utilisant les anciennes adresses.

## Limites du choix

Le proxy transporte HTTPS/WSS sur 443, avec DNS IPv4 UDP/TCP natif lié au tunnel et au plus 16 flux CONNECT simultanés. Le mode console est limité à APPIGS ; le début de J2 autorise temporairement `univ-avignon.fr` et ses sous-domaines, jusqu’à identification du parcours réel. Toute autre destination, adresse locale, schéma ou port est refusé.

IPv6 applicatif est bloqué ; IPv6 de l’hôte reste actif. Les sondes UDP ne constituent pas un test complet des API WebRTC ou HTTP/3. La veille, un changement physique de réseau, un VPN tiers, les conflits de sous-réseaux, le MFA et le parcours ENT/CAS complet restent des éléments de recette. Packaging et séparation en service installé relèvent de J3.

## Références techniques

- [Microsoft : jetons restreints](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens), [CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken).
- [Microsoft : identité du client d’un pipe nommé](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid).
- [Microsoft : IP_UNICAST_IF](https://learn.microsoft.com/en-us/windows/win32/winsock/ipproto-ip-socket-options).
- [Electron : sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), [sessions et proxy](https://www.electronjs.org/docs/latest/api/session).
- [Chromium : blocage de résolution et exclusion du proxy](https://new.chromium.org/developers/design-documents/network-stack/socks-proxy/).

Les preuves exécutées et leurs limites figurent dans [POC_STATUS.md](POC_STATUS.md).
