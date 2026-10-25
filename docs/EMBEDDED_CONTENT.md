# Vidéos intégrées, H5P et messagerie RENATER

## Fonctionnement

Le menu Université propose **Mail** (`https://partage.univ-avignon.fr/`) et **Nextcloud** (`https://cloud.univ-avignon.fr/`). Ces liens utilisent la fenêtre principale et sa session existante. Mail/PARTAGE et les destinations `renater.fr` et leurs sous-domaines utilisent la connexion Internet habituelle en HTTPS/WSS sur 443, y compris pour les ressources du webmail et les pièces jointes. Nextcloud et les redirections vers les pages d'authentification universitaires restent dans le VPN. Le préremplissage CAS reste limité à son parcours APPIGS vérifié, sans soumission automatique.

Toutes les pages HTTPS de `univ-avignon.fr` et de ses sous-domaines peuvent intégrer les lecteurs YouTube standards (`youtube.com/embed/…`) et sans cookies (`youtube-nocookie.com/embed/…`). L'autorisation concerne aussi les lecteurs imbriqués dans une activité H5P universitaire, une iframe `srcdoc` ou une activité distante `*.h5p.com/content/…/embed` / `h5p.org/h5p/embed/…`.

La page principale doit rester universitaire et toute la chaîne des cadres doit être universitaire, un lecteur admis ou un cadre vide intermédiaire. Une frame manquante ou détruite ne donne aucun droit supplémentaire. La navigation principale et les pop-ups vers YouTube/H5P restent refusés ; les pages `/watch`, les interfaces d'administration H5P et les autres services Google ne sont pas ajoutés à la navigation générale.

## Ressources admises

