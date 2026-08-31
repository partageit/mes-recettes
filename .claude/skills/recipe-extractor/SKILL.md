---
name: recipe-extractor
description: Extrait une recette (titre, ingrédients, étapes, notes, catégories) depuis une URL de page web, ou depuis un fichier déposé dans _staging/ — un .md en texte brut (widget recette Claude copié/collé) ou un .html (page web, widget sauvegardé) — et l'ajoute au site mes-recettes sous forme de fichier Markdown (data/recipes/*.md) + met à jour data/index.json. Déclenche ce skill dès que l'utilisateur mentionne "_staging", "ajouter une recette", "traiter les fichiers", donne l'URL d'une recette (marmiton, 750g, un blog de cuisine…), ou dépose un fichier .md/.html à intégrer au projet mes-recettes.
---

# Recipe extractor — mes-recettes

Le contexte du projet (invariants, axes de classement, ce qui ne se devine
jamais) est dans `CLAUDE.md` à la racine. Ce skill décrit la procédure d'import.

## Quand l'utiliser
- L'utilisateur donne l'URL d'une page de recette (« ajoute cette recette », un lien collé seul).
- L'utilisateur dépose un ou plusieurs `.md` (ou `.html`) dans `_staging/` et demande de les intégrer.
- L'utilisateur demande "ajoute cette recette à mon site" en référence à un fichier déposé.
- Une recette existante est marquée `needs_review: true` et l'utilisateur veut la corriger.
- L'utilisateur a édité un fichier `.md` à la main et veut que l'index soit à jour.

## Depuis une URL

```
node scripts/extract-recipe.js --url "https://..." [--servings 6] [--status ...]
```

La page est téléchargée dans `_staging/` puis lue comme un `.html`. Le script lit
le schema.org `Recipe` (JSON-LD) sans `cheerio` — donc sans exiger Node >= 20 —,
nettoie la queue SEO du titre, jette une description-gabarit, traduit la catégorie
du site vers celles du projet et renseigne `source_url`.

Avant de lancer : demander le `status`, et le nombre de personnes **seulement si
la page ne le donne pas** (la plupart l'indiquent, le script le lira).

Deux sorties à lire et à relayer à l'utilisateur :

- `↪ redirigé vers …` — l'URL a redirigé, et sur ces sites c'est l'identifiant
  numérique qui décide de la recette servie, pas le slug. **Annoncer le titre
  extrait et faire confirmer** que c'est bien la recette voulue.
- `pas de schema.org Recipe dans la page` — la page ne se laisse pas lire.

### Repli quand la page n'a pas de JSON-LD

Ne pas insister avec le script, et surtout **ne rien inventer**. Lire la page
(WebFetch) et en écrire un `_staging/<slug>.md` au format ci-dessous, à partir du
seul contenu de la page :

- recopier ingrédients et étapes tels quels — pas de reformulation, pas d'étape
  ajoutée « pour la clarté » ;
- un seul ingrédient par ligne (`Sel, poivre` → deux lignes) ;
- ne remplir `Personnes` et les temps que s'ils figurent sur la page ; sinon
  demander à l'utilisateur ;
- mettre `source_url:` dans le frontmatter du `.md`.

Puis `node scripts/extract-recipe.js _staging/<slug>.md` et la relecture normale.
Si la page est inaccessible (anti-bot, contenu chargé en JS), le dire franchement
et proposer le copier-coller manuel ou le skill `recette-formatter`.

## Format source attendu dans `_staging/` (.md)

Texte brut, tel qu'on le copie depuis un widget recette Claude. Pas de
frontmatter requis :

```
Titre de la recette
Description sur une ou plusieurs lignes

INFOS
Personnes: 6
Moule: 24 cm

TEMPS
Préparation: 20 min
Cuisson: 25 min
Repos: 1 h

INGREDIENTS
• 500 grams mirabelles, dénoyautées
• 1 teaspoons sucre vanillé

STEPS
1. Préchauffer le four à 180°C. {10 min}

NOTES
Texte libre (facultatif).
```

- En-têtes acceptés en français comme en anglais, en majuscules ou en titres
  Markdown (`## Ingrédients`, `PREPARATION`, `Notes:`…).
- Unités anglaises (`grams`, `milliliters`, `teaspoons`…) converties en `g`, `ml`,
  `c.à.c`, y compris dans le texte des étapes.
- `INFOS` n'accepte que `Personnes` (→ `servings`) et `Moule` (→ `mold`). Toute
  autre ligne est ignorée mais signalée par le script : **la reporter à
  l'utilisateur** plutôt que de la laisser passer.
- `TEMPS` accepte `Préparation` / `Cuisson` / `Repos`. Un `{25 min}` en fin d'étape
  devient un minuteur sur la fiche ; durées en `20 min`, `1 h` ou `1 h 30`.
- Un frontmatter facultatif en tête de fichier sert de valeurs par défaut
  (`servings`, `categories`, `mold`, `source_url`, `title`, `description`,
  `prep_time`, `cook_time`, `rest_time`).

C'est le format que produit le skill claude.ai `recette-formatter` : c'est la voie
normale pour obtenir une recette prête à intégrer.

## Comment faire

1. `npm install` si ce n'est pas déjà fait (`cheerio` n'est chargé que pour les
   sources `.html` et demande Node >= 20 ; le flux `.md` fonctionne sans).

