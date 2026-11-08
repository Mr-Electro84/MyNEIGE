# Relais natifs dédiés — 8 novembre 2026

Le contrôleur ne se copie plus sous les noms des relais. Chaque rôle possède un exécutable compilé depuis une liste fermée de sources :

| Exécutable | Responsabilités |
| --- | --- |
| `myneige-poc.exe` en développement, `myneige-controller.exe` dans un paquet | Supervision élevée, OpenVPN, TAP, routes et règles WFP propres à MyNEIGE, lancement des enfants. |
| `myneige-relay.exe` | Relais VPN : DNS et connexions liés à l’interface vérifiée ; délégation des seuls services publics autorisés au second relais. |
| `myneige-public-relay.exe` | Relais des services publics autorisés, lié au réseau habituel sélectionné par le contrôleur. Aucun permis sur le VPN. |
| `myneige-vault.exe` | Stockage local DPAPI et Windows Hello ; sans réseau. |
| `myneige-probe.exe` | Sondes de développement pour les tests WFP, de privilèges et de cache. Absent des paquets. |

## Construction et séparation

`npm run poc:build` compile les composants de développement. `scripts/build-relays.ps1` produit les deux relais et les sondes. Les relais utilisent les modules réseau partagés, le hachage et la consultation de provenance du parent ; ils ne lient aucun fichier source du contrôleur ou du coffre. Le rôle VPN ou public est fixé à la compilation et ne peut pas être changé par un argument ou par le pipe.

Les imports PE sont contrôlés après compilation : sockets et lecture des interfaces sont autorisées ; WFP, modification des routes, création de processus, modification de jetons, autocopie et DPAPI sont refusés. Le contrôleur conserve les opérations administratives. Les anciennes commandes de travailleur ne sont plus proposées par son point d’entrée.

## Préparation d’une session

Le contrôleur recherche les relais dans son propre répertoire, puis en conserve une copie dans le dossier protégé de la session. Il refuse un auxiliaire identique au contrôleur, vérifie l’intégrité après copie et exige deux images distinctes pour les relais. Un fichier manquant entraîne un refus ; aucune autocopie de secours n’est prévue.

Les images de session restent protégées contre l’écriture par l’utilisateur et disposent chacune de leur identité WFP. Les relais sont lancés sans privilèges administrateur, dans les Jobs existants. Leur configuration et les secrets éphémères passent par le pipe anonyme hérité. Ils exigent un parent élevé et refusent une configuration destinée à l’autre rôle. L’écoute reste locale et authentifiée. Les connexions et le DNS protégés ne disposent d’aucun repli vers le réseau habituel.

Les sondes sont préparées seulement à la demande des tests. Elles ne sont jamais utilisées comme relais et ne font pas partie du manifeste distribuable. La récupération conserve la prise en charge des anciens noms de fichiers de session.

## Vérifications

- `powershell -NoProfile -File scripts/test-relays.ps1` vérifie les imports et leurs empreintes, les rôles annoncés, le refus des commandes étrangères et des démarrages hors session.
- `npm test` ajoute les tests natifs, le coffre fictif, les manifestes sur fichiers texte factices et les tests JavaScript, dont la séparation des graphes de sources.
- `npm run poc:wfp-test` vérifie les règles WFP avec l’image de sondes dédiée ; `npm run browser:test` exerce Electron et les contrôles des relais, dont le refus d’une inversion des rôles.
- `npm start` reste le point d’entrée de la recette de développement ; les essais VPN réels nécessitent le profil personnel et la participation du mainteneur.

Cette séparation réduit les responsabilités de chaque processus. Elle ne permet pas, à elle seule, d’affirmer que la détection Defender initiale était un faux positif ni qu’aucune alerte ne pourra réapparaître. Aucun réglage Defender n’est modifié pour les validations.

Les scripts de packaging et les deux vérificateurs de manifeste exigent les relais dédiés. Leur adaptation ne vaut pas validation d’une distribution : aucune construction distribuable n’est autorisée dans cette phase.

## Résultats sur ce poste le 8 novembre 2026

- Compilation MSVC `/W4 /WX` des cinq composants réussie ; audit des imports PE des deux relais réussi. Leurs empreintes sont distinctes et associées aux rapports locaux de compilation.
- 42 tests natifs, test du coffre DPAPI avec données fictives, inspection du profil synthétique et neuf contrôles de manifeste sur fichiers texte factices réussis.
- 114 tests JavaScript réussis hors du bac à sable. Dans le bac à sable, trois tests SSH utilisant localhost échouaient ; ils réussissent dans l’environnement de développement normal.
- Tests des points d’entrée : rôle annoncé conforme, commandes étrangères et démarrages hors session refusés. Le test d’intégration refuse aussi les configurations destinées à l’autre rôle, avec extinction du travailleur.
- Précontrôle WFP réussi : blocage IPv4/IPv6 persistant après reconnexion du moteur, autorisation limitée à l’adresse/interface choisie, autre image inchangée et nettoyage vérifié. Les sondes de privilèges et de cache réussissent avec le nouvel exécutable de développement.
- Intégration Electron/WFP réussie : contrôles locaux du relais public, quarantaine, UDP, enfants, sandbox, proxy TLS authentifié, coffre, CAS avec clic manuel, navigation, téléchargements, runtime SSH et cycle de session. Ces essais n’utilisent pas le VPN réel.
- `npm start` : formulaire prêt après 11 328 ms, puis fermeture normale avec code zéro ; aucun lancement OpenVPN pour une connexion n’est observé pendant cet essai. Aucun identifiant n’a été saisi ni déverrouillé.
- Contrôle Defender en lecture seule après compilation et recettes : protection antivirus et protection en temps réel actives, signatures `1.463.191.0`, aucune nouvelle détection MyNEIGE observée. Les derniers événements restent ceux de 18 h 49 et 18 h 51, antérieurs au correctif. Ce constat ne clôture pas automatiquement l’incident.

La recette VPN réelle, la réutilisation Hello et les pertes de VPN/relais avec contrôle réseau restent à confirmer avec le mainteneur. Aucune distribution n’a été construite et aucun changement n’a été poussé.
