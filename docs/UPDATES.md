# Vérification et installation des mises à jour

## État actuel : fonctionnalité à venir

La vérification automatique et manuelle par API est temporairement désactivée (`UPDATE_CHECK_ENABLED = false`). L’hébergement actuel intercepte les appels applicatifs et renvoie une page HTML de validation JavaScript (`/aes.js`, cookie `__test`) au lieu du JSON attendu, même avec un statut HTTP 200.

**Aide → Vérifier les mises à jour** affiche désormais un toast **Fonctionnalité à venir**, avec **Voir le site web** et **Fermer**, dès le formulaire et sans connexion universitaire. Le bouton ouvre uniquement l’URL fixe `https://my-neige.42web.io/` dans le navigateur par défaut. Aucun appel automatique de version n’est lancé ; aucune alerte d’indisponibilité de l’API n’est présentée. La reprise du contrôle par API attend un hébergement compatible.

## Implémentation préparée, actuellement désactivée

Les paragraphes suivants décrivent le mécanisme conservé pour une future activation. Le remplacement par NSIS reste indépendant et inchangé.

La version installée et sa révision sont lues dans `package.json`. La révision est un entier positif strictement croissant à chaque publication : **2 pour 1.0.2-alpha.1** (précédemment 1 pour 1.0.1-alpha.1). Incrémenter `revision` en même temps que `version` pour chaque nouvelle livraison. La construction recopie ces deux champs dans le paquet ; ne pas utiliser `app.getVersion()`, qui désigne Electron dans ce lancement supervisé.

Une fois les relais de la session prêts, l’application consulte une seule fois `https://my-neige.42web.io/update.php?flag=version`. Cette étape intervient après la connexion VPN, mais **l’appel HTTPS et sa résolution DNS passent hors VPN**, par le relais public confiné sur le réseau habituel. Le formulaire reste local et sans accès réseau ; une session Chromium dédiée ne partage aucun cookie universitaire. Seul le nom exact `my-neige.42web.io` est ajouté aux destinations du relais public. Les politiques de navigation des sites universitaires restent inchangées.

Le serveur doit répondre HTTP 200 avec ce JSON :

```json
{"version":"1.0.2-alpha.1","revision":2}
```

Un toast local, non modal, apparaît en bas de l’écran si **la version diffère et la révision reçue est supérieure**. Il ne prend pas le focus et reste visible jusqu’au choix de l’utilisateur :

- **Télécharger la mise à jour** consulte `https://my-neige.42web.io/update.php?flag=goto` puis ouvre le lien HTTPS externe validé dans le navigateur par défaut. Cette API doit retourner HTTP 200 et une URL en texte brut, une chaîne JSON ou un objet `{"url":"https://…"}`. Elle ne doit pas répondre par une redirection HTTP. Aucun exécutable n’est téléchargé ni lancé automatiquement par MyNEIGE.
- **Me rappeler plus tard** ferme le toast pour ce lancement. La vérification est renouvelée au prochain lancement et à la prochaine connexion.
- **Ne plus me rappeler** conserve le refus pour le compte Windows, y compris pour les versions futures, puis affiche l’alerte demandée rappelant le site MyNEIGE.

Le refus est stocké dans `%LOCALAPPDATA%\MyNEIGE\update-preferences.json`, hors du répertoire variable de session. Il survit aux mises à jour et désinstallations ordinaires. Quand MyNEIGE est fermé, supprimer ce fichier réactive les propositions. Le raccourci d’effacement des données locales le supprime également.

**Aide → Vérifier les mises à jour**, dans le formulaire comme dans les fenêtres universitaires et leurs pop-ups, relance explicitement le contrôle. Cette action reste possible après un report ou un refus des rappels automatiques, sans réactiver ces derniers. Une version disponible affiche le même toast et ses trois choix ; une version à jour ou un service indisponible affiche un toast d’information avec un bouton Fermer. Avant la préparation des relais de session, le toast invite à établir la connexion MyNEIGE. Les contrôles et les actions déjà en cours ne sont pas lancés en double.

Un délai de dix secondes, une limite de 8 Kio et le refus des redirections HTTP encadrent chaque appel API. Une panne ou une réponse invalide n’interrompt pas la session universitaire ; une erreur au clic reste dans le toast avec possibilité de réessayer ou de reporter. La perte de session, l’expiration et la fermeture annulent les requêtes et retirent le toast. Il n’existe aucun repli réseau direct.

## Remplacement par NSIS