| Usage | Destinations |
| --- | --- |
| Lecteurs et requêtes YouTube | `*.youtube.com`, `*.youtube-nocookie.com`, depuis le lecteur intégré |
| Flux vidéo et miniatures | `*.googlevideo.com`, `*.ytimg.com` |
| API et ressources du lecteur | `youtubei.googleapis.com`, `youtube.googleapis.com`, `jnn-pa.googleapis.com`, `yt3.ggpht.com`, `www.gstatic.com`, `fonts.gstatic.com` |
| Script complémentaire du lecteur | `www.google.com/js/…`, uniquement dans le contexte YouTube |
| Ressources H5P distantes | `*.h5p.com`, `*.h5p.org`, `*.h5p.io`, `cdnjs.cloudflare.com`, `fonts.googleapis.com`, `fonts.gstatic.com`, dans le contexte H5P |
| Bibliothèques du cours | `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, uniquement scripts/styles dans un contexte universitaire admis |

Les API `/iframe_api`, `/player_api` et les scripts `/s/player/…` de YouTube peuvent être chargés directement par la page universitaire : H5P les utilise avant de créer le lecteur. Les miniatures `ytimg.com` et les scripts `h5p-resizer.js` des domaines H5P sont également utilisables par cette page. Les flux `googlevideo.com` ne sont admis qu'à l'intérieur d'un lecteur YouTube. Les URL MediaSource `blob:` sont locales et limitées à l'origine du lecteur.

Electron impose les chemins et la provenance des iframes, que les relais CONNECT/TLS ne peuvent pas inspecter. Les domaines effectivement admis apparaissent dans les diagnostics, sans URL complète ni contenu.

## Routage explicite approuvé le 25 octobre 2026

| Destination | Réseau et résolution DNS |
| --- | --- |
| `partage.univ-avignon.fr` exactement, `renater.fr` et sous-domaines | Connexion habituelle et DNS de cette interface |
| YouTube/H5P externes et dépendances du tableau ci-dessus | Connexion habituelle et DNS de cette interface, sous réserve du filtrage de contexte Electron |
| Autres domaines universitaires : APPIGS, CAS, IdP, ENT, Moodle, Nextcloud, etc. | VPN obligatoire et DNS du tunnel |
| Domaine non autorisé | Refusé |

Il s'agit d'une séparation définie par domaine, sans tentative de repli après une erreur réseau. Les activités H5P et leurs données hébergées par l'université restent protégées ; seuls les hébergements/lecteurs et ressources externes listés utilisent le réseau habituel. Une redirection SAML/CAS de PARTAGE vers un domaine universitaire reprend automatiquement la voie VPN, dans la même session Chromium et avec ses cookies habituels.

Electron conserve son unique proxy local authentifié et sa quarantaine WFP. Le relais VPN classe les destinations avant toute résolution DNS : un service public est transmis à un second proxy local authentifié, porté par une image native distincte. Le second relais refuse les destinations protégées et inconnues avant résolution, même avec un secret proxy valide. Les adresses privées, locales, de test et réservées obtenues pour un nom public sont refusées. Aucune désactivation de TLS ou du sandbox n'est nécessaire.

Le relais public n'est autorisé par WFP que sur l'adresse source et le LUID du réseau habituel choisi avant le démarrage du tunnel. Les sockets revérifient l'identité de l'interface. Il utilise explicitement les DNS IPv4 de cette interface, sans modifier le DNS global. Le relais VPN conserve uniquement sa sortie VPN et reçoit un permis supplémentaire vers le port local précis du relais public. Aucun permis Internet direct n'est donné à Electron. Un changement de réseau, une perte du VPN ou l'arrêt d'un relais arrête la session ; les transferts protégés ne reprennent pas sur le réseau habituel.

Cette évolution remplace la garantie initiale « tout le trafic web dans le VPN » à la demande explicite de l'utilisateur. Les autres applications conservent leurs routes et DNS. Les flux du relais public sont marqués `PUBLIC_FLOW` (`DNS_PUBLIC`, `WEB_PUBLIC`) ; les flux protégés restent marqués `VPN_FLOW`.

`npm run test:public` réalise deux HEAD publics sans compte (PARTAGE et API YouTube), via la véritable image publique confinée WFP, avec DNS lié à l'interface habituelle et TLS vérifié. Ce test nécessite une connexion Internet et UAC, mais ne démarre pas OpenVPN, ne soumet aucun formulaire et ne suit pas les redirections. Le précontrôle `npm run browser:test` reste sans réseau distant : il teste aussi l'authentification et les refus CAS/IdP/Nextcloud du véritable relais public.

Les quotas sont séparés : 32 connexions VPN et 32 connexions publiques, afin qu'une saturation publique ne consomme pas la réserve VPN. Le relais principal accepte au plus 80 connexions en incluant les en-têtes non encore authentifiés ; le relais public accepte au plus 32 connexions. Cela corrige la saturation de l'ancien plafond partagé de 16 constatée pendant la recette.

Validation du routage : 34 tests natifs, coffre DPAPI et 40 tests Node réussis ; précontrôle WFP/CAS/navigateur réussi, dont les refus du relais public et un retour POST fictif IdP → RENATER → PARTAGE. Le test public réel réussit : PARTAGE `302`, API YouTube `200`, TLS vérifié, flux DNS et TCP issus de l'adresse du réseau habituel, routes et DNS globaux inchangés. La reproduction dans MyNEIGE montre PARTAGE/RENATER, CDN et serveurs vidéo `googlevideo.com` sur la sortie habituelle, et APPIGS/CAS/IdP sur le VPN.

L'utilisateur confirme la lecture YouTube et l'accès à la messagerie après une seconde ouverture. Le premier retour d'authentification via l'IdP présentait un écran blanc et un chargement PARTAGE annulé (`ERR_ABORTED`). L'instrumentation du 25 octobre 2026 en précise la cause : après le POST SAML au SP RENATER et ses redirections internes, le retour HTTPS à PARTAGE reçoit une redirection `302` vers HTTP sur le même domaine, refusée par le filtre. La saturation n'est pas relevée à cet instant et ne doit pas être présentée comme son explication. Aucun rejeu automatique de formulaire SAML ni déplacement de l'IdP sur le réseau habituel n'a été ajouté.

## Retour d'authentification PARTAGE

L'ouverture explicite de **Mail** dans le menu arme un suivi limité à la fenêtre principale et à sa session existante. Les diagnostics `BROWSER_MAIL_SSO` indiquent uniquement une étape contrôlée, le protocole, un domaine SSO connu, la méthode GET/POST/OTHER et le statut HTTP (0 si inconnu). Les domaines inconnus deviennent `other`. Ni les chemins, paramètres, en-têtes, cookies, formulaires ni les réponses SAML ne sont journalisés ; les traces sont limitées à 128 événements par ouverture et le suivi expire après dix minutes.

Une reprise est permise uniquement après un passage par `idp.univ-avignon.fr`, puis une réponse 302/303 au POST principal vers `https://sp.partage.renater.fr/`, redirigeant vers PARTAGE directement ou par des GET 301/302/303 sur ce même SP HTTPS. Le parcours réel observé comporte un POST SP 302, un GET SP 301, un GET SP 302 vers PARTAGE HTTPS, puis un GET PARTAGE 302 vers HTTP. Si la dernière navigation est bloquée ou annulée, MyNEIGE attend l'arrêt des chargements et 1,2 seconde sans nouvelle navigation avant un seul GET neuf vers `https://partage.univ-avignon.fr/`. Cette reprise conserve le WebContents, les cookies, le proxy et les règles de routage. Les paramètres de retour ne sont jamais réutilisés et aucun POST ni formulaire de connexion n'est rejoué. La redirection HTTP reste bloquée ; seule l'ouverture HTTPS fixe est permise.

