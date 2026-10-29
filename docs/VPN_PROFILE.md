# Profil VPN personnel

MyNEIGE ne fournit ni ne télécharge de configuration VPN. L’utilisateur récupère personnellement son fichier depuis le site officiel de la DOSI, puis choisit **Importer un profil** dans le formulaire local. Une validation technique ne garantit pas sa provenance universitaire : importer uniquement un fichier obtenu par un canal de confiance.

## Import, remplacement et suppression

Sans profil accepté, les champs de connexion et Windows Hello restent inactifs. Un profil valide est copié, chiffré avec DPAPI et protégé par les ACL du compte Windows sous `%LOCALAPPDATA%\MyNEIGE\vpn-profile.dpapi`. Le fichier d’origine n’est jamais modifié. La copie ne dépend ni du dossier d’installation ni des données temporaires du navigateur ; elle persiste après relancement.

**Remplacer le profil** ouvre le sélecteur Windows. Une annulation ou un profil refusé conserve le précédent. Un échec d’écriture conserve l’ancien fichier chiffré et bloque la connexion jusqu’à une nouvelle validation. **Supprimer le profil local** supprime uniquement la copie gérée par MyNEIGE, sans effacer le fichier personnel d’origine ni les identifiants mémorisés. Les erreurs ne sont pas annoncées comme une suppression réussie.

Le profil est figé dès le clic de connexion ; fermer puis relancer MyNEIGE pour le remplacer ou le supprimer. Le profil reste une donnée de configuration personnelle : ne pas le joindre aux rapports de problème ou aux publications du projet.

## Compatibilité et protections

Le périmètre initial est volontairement limité : client TUN, un serveur DNS ou IPv4, transport TCP/IPv4, authentification utilisateur/mot de passe sans fichier, CA X.509 unique intégrée et `remote-cert-tls server`. La liste négociée `ncp-ciphers` ou `data-ciphers` et le digest `auth` sont issus du profil, parmi les algorithmes explicitement pris en charge par le validateur. Les directives classiques `client`, `tls-client`, `persist-key`, `persist-tun`, `resolv-retry infinite` et `setenv CLIENT_CERT 0` sont admises sans ouvrir d’exécution de script.

Les scripts, plugins, fichiers de clés/certificats externes, inclusions, serveurs multiples, UDP et réglages réseau arbitraires sont refusés. Les limites de taille sont de 64 Kio exclus pour le fichier et 20 Ko pour le certificat décodé. Le profil est reconstruit par le contrôleur : il impose la vérification TLS du serveur, désactive les scripts utilisateur et la compression, et conserve les règles de routage et DNS propres à MyNEIGE. Aucun hôte ni certificat universitaire connu ne sert à décider si un profil est accepté.

Le sélecteur est réservé au formulaire local. Le renderer ne reçoit ni contenu du profil, ni chemin de stockage, ni empreinte. Le contrôleur élevé reçoit le contenu par le pipe authentifié, pas un chemin utilisateur à ouvrir. Les échanges sont bornés et acquittés ; le contrôleur ne lance OpenVPN qu’après sélection validée et demande de connexion explicite.

Les identifiants enregistrés sont liés à l’empreinte du profil normalisé. Un profil différent et les anciens coffres sans liaison nécessitent une nouvelle saisie manuelle et un nouvel enregistrement facultatif. Un changement de profil annule les opérations Hello en cours. Le préremplissage CAS reste à usage unique et ne soumet jamais le formulaire.

## Développement

`npm start` ouvre le formulaire sans exiger de profil dans le dépôt. Les commandes console qui lisent un profil exigent `-Profile` avec un chemin explicite. `npm test` utilise exclusivement `tests/fixtures/synthetic.ovpn` et une CA fictive sans clé privée distribuée ; aucun profil ou compte personnel n’est lu.

Les profils personnels et coffres DPAPI sont exclus de Git. Les constructions utilisent des listes explicites de ressources et les contrôles de paquet refusent les fichiers `.ovpn`. La distribution demeure suspendue pendant la purge ; aucune construction distribuable n’est nécessaire pour tester cette fonctionnalité.
