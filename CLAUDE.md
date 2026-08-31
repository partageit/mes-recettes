# mes-recettes — contexte projet

Site statique de recettes, **sans build** : GitHub Pages sert les fichiers du
dépôt tels quels. Pas de framework, pas de bundler, aucun `dist/`. Les scripts
Node ne servent qu'à l'import et à la génération de l'index, jamais au rendu.

Le [README](README.md) fait autorité pour tout ce qui est expliqué en détail
(format des fiches, filtres, liste de courses, publication). Ce fichier ne
contient que ce qu'il faut savoir avant de toucher au dépôt.

## Commandes

```bash
npm install                          # cheerio, requis seulement pour les .html sans schema.org Recipe (Node >= 20)
npm run dev                          # serveur local sur http://localhost:5173
node scripts/extract-recipe.js --url "https://..."  # importe depuis une page web
node scripts/extract-recipe.js --staging          # importe tout _staging/
node scripts/extract-recipe.js fichier.md         # un seul fichier
npm run build-index                  # régénère data/index.json depuis les .md
npm run build-index -- --no-touch    # idem, sans réécrire les .md
```

Ouvrir `index.html` en `file://` ne marche pas : le navigateur bloque le
chargement de `data/index.json` et des `.md`. Toujours passer par `npm run dev`.

## Carte du dépôt

| chemin | rôle |
|---|---|
| `index.html` / `recipe.html` / `courses.html` | les trois pages, en JS natif |
| `assets/recipe-format.js` | parseur Markdown+frontmatter partagé navigateur ↔ scripts |
| `data/recipes/<slug>.md` | **la source de vérité** d'une recette |
| `data/index.json` | **généré** — ne jamais l'éditer à la main |
| `_staging/` | dépôt temporaire des fichiers à importer, gitignoré |
| `scripts/` | import, index, serveur local |
| `.claude/skills/recipe-extractor/` | skill d'import (voir plus bas) |
| `claude-ai-skills/recette-formatter/` | skill claude.ai, copie de référence non exécutée ici |

## Invariants

- **`data/index.json` est généré.** Toute correction se fait dans le `.md`, puis
  `npm run build-index`. C'est aussi vrai après une édition manuelle : sans ça, le
  site publié affiche encore l'ancienne version.
- **`.nojekyll` ne se supprime pas.** Sans lui, Jekyll transforme les
  `data/recipes/*.md` en pages HTML et le site n'affiche plus aucune recette.
- **`created` ne change jamais** une fois la recette ajoutée. `updated` est recalé
  à chaque extraction et par `build-index`. Format `YYYY-MM-DDTHH:MM`, heure locale.
- **Un seul ingrédient par ligne.** `Sel, poivre` doit devenir deux lignes : la
  vérification du placard et la liste de courses n'en verraient qu'un. Ce qui suit
  une virgule est de la préparation (`courgettes, coupées en dés`) et est ignoré
  au regroupement — n'y jamais mettre un second ingrédient.
- **Une étape, un minuteur.** Le `{25 min}` d'une étape est unique : une étape qui
  enchaîne deux durées (« 15 min à 200°C, puis 1 h à 100°C ») en perd une. La
  couper en deux étapes, une par durée.
- **`_staging/` est gitignoré** (sauf `.gitkeep`) : rien de ce qui y est déposé ne
  part sur GitHub, et c'est voulu.
- Une ré-extraction **ne doit pas écraser** ce qui a été saisi à la main :
  description, temps, `mold`, `status`, `main_ingredients` d'une fiche existante
  sont préservés quand la source est muette.

## Deux axes de classement

- **`categories`** — le ou les types de plat (Plat, Dessert, Entrée, Soupe, Sauce,
  Apéro, Petit-déjeuner, Goûter, Autre). `Sauce` couvre aussi les marinades, les
  vinaigrettes et les condiments : ce qui accompagne un plat sans en être un.
  Cumulables : une quiche est Entrée + Plat. L'extraction
  n'en devine qu'une seule ; la seconde s'ajoute à la main ou via `--category`.
- **`status`** — une seule valeur, les quatre s'excluent :

  | valeur | affichage | sens |
  |---|---|---|
  | `none` | — | par défaut, simplement archivée |
  | `untried` | ○ jamais essayé | ajoutée, jamais faite |
  | `favorite` | ★ à refaire | déjà faite, à retenter |
  | `classic` | ◆ classique | au répertoire, refaite régulièrement |

  La progression va de `untried` à `favorite` puis `classic`. `classic` se mérite :
  il est réservé à une poignée de recettes.

Les deux filtrent indépendamment sur l'accueil et se cumulent.

## Ne jamais deviner à la place de l'utilisateur

Trois valeurs ne se déduisent pas d'une source et ne doivent jamais être inventées :

- **le `status`** — c'est une appréciation personnelle. Ne pas supposer qu'une
  recette fraîchement ajoutée est `untried` : certaines sont des recettes de
  famille déjà connues.
- **le nombre de personnes** (`servings`) — le script refuse d'écrire une fiche
  sans lui plutôt que d'en inventer un. Le demander, ou passer `--servings`.
- **les temps de cuisson** — ils viennent de la source ou de l'utilisateur. En leur
  absence, orienter vers le skill `recette-formatter` (voir README) plutôt que
  d'estimer.

De même : ne pas inventer d'ingrédients ou d'étapes si l'extraction échoue —
laisser `needs_review: true` et demander confirmation. Et ne pas remplir
`main_ingredients` de force : un tableau vide est valide (une pâte à tarte, une
béchamel n'ont pas d'ingrédient caractéristique).

## Les deux skills

- **`recipe-extractor`** (`.claude/skills/recipe-extractor/SKILL.md`) — s'exécute
  ici, dans Claude Code. Il prend un fichier de `_staging/` et en fait une fiche
  `data/recipes/<slug>.md`. Il se déclenche dès qu'il est question de `_staging`,
  d'ajouter une recette ou de traiter un fichier déposé.
- **`recette-formatter`** (`claude-ai-skills/recette-formatter/SKILL.md`) — ne
  s'exécute **pas** ici : il est installé côté claude.ai et reformate, dans une
  conversation, la dernière recette donnée au format attendu par `_staging/`. Le
  fichier versionné ici est la copie de référence ; après l'avoir modifié, il faut
  le re-téléverser sur claude.ai, sinon le skill installé garde l'ancienne version.
