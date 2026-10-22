# État de validation du pilote Windows

23 octobre 2026. Ces résultats concernent cette machine et les scénarios effectivement exécutés. J1 dispose maintenant de captures et d’une décision d’architecture ; sa recette complète reste ouverte. J2 a commencé, sans interface finale ni packaging.

## Résultats acquis

- Compilation MSVC x64 C++20, `/W4 /WX`, SDK Windows 26100 ; 27 tests natifs et 10 tests JavaScript réussis.
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
| R12 | Formulaire réel, VPN et page CAS `200` affichée, confirmée par l’utilisateur. Connexion ENT et parcours complet APPIGS non testés par l’utilisateur. |
| R13/R14 | Crash contrôleur et récupération propres acquis ; autres étapes, concurrence et reprise à compléter. |
| R15 | Différé avec packaging J3. |
| R16 | Aucun fichier/argument de credentials ni trace management brute volontairement produit. Caches Chromium sous `.local/` ; aucune garantie d’effacement de toutes les copies mémoire/OS. |

## Début de J2

Formulaire local, bridge limité, pipe authentifié par PID et session web séparée implémentés. Les images Electron sont copiées dans un répertoire de session protégé ; la quarantaine précède le démarrage de l’arbre de processus. Les fenêtres distantes n’ont aucun preload ; sandbox, isolation de contexte et TLS restent actifs. Le seul permis réseau est le proxy TCP local de la session avec secret éphémère.

L’essai local complet passe : réponse `407`, authentification du proxy et début TLS réellement reçus, puis fermeture volontaire du transport sans serveur distant. Il couvre une correction nécessaire : la règle de résolution Chromium doit exclure l’adresse numérique du proxy `127.0.0.1`, sans ajouter de permis WFP.

L’essai réel via formulaire établit le VPN et obtient le HEAD HTTPS `302`, puis charge CAS : `BROWSER_PAGE host=cas.univ-avignon.fr status=200`. L’utilisateur confirme que la page CAS est affichée et indique n’avoir pas testé la connexion ENT. Un statut APPIGS `200` est également observé dans les diagnostics, mais il ne démontre pas à lui seul un parcours authentifié : aucune page étudiante ni donnée de compte n’a été inspectée. Domaines observés : `www.appigs.univ-avignon.fr`, `cas.univ-avignon.fr` ; navigation/ressources annexes : `dosi.univ-avignon.fr`, `services.univ-avignon.fr` (une réponse `404`) et `stats-web2.univ-avignon.fr`. Leur nécessité pour le parcours authentifié n’est pas établie.

Fermeture réelle du formulaire : processus arrêtés, requêtes après perte VPN puis relais bloquées, nettoyage et comparaison finale du réseau réussis, sortie `0`. Diagnostics : `.local/browser/live-session.txt`, `.local/browser/exit-code.txt`. Le précontrôle local complet est dans `.local/poc/browser-test.txt`. Les captures J1 ci-dessus concernent le mode console ; une capture complète du parcours navigateur/CAS reste à acquérir.

La politique provisoire admet HTTPS/WSS 443 pour `univ-avignon.fr` et ses sous-domaines. Les domaines exacts du parcours doivent être identifiés avant resserrement. Permissions, téléchargements et ouvertures externes refusés ; compte web éventuel saisi manuellement.

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
