# Consignes de travail — MyNEIGE

## Projet et priorités

MyNEIGE est une application Windows associant une interface Electron et des composants natifs C++/Win32 pour accéder aux services universitaires via un VPN limité à l’application.

Les priorités de développement sont, dans cet ordre :

1. La stabilité et la prévention des plantages et régressions.
2. Les performances.
3. L’amélioration de l’interface, à développer progressivement à l’avenir.

Ces priorités s’appliquent dans le respect des garanties de sécurité et d’isolation ci-dessous.

## Autonomie et accord préalable

- Poursuivre de façon autonome les corrections locales, les changements ciblés et les vérifications de développement nécessaires à la demande.
- Demander l’accord de l’utilisateur avant de mettre en œuvre un changement d’envergure. Cela concerne notamment une refonte d’architecture, une modification importante du comportement de l’application ou une extension substantielle du périmètre demandé.
- Avant cette demande d’accord, expliquer le changement envisagé, son intérêt et ses principales conséquences. L’analyse en lecture seule peut être effectuée pour préparer cette proposition.
- Toute construction d’une version standalone ou distribuable nécessite un accord explicite préalable de l’utilisateur. Cela inclut notamment `npm run dist:win`, `npm run dist:dir` et toute commande équivalente produisant un dossier autonome, un ZIP portable ou un installateur.
- Une demande de correction, de test ou de validation en développement ne vaut pas autorisation de construire une distribution. Ne pas ajouter spontanément cette étape pour terminer une tâche.

## Garanties à préserver

- Les requêtes web et la résolution DNS de la session protégée passent par le VPN. Une perte du VPN ou du relais doit bloquer les communications, sans repli direct sur le réseau physique.
- Les autres applications conservent leur routage et leur DNS habituels. Ne pas modifier le proxy système, le DNS global ni les routes par défaut physiques pour assurer le fonctionnement de MyNEIGE.
- Protéger les identifiants : ne pas les exposer dans le code, les journaux, les arguments de commande, la documentation ou le chat. Leur enregistrement reste facultatif et protégé par les mécanismes prévus par le projet.
- Le préremplissage CAS ne doit pas soumettre automatiquement le formulaire. Le clic de connexion reste une action de l’utilisateur.

## Développement et validation

- Continuer les tests unitaires, les tests de régression et les recettes de développement adaptés au changement effectué.
- Utiliser la version de développement, notamment `npm start`, pour vérifier le comportement de l’application. Les compilations natives nécessaires au développement restent distinctes de la construction d’une distribution et peuvent être réalisées dans ce cadre.
- Consulter les commandes de `package.json` et les guides concernés dans `docs/` pour choisir les vérifications pertinentes.
- Distinguer les résultats des tests automatisés, des recettes locales et des essais réels avec VPN. Ne pas présenter un test de protocole ou une compilation réussie comme une preuve d’isolation réseau réelle.
- Indiquer dans le compte rendu les vérifications réalisées et les éventuelles validations restant à effectuer avec l’utilisateur.

## Langue et communication

- Rédiger principalement en français les commentaires du code, la documentation et les échanges avec l’utilisateur.
- Conserver les identifiants techniques et les conventions de nommage existantes lorsqu’aucune modification n’est nécessaire.
- Expliquer clairement les changements et les résultats de validation, avec un niveau de détail adapté à leur importance.

## Documentation de référence

- `README.md` est la référence pour l’état actuel du projet, son utilisation et ses points d’entrée.
- Utiliser les documents spécialisés de `docs/` pour les détails d’architecture, les procédures et les résultats de recette.
- Organiser la documentation par fonctionnalité, procédure et scénario de validation.
- Maintenir les informations durables utiles dans le README ou la documentation spécialisée lorsqu’une demande nécessite leur mise à jour.
