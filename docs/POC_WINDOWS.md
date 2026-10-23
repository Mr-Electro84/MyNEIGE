# Pilote réseau Windows

## Périmètre

Le mode console valide le réseau par `HEAD` HTTPS vers APPIGS avec WinHTTP et un proxy explicite, sans corps de page ni redirection suivie. Le début de J2 ajoute un formulaire Electron et une fenêtre de navigation protégée. Cette dernière charge le site et ses ressources, mais ne journalise que les noms de domaines et statuts des pages, sans contenu ni paramètres d’URL. Un statut 3xx ne démontre pas une connexion ENT réussie. Aucun installateur ni interface finale n’est livré.

Le contrôleur exige des droits administrateur pour OpenVPN, l’interface, les routes et WFP. Le relais et Electron tournent avec un jeton restreint de niveau moyen, sans droits administrateur actifs. Leur image est protégée en écriture ; la quarantaine précède leur démarrage. Voir la [décision d’architecture](ARCHITECTURE_WINDOWS.md).

## Préparer et vérifier sans changer le réseau

Prérequis de compilation : Visual Studio 2022 avec outils C++ x64 et SDK Windows 10/11 ; Node/npm pour les raccourcis seulement. Aucune dépendance C++ externe ni restauration NuGet.

Depuis la racine du dépôt :

```powershell
npm run poc:build
npm test
npm run poc:inspect
```

`self-test` vérifie notamment l’injection de commandes management, les directives du profil, le protocole DNS et l’authentification CONNECT. `inspect` lit le profil et les paramètres réseau ; il ne lance pas OpenVPN et n’installe aucune règle.

L’exécutable de développement est `.local/poc/myneige-poc.exe`. Il est exclu de Git. Le profil original reste intact ; le profil d’exécution est reconstruit depuis les seules directives admises. Tout changement du serveur ou du profil exige une révision explicite du validateur.

## Tester le blocage WFP sans VPN

```powershell
powershell -NoProfile -File scripts/test-wfp.ps1 -Elevate
```

La demande UAC élève uniquement un test local sans identifiants. Il vérifie qu’un contrôleur peut joindre son serveur TCP de boucle locale, puis qu’un processus placé en quarantaine WFP reçoit précisément `WSAEACCES` (10013) pour la même connexion. Un timeout ou un simple serveur absent ne vaut pas réussite. Les règles propres au test sont ensuite supprimées.

Le résultat est enregistré dans `.local/poc/wfp-test.txt` si l’élévation automatique est utilisée. Le test couvre les quarantaines IPv4 et IPv6, leur maintien après déconnexion du moteur WFP et leur retrait. Il ne prouve ni le routage VPN, ni l’absence de fuite DNS, ni le comportement WebRTC.

## Préparer OpenVPN

