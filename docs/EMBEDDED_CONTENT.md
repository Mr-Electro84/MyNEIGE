# Vidéos intégrées, H5P et messagerie RENATER

## Fonctionnement

Le menu Université propose **Mail** (`https://partage.univ-avignon.fr/`) et **Nextcloud** (`https://cloud.univ-avignon.fr/`). Ces liens utilisent la fenêtre principale et sa session existante. Les destinations `renater.fr` et leurs sous-domaines sont admis en HTTPS/WSS sur 443, y compris pour les redirections d'authentification, les ressources du webmail et les téléchargements de pièces jointes. Le préremplissage CAS reste limité à son parcours APPIGS vérifié, sans soumission automatique.

Toutes les pages HTTPS de `univ-avignon.fr` et de ses sous-domaines peuvent intégrer les lecteurs YouTube standards (`youtube.com/embed/…`) et sans cookies (`youtube-nocookie.com/embed/…`). L'autorisation concerne aussi les lecteurs imbriqués dans une activité H5P universitaire, une iframe `srcdoc` ou une activité distante `*.h5p.com/content/…/embed` / `h5p.org/h5p/embed/…`.

La page principale doit rester universitaire et toute la chaîne des cadres doit être universitaire, un lecteur admis ou un cadre vide intermédiaire. Une frame manquante ou détruite ne donne aucun droit supplémentaire. La navigation principale et les pop-ups vers YouTube/H5P restent refusés ; les pages `/watch`, les interfaces d'administration H5P et les autres services Google ne sont pas ajoutés à la navigation générale.

## Ressources admises

| Usage | Destinations |
| --- | --- |
| Lecteurs et requêtes YouTube | `*.youtube.com`, `*.youtube-nocookie.com`, depuis le lecteur intégré |
| Flux vidéo et miniatures | `*.googlevideo.com`, `*.ytimg.com` |
| API et ressources du lecteur | `youtubei.googleapis.com`, `youtube.googleapis.com`, `jnn-pa.googleapis.com`, `yt3.ggpht.com`, `www.gstatic.com`, `fonts.gstatic.com` |
| Script complémentaire du lecteur | `www.google.com/js/…`, uniquement dans le contexte YouTube |
| Ressources H5P distantes | `*.h5p.com`, `*.h5p.org`, `*.h5p.io`, `cdnjs.cloudflare.com`, `fonts.googleapis.com`, `fonts.gstatic.com`, uniquement dans le contexte H5P |

Les API `/iframe_api`, `/player_api` et les scripts `/s/player/…` de YouTube peuvent être chargés directement par la page universitaire : H5P les utilise avant de créer le lecteur. Les miniatures `ytimg.com` et les scripts `h5p-resizer.js` des domaines H5P sont également utilisables par cette page. Les flux `googlevideo.com` ne sont admis qu'à l'intérieur d'un lecteur YouTube. Les URL MediaSource `blob:` sont locales et limitées à l'origine du lecteur.

Le relais CONNECT natif admet ces noms sur 443 ; Electron impose en complément les chemins et la provenance des iframes, que le relais TLS ne peut pas inspecter. Les nouveaux domaines sont résolus par les DNS du tunnel, et les connexions restent liées à son interface. Aucune exception WFP directe, modification du proxy système, route physique ou résolution DNS hors VPN n'est ajoutée. Les domaines externes effectivement admis apparaissent dans les diagnostics, sans URL complète ni contenu.

## Validation et limites

`npm test` couvre les politiques JavaScript et natives ; `npm run test:browser` utilise les mêmes fenêtres et filtres Electron. Les scénarios locaux incluent deux domaines universitaires distincts, le lecteur sans cookies, H5P universitaire et distant, `srcdoc`, le chargement de l'API, le décodage et l'avancement d'une vidéo VP8 synthétique, les refus hors contexte et les redirections/ressources RENATER. Les deux nouveaux liens sont aussi contrôlés avec le menu existant : session conservée, historique, disponibilité du VPN et accès depuis un pop-up.

Validation de développement du 24 octobre 2026 : `npm test` réussit (29 tests de protocole natif, test du coffre DPAPI sans vrais identifiants, inspection du profil et 36 tests Node) ; les 38 vérifications Chromium passent, dont les redirections du lecteur intégré. `npm run browser:test` exécute aussi ces fixtures sous confinement WFP. Les réponses sont synthétiques : elles ne constituent pas une lecture réelle de YouTube ni une connexion réelle à PARTAGE/Nextcloud. La recette avec VPN et compte universitaire reste à réaliser. Aucun média étudiant ni compte n'est utilisé par les tests automatisés.

Le précontrôle WFP du 24 octobre 2026 réussit également : sondes IPv4/IPv6 et processus enfant bloqués, aucun datagramme reçu par les récepteurs témoins, seul proxy local admis, puis scénarios CAS et navigateur réussis. Ce résultat local ne valide pas le parcours YouTube/PARTAGE sur le VPN universitaire réel.

Les politiques CSP et `Permissions-Policy` des sites, les vidéos privées ou interdites à l'intégration, une restriction YouTube liée au VPN et les erreurs d'une version H5P demeurent applicables. MyNEIGE conserve le Referer envoyé par le navigateur ; il ne le falsifie pas si une page le supprime. YouTube exige une identification du client via ce Referer : une intégration qui le supprime peut afficher l'erreur 153. Les domaines nécessaires aux fournisseurs peuvent évoluer ; étendre la liste doit rester ciblé et testé.

Références : [lecteurs YouTube](https://developers.google.com/youtube/player_parameters), [identification du lecteur et Referer](https://developers.google.com/youtube/terms/required-minimum-functionality#youtube-embedded-player-and-video-playback), [domaines H5P.com](https://help.h5p.com/hc/en-us/articles/14980108131997-Domains-used-by-h5p-com), [bibliothèque vidéo H5P](https://github.com/h5p/h5p-video), [PARTAGE RENATER](https://www.renater.fr/services/collaborer-simplement/partage/).