Après les pages d’accueil et de licence, le nouvel installateur détecte l’installation précédente au chemin protégé fixe (`Program Files\MyNEIGE`), via le registre 64 bits et le désinstalleur présent. Il refuse un emplacement inattendu ou une installation détectée sans désinstalleur.

Il copie le précédent désinstalleur dans son répertoire temporaire NSIS, l’exécute silencieusement et attend sa fin avec `_?=`. L’ancien programme retire les fichiers de **son propre inventaire**, y compris ceux devenus obsolètes dans la nouvelle version. Les fichiers personnels non inventoriés, les données locales, les identifiants et OpenVPN sont conservés.

Le verrou d’installation supplémentaire reste détenu pendant cette transition. Les verrous historiques du lanceur et de la session sont temporairement libérés pour permettre aux anciens désinstalleurs de fonctionner, puis réacquis avant toute copie. Une application qui démarre pendant cet intervalle empêche la poursuite de l’installation. Tout échec de nettoyage ou présence résiduelle du lanceur, du désinstalleur ou de l’inscription de désinstallation interrompt l’installation. Ce mécanisme ne fournit pas de retour automatique à l’ancienne version après une erreur de copie : conserver le paquet précédent pour une réparation manuelle.

Les futurs désinstalleurs vérifient en plus la disparition des fichiers inventoriés avant de retirer l’inscription Windows ; les dossiers contenant des fichiers personnels restent conservés sans suppression récursive.

## Validation

`npm test` couvre les protocoles natifs, dont le nom exact de l’API et sa classification publique, et les tests Node (comparaison, refus persistant, report, erreurs, lien externe et arrêt pendant une requête).

`npm run test:updates` utilise Electron, un proxy CONNECT authentifié et un serveur TLS locaux. Il vérifie l’absence de résolution locale de la cible, les limites HTTP, le timeout, le toast sandboxé, l’origine des actions IPC et le refus persistant. Sa dérogation TLS est limitée à la session de test. La capture du toast est `.local/updates/toast.png`.

Pour une recette réelle avec `npm start`, publier temporairement une version différente avec une révision supérieure, vérifier le toast et ses trois choix, le report au redémarrage, le refus persistant et le lien réel retourné par `goto`. Tester une API indisponible, puis une perte de VPN/relais pendant l’appel. Une capture réseau doit confirmer le DNS et HTTPS de l’API sur le réseau habituel et le maintien des services protégés dans le tunnel.

Après autorisation explicite de construire un installateur, `scripts/test-installer.ps1` peut recevoir `-PreviousInstaller` pour partir d’un ancien paquet et contrôler les fichiers devenus obsolètes. Tester aussi une session active, un fichier installé verrouillé, une ancienne inscription invalide et la conservation des fichiers personnels. Ces essais installent et désinstallent réellement MyNEIGE : les réaliser sur un poste/une VM de recette sans installation existante. La simple compilation native et les tests de protocole ne démontrent ni cette recette NSIS ni l’isolation réseau réelle.

Validation du 27 octobre 2026 : `npm test` réussi (38 tests natifs, coffre DPAPI fictif, inspection du profil et 69 tests Node) ; `npm run test:updates` réussi et toast contrôlé visuellement ; `npm run test:browser` réussi (48 vérifications) ; `npm run browser:test` réussi sous WFP, dont les scénarios de renouvellement et expiration. `npm start` atteint le formulaire, puis fermeture normale (code 0), sans saisie d’identifiants ni connexion universitaire. Le prétraitement NSIS `/SAFEPPO` et l’analyse syntaxique des scripts PowerShell réussissent sans produire d’installateur. Le test autonome `npm run test:session` rencontre `UnknownVizError` pendant une capture, sur deux essais ; le parcours de session sous WFP passe. L’API réelle est inaccessible depuis l’environnement de validation : son contenu réel, la sortie réseau publique réelle de ces appels et l’installation/remplacement NSIS restent à qualifier. Aucune distribution construite.

Références : [requêtes Chromium Electron](https://www.electronjs.org/docs/latest/api/net/), [arguments NSIS et attente du désinstalleur](https://nsis.sourceforge.io/Docs/Chapter3.html).

Ajout du menu Aide, validé le 27 octobre 2026 : 72 tests Node réussis, test Electron des mises à jour réussi (menus du formulaire et universitaire, contrôle manuel malgré le refus des rappels, résultats à jour/erreur en toast), et 48 vérifications de navigation réussies. Recette `npm start` : entrée de menu présente et active, clic avant connexion affichant le toast « Connexion nécessaire », fermeture normale de l’application (code 0), sans authentification universitaire. L’API réelle n’a pas été validée et aucune distribution n’a été construite.