Un retour normal vers la messagerie, une erreur HTTP ou réseau autre qu'une annulation, Échap, les commandes d'historique, un changement de service, la fermeture de la fenêtre ou un VPN indisponible désarment la reprise. Un IdP 200 ou un ERR_ABORTED isolé ne suffisent pas. Un parcours SSO différent de celui reconnu produit des diagnostics mais ne déclenche pas de reprise spéculative. L'IdP et le CAS conservent leur voie VPN ; PARTAGE/RENATER conservent la sortie publique explicitement autorisée.

`npm run test:mail` teste sept parcours avec Chromium et de véritables réponses TLS sur loopback : retour normal, chaîne RENATER observée suivie du retour HTTP bloqué puis reprise HTTPS unique, changement de service, Échap, refus HTTP 403, absence d'intention Mail et perte de disponibilité VPN. Le test vérifie le POST intact et unique ainsi que la conservation du cookie lors de la reprise. Son proxy CONNECT ne joint que son serveur local ; son certificat autosigné et sa clé privée de fixture (sans secret réel) dans `tests/fixtures/` ne servent jamais en production. La confiance est limitée à ce certificat précis dans la session de test, sans installation dans Windows. Cette reproduction locale ne remplace pas la validation de la reprise avec l'IdP réel.

Validation de développement du 25 octobre 2026 : `npm test` réussit (34 tests natifs, coffre DPAPI, inspection du profil et 47 tests Node), puis `npm run test:js` réussit avec 49 tests après l'ajout des redirections internes du SP. Les sept scénarios de `npm run test:mail` et le précontrôle WFP/CAS/navigateur `npm run browser:test` passent également. Le précontrôle WFP reste local, sans VPN universitaire ; aucune distribution n'a été construite.

Recette réelle du 25 octobre 2026 avec `npm start` : après la validation IdP, les traces montrent le refus de la redirection HTTP puis un unique `RECOVER` GET HTTPS vers PARTAGE, une réponse 200 et la navigation finale validée. L'utilisateur confirme que la messagerie apparaît automatiquement sans seconde ouverture du menu Mail. Cette recette valide le parcours observé ; elle ne remplace pas une qualification complète de l'isolation réseau.

## Validation et limites

`npm test` couvre les politiques JavaScript et natives ; `npm run test:browser` utilise les mêmes fenêtres et filtres Electron. Les scénarios locaux incluent deux domaines universitaires distincts, le lecteur sans cookies, H5P universitaire et distant, `srcdoc`, le chargement de l'API, le décodage et l'avancement d'une vidéo VP8 synthétique, les refus hors contexte et les redirections/ressources RENATER. Les deux nouveaux liens sont aussi contrôlés avec le menu existant : session conservée, historique, disponibilité du VPN et accès depuis un pop-up.

Validation de développement du 24 octobre 2026 : `npm test` réussit (29 tests de protocole natif, test du coffre DPAPI sans vrais identifiants, inspection du profil et 36 tests Node) ; les 38 vérifications Chromium passent, dont les redirections du lecteur intégré. `npm run browser:test` exécute aussi ces fixtures sous confinement WFP. Les réponses sont synthétiques : elles ne constituent pas une lecture réelle de YouTube ni une connexion réelle à PARTAGE/Nextcloud. La recette avec VPN et compte universitaire reste à réaliser. Aucun média étudiant ni compte n'est utilisé par les tests automatisés.

Le précontrôle WFP du 24 octobre 2026 réussit également : sondes IPv4/IPv6 et processus enfant bloqués, aucun datagramme reçu par les récepteurs témoins, seul proxy local admis, puis scénarios CAS et navigateur réussis. Ce résultat local ne valide pas le parcours YouTube/PARTAGE sur le VPN universitaire réel.

Les politiques CSP et `Permissions-Policy` des sites, les vidéos privées ou interdites à l'intégration, une restriction YouTube liée au VPN et les erreurs d'une version H5P demeurent applicables. MyNEIGE conserve le Referer envoyé par le navigateur ; il ne le falsifie pas si une page le supprime. YouTube exige une identification du client via ce Referer : une intégration qui le supprime peut afficher l'erreur 153. Les domaines nécessaires aux fournisseurs peuvent évoluer ; étendre la liste doit rester ciblé et testé.