2. **Lire la source et vérifier qu'elle indique le nombre de personnes.** Le script
   le cherche dans `INFOS → Personnes`, puis dans le texte (« pour 6 personnes »,
   « 4 portions », `servings:`). S'il est absent, le demander avant de lancer
   l'extraction — le script refuse d'écrire la fiche sans cette valeur.

3. **Demander le `status`** (voir le tableau dans `CLAUDE.md`), en expliquant la
   différence entre `favorite` et `classic` : elle n'est pas évidente. Sans
   `--status`, une recette déjà présente garde le sien et une nouvelle est créée
   en `none`.

4. Lancer l'extraction :
   - une URL : `node scripts/extract-recipe.js --url "https://..."`
   - tout `_staging/` : `node scripts/extract-recipe.js --staging`
   - un fichier : `node scripts/extract-recipe.js chemin/fichier.md`
   - `--source-url https://...` — pour une page enregistrée à la main
   - `--servings 6` — nombre de personnes
   - `--category "Entrée,Soupe"` — force les catégories (répétable)
   - `--status untried|favorite|classic|none`
   - `--yield-label moule` — quand la recette ne se compte pas en portions (une
     pâte, un bocal) : l'affichage devient « 1 moule », « 2 moules »

5. Ce que fait le script :
   - `.md` : lit le format texte brut ci-dessus
   - `.html` : cherche d'abord un schema.org `Recipe` en JSON-LD (sans cheerio),
     sinon repli heuristique (cheerio, Node >= 20)
   - nettoie la queue SEO du titre et rejette une description-gabarit
   - traduit la catégorie du site vers celles du projet, sinon déduit **une seule**
     catégorie par mots-clés, sinon « Plat »
   - préserve `status`, `yield_label`, `mold`, description et temps d'une fiche existante
   - signale l'absence totale de temps, et une description vide
   - écrit `data/recipes/<slug>.md` et met à jour `data/index.json`
   - renseigne `created` (préservé si la fiche existe) et `updated`
   - marque `needs_review: true` si l'extraction n'est pas sûre
   - laisse `main_ingredients: []` vide

6. **Ouvrir le `.md` généré et le relire avec l'utilisateur**, en particulier si
   `needs_review` est vrai :
   - titre correct ?
   - quantités et unités bien séparées du nom de l'ingrédient ?
   - un seul ingrédient par ligne ? (`Sel, poivre` → deux lignes)
   - étapes complètes et dans l'ordre ?
   - **description** : une fiche issue du web arrive souvent sans (le gabarit SEO
     est rejeté) — la rédiger avec l'utilisateur, en une phrase
   - catégories pertinentes ? une seule est devinée : en proposer une seconde si la
     recette relève de deux familles (une quiche = Entrée + Plat)
   - nombre de personnes cohérent avec les quantités ?
   - temps présents ? Si la recette n'en a aucun et vient d'une conversation Claude,
     orienter vers le skill `recette-formatter` plutôt que d'estimer.
   - proposer 2-4 `main_ingredients` (ex : courgette, poulet) pour alimenter le
     filtre de l'accueil — un tableau vide est une réponse valide, ne pas insister.

7. Si la source venait d'une page web enregistrée à la main, vérifier `source_url`
   (`--url` et `--source-url` le renseignent seuls).

8. Après toute retouche manuelle du `.md`, `node scripts/build-index.js` pour
   resynchroniser l'index. Il complète au passage `created`/`updated` d'après la
   date du fichier sur le disque et migre les anciennes fiches (`category:` au
   singulier → `categories: [...]`, booléens `keeper`/`classic` → `status`).
   `--no-touch` pour l'en empêcher.

9. Signaler à l'utilisateur les fichiers modifiés, et lui proposer de committer.

## Format de sortie (`data/recipes/<slug>.md`)

```markdown
---
id: slug-du-titre
title: ...
description: ...
categories: [Entrée, Soupe]
servings: 6
yield_label: 
mold: 24 cm
prep_time: 20
cook_time: 25
rest_time: 
status: none | untried | favorite | classic
main_ingredients: [ingrédient1, ingrédient2]
source_url: 
created: 2026-08-30T14:05
updated: 2026-08-30T18:09
needs_review: false
---

## Ingrédients
- 200 g nom de l'ingrédient

## Étapes
1. Texte de l'étape. {25 min}
2. Étape sans durée à minuter.

## Notes
Texte libre (section omise s'il n'y a pas de notes).
```
