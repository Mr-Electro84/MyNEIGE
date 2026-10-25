# Site de présentation MyNEIGE

Page statique en français, sans dépendance externe ni JavaScript. Tous les styles
sont dans `styles.css`. Le dossier `assets/` contient le logo du projet, le favicon
et les icônes SVG. Le schéma de connexion est illustratif, ce n'est pas une capture
de l'application.

## Consulter la page

Depuis la racine du dépôt :

```powershell
python -m http.server 8080 --bind 127.0.0.1 --directory website
```

Ouvrir ensuite <http://127.0.0.1:8080>. Un serveur HTTP est recommandé : certains
navigateurs bloquent les icônes SVG externes lors d'une ouverture en `file://`.

## Téléchargements et hébergement

Le site attend ces fichiers dans `downloads/` :

- `MyNEIGE-1.0.0-alpha.1-win-x64-setup.exe`
- `MyNEIGE-1.0.0-alpha.1-win-x64-portable.zip`
- `MyNEIGE-1.0.0-alpha.1-win-x64-SHA256SUMS.txt`

Ils ont été copiés depuis les paquets **déjà présents** dans `dist/` pendant la
création du site. Aucune distribution n'a été reconstruite. Les téléchargements
ne sont pas suivis par Git : un nouveau clone ne les contient pas. Pour les remettre
en place à partir d'une distribution existante et approuvée :

```powershell
Copy-Item -LiteralPath 'dist/MyNEIGE-1.0.0-alpha.1-win-x64-setup.exe', 'dist/MyNEIGE-1.0.0-alpha.1-win-x64-portable.zip', 'dist/MyNEIGE-1.0.0-alpha.1-win-x64-SHA256SUMS.txt' -Destination 'website/downloads/'
```

Pour publier le site sur un hébergement statique, transférer **tout le contenu de
`website/`, y compris les trois fichiers de `downloads/`**. Vérifier que l'hébergeur
accepte les fichiers `.exe` et `.zip` d'environ 159 Mo chacun. En cas d'utilisation
de GitHub Pages depuis Git, héberger les paquets séparément, par exemple dans une
release accessible, puis remplacer les trois liens de téléchargement dans
`index.html`. Ne pas utiliser `dist/` comme racine web : il contient aussi le dossier
autonome de l'application.

Lors d'une nouvelle version, mettre à jour les trois noms de fichiers, la version,
les tailles approximatives et les éventuelles limites Alpha dans `index.html`.
Conserver un jeu cohérent de paquets et d'empreintes SHA-256. Une nouvelle construction
de distribution reste soumise à l'accord explicite prévu par `AGENTS.md`.

## Vérification

Contrôler sur ordinateur et mobile : l'absence de défilement horizontal, les ancres,
le focus clavier, les questions dépliables et les trois téléchargements. Comparer
les empreintes des paquets servis au fichier SHA-256. Aucun VPN ni identifiant n'est
nécessaire pour vérifier ce site ; cela ne constitue pas une recette réseau de MyNEIGE.