Version de départ vérifiée pour ce pilote : OpenVPN Community 2.7.8-I001 x64, depuis [la source officielle](https://openvpn.net/community/). Le moteur et le pilote TAP sont installés sur la machine de développement ; aucune GUI ni service automatique n’a été sélectionné. Pour une autre machine :

```powershell
powershell -NoProfile -File scripts/prepare-openvpn.ps1
# Puis, pour installer le moteur et TAP avec UAC :
powershell -NoProfile -File scripts/prepare-openvpn.ps1 -Install
```

Le script épingle l’empreinte SHA-256 du MSI vérifié et contrôle sa signature. Il refuse d’écraser une installation existante. Le profil propose GCM et CBC ; ne pas compter sur DCO seul. Ne pas utiliser OpenVPN Connect à la place du binaire Community attendu.

Chemin par défaut : `C:\Program Files\OpenVPN\bin\openvpn.exe`. Le contrôleur vérifie signature, éditeur et version 2.7.8 minimum (branche 2.7.x), y compris pour `tapctl.exe`. La vérification des signatures est locale ; une chaîne indisponible provoque un échec, sans validation permissive.

Ne pas remplacer une erreur de chiffrement ou de certificat par un mode permissif. La normalisation conserve les deux chiffrements fournis, ne crée pas de certificat client et n’ajoute pas de fallback crypto arbitraire. Pour HTTPS, les constructions de chaîne de certificats WinHTTP sont limitées au cache local afin d’éviter des téléchargements de certificats hors tunnel. Une chaîne incomplète peut donc empêcher le test : aucun contrôle TLS n’est ignoré.

Les contrôles privilégiés sans identifiants peuvent être exécutés ensemble :

```powershell
powershell -NoProfile -File scripts/test-wfp.ps1 -Elevate -TestCommand all
```

Ils couvrent WFP, création/retrait d’un TAP dédié, authentification du canal management jusqu’à la demande d’identifiants, puis dialogue complet avec données fictives et destination de boucle locale. Aucun identifiant universitaire n’est soumis et aucune authentification VPN réelle n’est prouvée par ces contrôles. Les résultats sont dans `.local/poc/all.txt`.

## Connexion réelle, depuis une console administrateur interactive

Le lanceur ouvre une console dédiée avec UAC et conserve uniquement les sorties de diagnostic du programme dans `.local/poc/live-session.txt` :

```powershell
npm run poc:live
# Pour rejouer les quatre contrôles locaux avant toute saisie :
powershell -NoProfile -File scripts/start-live-poc.ps1 -RunChecks
```

Les saisies sont lues directement par le programme natif, sans écho ni passage dans le journal. Le résultat de sortie se trouve dans `.local/poc/live-exit-code.txt`. Pour une exécution dans une console administrateur déjà ouverte :

```powershell
powershell -NoProfile -File scripts/run-poc.ps1 -Mode connect -Seconds 30
```

L’identifiant et le mot de passe sont demandés localement sans écho, avec un délai de 90 secondes par champ. Aucune option de ligne de commande ne permet de les fournir. Les challenges supplémentaires ne sont pas encore pris en charge : la session s’arrête avec un message générique, sans afficher les données serveur.

Le contrôleur attend l’état `CONNECTED`, récupère les seules métadonnées réseau nécessaires et compare le réseau hôte à son état initial. Il ne publie pas les lignes management brutes : un `PUSH_REPLY` peut contenir des tokens.

Après `CONNECTED`, il attend au maximum dix secondes que l’IPv4 soit à l’état Windows `IpDadStatePreferred` avant toute autorisation du relais. Une adresse encore provisoire peut être énumérée mais inutilisable pour `bind()` pendant la détection de doublons, comme décrit dans [la documentation Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/netioapi/nf-netioapi-createunicastipaddressentry). Aucun contournement de cette détection n’est appliqué.

Les adresses, DNS, routes, modes strong/weak host et métriques fixes doivent rester identiques. La valeur numérique d’une métrique automatique peut varier avec la vitesse du lien Wi-Fi, conformément au [fonctionnement Windows documenté par Microsoft](https://learn.microsoft.com/en-us/windows-hardware/drivers/network/mib-ipinterface-row) ; le pilote conserve le contrôle du mode automatique et vérifie que le chemin choisi vers APPIGS reste hors du VPN pour les sockets non liées. Il ne modifie pas la métrique du Wi-Fi.

Les métadonnées DNS/passerelle sont extraites de la notification management correspondant au message de push standard. Si elles ne sont pas disponibles, la session s’arrête. Une adresse vérifiée auprès de l’université peut être fournie explicitement :

Le diagnostic peut contenir les seules adresses IPv4 attribuées/résolues et la passerelle validées par le parseur, utiles aux captures. Il ne reproduit pas les messages de push ni les tokens. Ces métadonnées restent locales dans `.local/`, exclu de Git.

```powershell
# Remplacer les variables par des adresses réellement confirmées ; ne pas copier une IP d’exemple.
powershell -NoProfile -File scripts/run-poc.ps1 -Mode connect -VpnDns $dnsUniversitaire -VpnGateway $passerelleVpn
```

Aucun DNS système ou public n’est utilisé comme secours pour les destinations web. Un transport DNS chiffré, un port explicite ou une exigence DNSSEC non pris en charge provoquent un arrêt, jamais une résolution en clair de remplacement.

## Ce que le prototype met en place

1. Copie du relais et, en mode navigateur, du runtime Electron et des sources dans un répertoire de session aléatoire sous `ProgramData\MyNEIGE-PoC`, appartenant aux administrateurs. SYSTEM et administrateurs peuvent écrire ; le compte de session dispose seulement de lecture/exécution. Pas de règle fondée sur le chemin partagé de `electron.exe`.
2. Création d’un TAP dédié avec nom aléatoire, mise en quarantaine WFP avant démarrage du VPN, puis sélection explicite par `--dev-node`. Aucun adaptateur VPN existant n’est réutilisé. OpenVPN est contrôlé par management inversé sur un port exclusif aléatoire de boucle locale ; secret de canal par pipe anonyme et vérification du PID du pair.
3. Profil contrôlé avec `route-noexec`, `route-nopull`, affectation IP par `ip-win32 netsh` pour éviter une dépendance au DHCP sur le TAP confiné, pas de scripts utilisateur ni de DNS global volontairement appliqué.
4. Relais identifié par son chemin de session et son ACL, bloqué par défaut en IPv4/IPv6. Seule l’adresse source et l’interface IPv4 effectivement confirmées après connexion sont autorisées. Les autres exécutables sont bloqués sur cette interface.
5. Route VPN IPv4 de très faible priorité (métrique de route 60000). Aucune route physique existante n’est remplacée. Le pilote refuse si le trafic non lié au relais choisirait le tunnel.
6. DNS natif UDP/TCP et sockets TCP explicitement liés à l’adresse du tunnel et à `IP_UNICAST_IF`. Aucun `getaddrinfo` pour la destination web. Réponses DNS et chaîne CNAME validées.
7. Proxy CONNECT limité au nom APPIGS et au port 443 en console ; le navigateur admet temporairement le domaine universitaire et ses sous-domaines, sur 443 uniquement. Authentification par secret éphémère distinct du mot de passe ENT. Destinations locales et adresses de l’hôte refusées ; au plus 16 flux simultanés et délais bornés.
8. Refus d’un autre exécutable essayant de lier explicitement sa socket à l’interface VPN (erreur 10013 exigée), HEAD HTTPS avec vérification TLS Windows, rejet d’un client proxy non authentifié, puis fenêtre de captures. Le proxy n’affiche pas son secret.
9. Arrêt contrôlé d’OpenVPN puis du relais et vérification que les requêtes échouent. Un Windows Job tue les enfants si le contrôleur disparaît.

Les règles WFP sont persistantes pour que la quarantaine ne disparaisse pas avec le contrôleur. Elles sont retirées après arrêt des processus et retrait de la route. Elles ne constituent pas une protection contre un administrateur qui modifie le moteur de filtrage.

## Capture et verdict

Pour démontrer l’isolation, commencer les captures avant la connexion, simultanément sur l’interface physique et celle du VPN. `READY_FOR_CAPTURE` marque une fenêtre de 1 à 60 secondes avec sondes HEAD répétées toutes les cinq secondes, après la première requête. Effectuer les scénarios R1–R10 du plan, dont une application tierce vers la même destination, une coupure physique et une perte du tunnel.

Attendu : le transport OpenVPN vers le serveur est visible sur l’interface physique ; aucun flux web ni DNS applicatif équivalent n’y apparaît hors tunnel. La résolution initiale du serveur VPN est une exception d’amorçage identifiée. Le DNS habituel de l’hôte et les applications tierces conservent leur chemin.

Les captures peuvent contenir des informations sensibles, en particulier sur la boucle locale. Ne pas capturer/publier le contenu management ou une authentification ; conserver les preuves minimales et nettoyées localement.

Un statut HTTPS et des requêtes bloquées après arrêt ne remplacent pas la capture. Le résultat du programme conserve donc `feasibility: not_yet_certified`. Le rapport de recette indique séparément les preuves exécutées et les cas encore ouverts.

### Capture reproductible J1

```powershell
npm run poc:qualify
npm run poc:analyze
# Uniquement le scénario normal, fenêtre stable plus longue :
powershell -NoProfile -File scripts/qualify-j1.ps1 -NormalOnly -Seconds 30
```

La console UAC demande les identifiants localement pour chaque session. Le scénario complet lance une session normale puis un crash volontaire du contrôleur (code 86), vérifie la mort des enfants et récupère les ressources propres. Ne pas lancer plusieurs recettes simultanément.

Le script refuse de modifier une capture ou des filtres Pktmon préexistants. Il crée ses propres filtres, capture au plus 96 octets par paquet pour DNS/443/STUN/ICMP, puis exporte les composants physiques et TAP. Les ports éphémères du management et du proxy ne sont pas sélectionnés. Les captures restent sensibles et locales, dans `.local/j1/`, exclu de Git ; ne pas les publier sans examen.

Le témoin indépendant est `curl.exe`, sans proxy ni adresse/interface source forcée, vers la même destination. Son port source choisi sert uniquement au rapprochement des paquets. Une preuve physique après fermeture ne remplace pas la preuve pendant le VPN actif. L’analyse exige cette dernière, les DNS UDP/TCP et le transport VPN positivement observés, zéro flux interdit identifié, zéro événement perdu et les routes/DNS restaurés.

Les composants Pktmon de type filtre NDIS ne sont pas des cartes physiques. L’analyse utilise les Miniport et les GUID ; elle gère aussi les trames Wi-Fi natives que l’export Pktmon étiquette Ethernet sur cette machine. Les nombres de paquets sont des observations par composant, pas un comptage dédupliqué des échanges.

## Début de J2 : formulaire et navigateur

```powershell
npm ci
npm run browser:test
npm start
```

Le précontrôle sans identifiants vérifie des serveurs locaux positivement testés : refus TCP IPv4/IPv6, absence effective de datagrammes UDP reçus, enfant Electron bloqué, renderer sans Node et accès au seul port proxy permis. Un retour « envoi UDP réussi » côté Node n’est pas pris pour une preuve de livraison.

Il exerce aussi Chromium lui-même contre un proxy local fictif : `407`, authentification et début TLS, puis fermeture volontaire, sans contacter de site distant. La capture d’aperçu du formulaire est facultative : le compositeur peut refuser une capture de fenêtre masquée ; les contrôles réseau et sandbox restent obligatoires.

`npm start` lance un contrôleur élevé masqué, puis un formulaire Electron non administrateur. Saisir le compte VPN dans ce formulaire. Le pipe nommé est authentifié par le PID du processus supervisé avant tout échange de secret. La fenêtre APPIGS n’apparaît qu’après `CONNECTED`, vérification de l’identité GUID/nom/LUID/index/IP, DNS et HEAD HTTPS. La session web est en mémoire, sans bridge exposé au site ; les vérifications TLS restent actives. L’extension [préremplissage CAS J2](CAS_PREFILL.md) réutilise une copie temporaire en mémoire, limitée à la page CAS attendue et à une seule délivrance. Le clic sur « SE CONNECTER » reste manuel.

Les popups universitaires restent dans la session protégée. Les autres domaines, schémas, ports, téléchargements et permissions sont refusés. La liste de domaines est provisoire et doit être resserrée après le parcours réel ENT/CAS. Fermer le formulaire ou cliquer « Fermer la session » termine la session ; durée maximale 30 minutes. Les diagnostics sont dans `.local/browser/live-session.txt` et le code final dans `exit-code.txt`. Les fichiers de travail Chromium sont sous `.local/browser-data/` ; aucune promesse d’effacement de toutes les copies mémoire ou de la pagination OS.

Le lanceur reste actif jusqu’à la fin du contrôleur. Ce prototype est qualifié avec élévation UAC du même compte Windows ; l’élévation avec les identifiants d’un autre administrateur depuis un compte standard n’est pas qualifiée.

## Arrêt, crash et récupération

Ctrl+C demande un arrêt. Les changements de réseau ou une sortie de `CONNECTED` arrêtent le pilote ; il ne reconnecte pas automatiquement avec d’anciennes adresses.

Si la session précédente a planté, les règles restrictives peuvent subsister. Fermer toute session encore active, puis depuis une console administrateur :

```powershell
powershell -NoProfile -File scripts/run-poc.ps1 -Mode cleanup
```

La récupération lit le journal d’identité du TAP dans le répertoire protégé et retire uniquement cet adaptateur au nom de session validé, puis les règles du fournisseur WFP MyNEIGE et les fichiers connus. Elle n’efface pas de règles tierces, ne tue pas d’autres VPN et ne supprime pas de routes sur la seule base de leur métrique. Une récupération d’adaptateur échouée conserve les restrictions WFP. Si OpenVPN était installé dans un chemin personnalisé, vérifier ce chemin avant récupération : l’outil de récupération utilise actuellement le chemin standard.

## Limites avant le jalon suivant

- Recette sur d’autres machines et configurations indispensable.
- Tests WFP de quarantaine IPv4/IPv6 distincts d’une recette complète du filtrage tunnel.
- IPv6 applicatif bloqué ; les sondes UDP ne remplacent pas une recette WebRTC/HTTP3 complète.
- Parcours ENT/CAS et MFA encore à qualifier ; pas de reconnexion automatique ni de stockage du mot de passe.
- Réseau hôte instable, adaptateur préexistant ou VPN tiers modifiant les routes : arrêt conservateur possible.
- Les routes connectées créées lors de l’affectation de l’IP VPN peuvent entrer en conflit avec un réseau local existant. Le filtrage empêche son utilisation par les applications tierces ; l’absence d’impact transitoire pendant l’initialisation reste à mesurer, et tout conflit interdit la validation du modèle de routage.
- Tests réseau manuels encore nécessaires pour les interfaces, crashs et changements de route ; ne pas annoncer ces cas réussis avec les seuls tests de protocole.