Références : [lecteurs YouTube](https://developers.google.com/youtube/player_parameters), [identification du lecteur et Referer](https://developers.google.com/youtube/terms/required-minimum-functionality#youtube-embedded-player-and-video-playback), [domaines H5P.com](https://help.h5p.com/hc/en-us/articles/14980108131997-Domains-used-by-h5p-com), [bibliothèque vidéo H5P](https://github.com/h5p/h5p-video), [PARTAGE RENATER](https://www.renater.fr/services/collaborer-simplement/partage/).

## Investigation des écrans vides — 25 octobre 2026

Historique antérieur à la mise en place du routage public explicite ci-dessus.

La recette réelle en développement signale encore un écran blanc pour Mail et noir pour YouTube/H5P. Les traces historiques montrent des domaines admis, suivis d'échecs génériques du relais ; les tests synthétiques précédents ne permettaient pas de détecter ces échecs réseau distants. L'autorisation des domaines ne prouve donc pas leur accessibilité depuis le tunnel.

Les diagnostics distinguent désormais :

- `BROWSER_REQUEST_BLOCKED` : refus du filtre Electron, avec domaine et type de ressource seulement.
- `BROWSER_REQUEST_ERROR` : code Chromium des pages et sous-ressources ; le préfixe `net::` est normalisé pour éviter de masquer ces erreurs sous `OTHER`.
- `DNS_ATTEMPT_FAILED` : domaine, étape UDP/TCP, code DNS numérique et catégorie contrôlée (`RCODE`, `NO_IPV4`, `INVALID_RESPONSE`, `TRANSPORT`). Ces lignes étaient auparavant perdues par le contrôleur pendant la navigation.
- `RELAY_REQUEST_FAILED` : domaine et étape d'échec du relais (`DNS`, `CONNECT`, `TUNNEL`, etc.), sans texte d'exception distant.
- `RELAY_CAPACITY` : plafond de connexions simultanées atteint.

Les refus et erreurs Chromium sont dédupliqués et bornés à 64 entrées de chaque catégorie par session. Aucun chemin, paramètre de requête, cookie, en-tête d'authentification ou contenu de page n'est enregistré. Les traces IPC sont revérifiées par le contrôleur natif avant publication. Les règles d'accès et le confinement réseau restent identiques.

Après fermeture d'une session lancée avec `npm start`, le journal est copié dans `.local/browser/live-session.txt`. Pendant la session, le journal protégé courant est sous `%ProgramData%/MyNEIGE-Logs/`.

La reproduction authentifiée du 25 octobre permet d'établir :

| Observation réelle | Portée du diagnostic |
| --- | --- |
| Mail : `ERR_TUNNEL_CONNECTION_FAILED`, puis `RELAY_REQUEST_FAILED host=partage.univ-avignon.fr stage=CONNECT` | Domaine admis et résolution terminée ; échec de la connexion TCP dans le relais, avant la réponse HTTP et la fédération RENATER. Le code Winsock relevé vaut zéro : il ne permet pas de préciser la cause système. |
| YouTube : domaine admis, puis `ERR_TIMED_OUT` pour une ressource `script` | Le chargement du script externe expire ; aucune connexion web réussie vers YouTube n'est observée dans cette reproduction. Ce n'est pas un refus explicite du filtre Electron. |
| `cdnjs.cloudflare.com` et `cdn.jsdelivr.net` : scripts refusés | Les dépendances de la page universitaire ne sont pas toutes admises. En particulier, la règle cdnjs précédente ne couvre que les iframes H5P distantes, pas les bibliothèques appelées directement par la page universitaire. Leur rôle exact dans l'activité privée n'a pas été inspecté. |

Des témoins HEAD publics, sans cookies ni compte, réussissent sur le réseau habituel **hors session protégée** : Mail `302` avec TLS vérifié, API YouTube `200` avec TLS vérifié, également en IPv4. Cette comparaison ne prouve pas leur accessibilité via le VPN. Les pages universitaires APPIGS/CAS/Moodle fonctionnent dans la même session protégée.

Le blocage principal se situe donc dans le transport VPN/relais des destinations externes, avant leur rendu ; une restriction de sortie Internet du VPN est une hypothèse, pas une cause prouvée. La prochaine investigation réseau doit distinguer un défaut du relais/routage d'un filtrage en amont du tunnel (tentatives TCP ciblées et métadonnées SYN/réponse, toujours sans repli physique). La correction des dépendances CDN devra être ciblée sur le contexte universitaire et ne résoudra pas à elle seule ce problème de transport. Aucun élargissement supplémentaire de domaines ni exception réseau directe n'a été appliqué pendant cette investigation.

Validation de l'instrumentation : 39 tests Node, 30 tests natifs, coffre DPAPI et précontrôle navigateur WFP réussis ; les fixtures du navigateur et du CAS passent également. Aucune distribution n'a été reconstruite.
