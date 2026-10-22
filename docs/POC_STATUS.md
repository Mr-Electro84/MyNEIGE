# État de validation du pilote Windows

Date : 22 octobre 2026. Ce rapport distingue le code livré des preuves réellement obtenues.

## Réalisé

- Pilote C++/Win32 en console ; scripts de compilation, précontrôle, tests privilégiés et connexion interactive.
- Profil source conservé intact (SHA-256 identique à celui du plan).
- Configuration dérivée restrictive, contrôle management en mémoire, vérification du PID et des signatures.
- Relais CONNECT authentifié, DNS IPv4 UDP/TCP et sockets liés au tunnel, règles WFP et route de faible priorité.
- TAP dédié à chaque session, quarantaine avant OpenVPN, supervision par Job et récupération ciblée.
- HEAD HTTPS de validation, sondes répétées et essais de perte de tunnel/relais implémentés.
- Interface finale, intégration navigateur Electron, Linux et packaging différés.

## Vérifications exécutées

| Vérification | Résultat acquis |
| --- | --- |
| Compilation MSVC x64, C++20, `/W4 /WX`, SDK Windows 26100 | Réussie. |
| Tests de protocole, validation de profil, DNS, CONNECT et classement des erreurs | `npm test` réussi : 26 tests passent, dont cadrage management, refus d’un abaissement d’exigence DNS, diagnostics sans tokens et distinction entre métrique automatique et fixe. Aucun changement réseau par ces tests. |
| Profil universitaire réel | Accepté par le validateur ; source inchangée. |
| Précontrôle WinHTTP | Construction de chaîne limitée au cache disponible sur cette machine. |
| WFP IPv4 et IPv6 | Blocage réel du processus isolé : erreur Winsock 10013, avec contrôles positifs. |
| Persistance WFP | Quarantaine conservée après fermeture/réouverture de la connexion de gestion WFP. |
| Autorisation WFP | Contrôle positif local avec socket explicitement liée à l’adresse et à l’interface autorisées, sous la même quarantaine du relais. |
| Autre image d’exécutable | Connexions locales autorisées pendant la quarantaine du relais. Ce test ne remplace pas R2 vers le site réel. |
| Nettoyage WFP | Connexion du relais de nouveau possible après retrait des seules règles du pilote. |
| TAP dédié | Création, quarantaine et retrait testés ; routes et interfaces de référence restaurées. |
| Canal management OpenVPN | Authentification du canal, PID du pair vérifié, demande d’identifiants reçue ; arrêt et nettoyage sans soumettre de compte. |
| Dialogue management complet en boucle locale | Données fictives acceptées, attente libérée, connexion TCP locale du PID OpenVPN vérifiée. Aucun serveur universitaire contacté par ce scénario. |
| VPN universitaire réel | Authentification réussie, chaîne de certificat vérifiée et état `CONNECTED` atteint. Adresse IPv4, deux DNS et passerelle reçus. Comparaison du réseau hôte passée avant démarrage du relais. |
| DNS du relais | Résolution IPv4 d’APPIGS réussie par les DNS poussés, avec socket liée au tunnel. |
| HTTPS APPIGS | HEAD avec certificat TLS vérifié : réponse HTTP `302`, puis cinq sondes répétées réussies pendant 30 secondes. Aucune redirection suivie ni corps de page collecté. |
| Application tierce sur le tunnel | Tentative du contrôleur, autre image que le relais, explicitement liée à l’interface VPN : refus réel `WSAEACCES` 10013. Le chemin non lié vers APPIGS reste hors VPN. |
| Authentification proxy | Client sans secret refusé par HTTP `407`. |
| Perte du VPN puis du relais | Requête bloquée après arrêt d’OpenVPN, puis après arrêt du relais. Pas de succès HTTP de secours. |
| Fin de session réelle | Code de sortie `0` ; TAP, route et règles propres retirés, comparaison du réseau hôte à la référence réussie. |

Les sorties locales des tests privilégiés sont conservées dans `.local/poc/`, exclu de Git. Les quatre contrôles locaux utilisent uniquement des données fictives ou s’arrêtent avant soumission du compte. L’essai VPN réel utilise une saisie masquée dans la console ; les identifiants ne figurent pas dans les diagnostics. Un faux positif sur un avertissement de chiffrement au démarrage a été corrigé et couvert par un test de régression.

## Dépendances vérifiées

- Windows x64, build 26200.9457 ; MSVC 14.44 et SDK 10.0.26100.0.
- OpenVPN Community 2.7.8-I001 x64 et pilote TAP installés. Exécutables OpenVPN/tapctl signés par OpenVPN Inc. ; version observée 2.7.8.0.
- MSI officiel vérifié : SHA-256 `1EA61A3056905B90607D4B0F084C04E5CF3043E07CF192D9CD44B0474F29CC49`.
- Aucune GUI OpenVPN ni service automatique sélectionné lors de cette préparation.

## Non démontré à ce stade

- Parcours web authentifié ENT/CAS ; une réponse `302` ne démontre pas une connexion web réussie.
- Absence de fuite physique/DNS par captures, transitions de réseau et comparaison d’une application tierce vers la même destination.
- Crash brutal du contrôleur, veille, reconnexion, réseau tiers et DNS tronqué nécessitant TCP sur le serveur réel.
- Comportement Electron, WebRTC/QUIC et séparation des privilèges du relais.

## Essai réel réussi et corrections vérifiées

La session réelle a atteint `CONNECTED`, résolu APPIGS et reçu six réponses HTTPS `302` au total. Les essais de refus et de perte de VPN/relais sont passés, puis le nettoyage et la comparaison finale du réseau hôte ont réussi. Le diagnostic nettoyé de cet essai est dans `.local/poc/live-session.txt` ; son code de sortie est `0`.

Les essais ont permis de corriger le dialogue management (accusés spécifiques et séquencement), un faux positif sur les variations de métrique automatique Wi-Fi, puis une course à l’initialisation IPv4 : l’adresse était énumérée mais `bind()` échouait par `10049` avant la fin de la détection de doublons Windows. Le contrôleur attend désormais `IpDadStatePreferred`, avec un délai maximal de dix secondes. L’essai réel complet passe après cette correction. La métrique du Wi-Fi et la détection de doublons ne sont pas modifiées.

**Verdict : faisabilité fonctionnelle du pilote Windows démontrée, du VPN à la réponse HTTPS via le relais.** La validation complète de l’isolation reste ouverte : captures et reste de la recette R1–R10 nécessaires avant validation de J1. Interface Electron, parcours ENT/CAS et packaging restent différés.
