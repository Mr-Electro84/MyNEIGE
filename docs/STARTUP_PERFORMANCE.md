# Démarrage : corrections de priorité 1

Le lancement normal d'une distribution utilise désormais un seul processus Windows PowerShell : le script de préparation OpenVPN est appelé dans ce processus, puis l'UAC démarre directement le contrôleur natif. Les chemins d'installation/réparation d'OpenVPN conservent leur orchestration existante. Le lancement de développement suit le même principe.

## Intégrité du paquet

`payload-check` vérifie en code natif l'arbre sans points de réanalyse, chaque empreinte SHA-256, les chemins, les doublons insensibles à la casse, les fichiers obligatoires et la cohérence de version. Les empreintes sont recalculées à chaque lancement ; aucune décision n'est fondée seulement sur la date ou la taille des fichiers. Les scripts conservent le contrôle historique en repli lorsque le contrôleur n'est pas encore construit.

## Runtime Electron protégé

Le contrôleur prépare un cache administratif sous `%PROGRAMDATA%\MyNEIGE-PoC\cache-<empreinte>`. Son identité dépend du contenu du runtime et du compte interactif. Seuls les binaires publics d'Electron y sont conservés ; le coffre, les cookies et les identifiants n'en font pas partie.

Au premier usage d'un runtime, ses fichiers sont copiés dans ce cache et protégés en lecture/exécution pour le compte interactif. Aux usages suivants, le contrôleur vérifie les permissions et recalcule les empreintes du cache contre le manifeste distribué. En développement sans manifeste, les empreintes des sources sont également recalculées.

Chaque session crée des liens physiques vers les fichiers vérifiés dans son propre dossier `browser/runtime`. Le chemin de l'image utilisé par WFP et le contrôle de filiation du coffre restent propres à cette session. Les sources du programme ne sont jamais liées directement au cache. Les petits fichiers applicatifs restent copiés dans le staging de session.

Une population interrompue, sans marqueur de fin, est reconstruite. Une corruption d'un cache terminé interrompt le démarrage avant son utilisation. Un nouveau contenu Electron produit un nouveau cache ; les générations antérieures sont supprimées par le nettoyage administratif existant, notamment à la désinstallation. Un cache occupe environ 357 Mio par contenu et compte ; les liens de session n'ajoutent pas une seconde copie de ces données. Le premier lancement doit encore constituer le cache.

## Validation locale du 24 octobre 2026

- Compilation C++ avec les avertissements traités comme erreurs.
- 30 tests JavaScript, 28 tests natifs, 35 vérifications du paquet et 46 contrôles de préparation OpenVPN.
- Test élevé du cache : fichiers partagés entre sessions, absence de lien avec les sources, lecture seule avec le jeton du navigateur, nouvelle génération après modification, refus de corruption, récupération après interruption et contrôle des ACL de nettoyage.
- Précontrôle Electron élevé : WFP IPv4/IPv6/UDP, enfants, sandbox, proxy authentifié, coffre en lecture d'état uniquement, CAS simulé, navigation et téléchargements.
- Aucun identifiant fourni ni connexion au VPN universitaire pendant cette validation.

Sur le véritable runtime distribué, dans un même essai local : copie historique **3 141 ms**, préparation avec cache déjà présent **641 puis 640 ms**. Le précontrôle du navigateur a ensuite préparé le même runtime en **578 ms**. Ces valeurs isolent cette étape ; elles ne constituent pas une mesure du parcours complet jusqu'à CAS.

Comparaison alternée sur les mêmes fichiers installés, hors environnement restreint : vérification historique **2,049 / 1,052 / 1,056 s**, vérification native **0,873 / 0,582 / 0,639 s**. La préparation OpenVPN, avec les processus PowerShell nécessaires et un nouveau processus à chaque essai, a pris **10,036 / 9,151 s** avec l'ancien lancement imbriqué, contre **7,203 / 7,046 s** avec l'appel direct. Le processus PowerShell élevé a également été supprimé, mais son gain n'a pas été isolé dans cette comparaison. Les interactions et le réseau empêchent d'en déduire un temps total garanti.

Le test complet `MyNEIGE.exe --browser-test` du paquet reconstruit a réussi, notamment le chemin réel d'UAC et d'écriture des journaux. L'installateur de cette recette locale a été compilé avec `/XSetCompressor /FINAL /SOLID zlib` pour accélérer sa construction ; le script de distribution conserve LZMA par défaut. Ce choix concerne la compression du paquet et ne modifie pas le comportement du programme installé.

Les journaux ajoutent `STARTUP_PAYLOAD` et `STARTUP_PREREQUISITES` dans le diagnostic du lanceur, puis `STARTUP_TAP`, `STARTUP_BROWSER_PREPARED`, `STARTUP_FORM_READY`, `STARTUP_VPN_READY` et `STARTUP_RUNTIME` dans celui du contrôleur. Les durées sont en millisecondes ; les étapes du contrôleur sont cumulées depuis son entrée dans la préparation de session. La mesure complète inclut aussi les interactions UAC/Hello/CAS et les délais des serveurs.
