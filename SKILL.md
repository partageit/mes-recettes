---
name: recipe-extractor
description: Extrait une recette (titre, ingrédients, étapes, notes, catégories) depuis un fichier déposé dans _staging/ — un .md en texte brut (widget recette Claude copié/collé) ou un .html (page web, widget sauvegardé) — et l'ajoute au site mes-recettes sous forme de fichier Markdown (data/recipes/*.md) + met à jour data/index.json. Déclenche ce skill dès que l'utilisateur mentionne "_staging", "ajouter une recette", "traiter les fichiers", ou dépose un fichier .md/.html à intégrer au projet mes-recettes.
---

# Recipe extractor — mes-recettes

## Quand l'utiliser
- L'utilisateur dépose un ou plusieurs `.md` (ou `.html`) dans `_staging/` et demande de les intégrer.
- L'utilisateur demande "ajoute cette recette à mon site" en référence à un fichier déposé.
- Une recette existante est marquée `needs_review: true` et l'utilisateur veut la corriger.
- L'utilisateur a édité un fichier `.md` à la main et veut que l'index soit à jour.

## Format source attendu dans _staging/ (.md)
Texte brut, tel qu'on le copie depuis un widget recette Claude. Pas de frontmatter requis :

```
Titre de la recette
Description sur une ou plusieurs lignes

INGREDIENTS
• 500 grams mirabelles, dénoyautées
• 1 teaspoons sucre vanillé

INFOS
Personnes: 6
Moule: 24 cm

TEMPS
Préparation: 20 min
Cuisson: 25 min
Repos: 1 h

STEPS
1. Titre de l'étape: texte de l'étape. {25 min}

NOTES
Texte libre (facultatif).
```

- Les en-têtes acceptent le français et l'anglais, en majuscules ou en titres Markdown
  (`## Ingrédients`, `PREPARATION`, `Notes:`…).
- Les unités anglaises (`grams`, `milliliters`, `teaspoons`…) sont converties
  automatiquement en `g`, `ml`, `c.à.c` — y compris dans le texte des étapes.
- La section `INFOS` (facultative) accepte `Personnes` (-> `servings`) et `Moule`
  (-> `mold`). Toute autre ligne est ignorée, mais signalée dans la sortie du
  script : la reporter à l'utilisateur plutôt que de la laisser passer.
- La section `TEMPS` (facultative) accepte `Préparation` / `Cuisson` / `Repos`,
  en français comme en anglais. Un `{25 min}` en fin d'étape devient un minuteur
  sur la fiche ; les durées s'écrivent `20 min`, `1 h` ou `1 h 30`.
- Ce format est celui que produit le skill claude.ai `recette-formatter`
  (défini dans `skill-recette-formatter.md` à la racine) : c'est la voie normale
  pour obtenir une recette prête à intégrer.
- Un frontmatter facultatif en tête de fichier sert de valeurs par défaut
  (`servings`, `categories`, `source_url`, `title`, `description`, `prep_time`,
  `cook_time`, `rest_time`).

## Comment faire

1. Vérifier la dépendance (une seule fois) : `npm install`
   (`cheerio` n'est chargé que pour les sources `.html` et demande Node >= 20 ;
   le flux `.md` fonctionne sans.)
2. **Lire le fichier source et vérifier qu'il indique le nombre de personnes.**
   Le script le cherche dans le texte (« pour 6 personnes », « 4 portions », `servings:`).
   S'il est absent, **demander à l'utilisateur avant de lancer l'extraction** — ne jamais
   choisir un nombre à sa place. Le script refuse d'écrire la recette sans cette valeur.
3. **Demander à l'utilisateur le `status` de la recette.** C'est une appréciation
   personnelle : elle ne se devine jamais depuis le contenu. Le champ prend une
   seule valeur — une recette ne peut pas être les deux à la fois. Poser la
   question en expliquant la différence, car « classique » n'est pas évident :
   - `none` : le cas par défaut, la recette est simplement archivée.
   - `untried` — **○ jamais essayé** : ajoutée mais jamais faite. C'est le statut
     naturel d'une recette qu'on vient de découvrir et de mettre de côté.
   - `favorite` — **★ à refaire** : une recette déjà faite, à retenter. Une envie,
     une intention. C'est le sens courant du favori.
   - `classic` — **◆ classique** : une des quelques recettes du répertoire
     habituel, refaite régulièrement, qu'on connaît déjà. Une habitude, pas une
     envie — réservé à une poignée de recettes, pas à tout ce qu'on a aimé.

   En pratique, la progression va de `untried` à `favorite` puis `classic` :
   `classic` se mérite avec le temps. Ne jamais le mettre sur une nouveauté sans
   que l'utilisateur le confirme, et ne pas supposer qu'une recette fraîchement
   ajoutée est `untried` — certaines sont des recettes de famille déjà connues.

4. Lancer l'extraction :
   - tout `_staging/` d'un coup : `node scripts/extract-recipe.js --staging`
   - un seul fichier : `node scripts/extract-recipe.js chemin/fichier.md`
   - nombre de personnes : ajouter `--servings 6`
   - forcer les catégories : ajouter `--category "Entrée,Soupe"` (répétable)
   - statut : `--status untried|favorite|classic|none`. Sans cette option, une recette
     déjà présente garde le sien et une nouvelle est créée en `none`.
   - unité de rendement : `--yield-label moule` quand la recette ne se compte pas
     en portions (une pâte, un bocal). L'affichage devient « 1 moule », « 2 moules ».
5. Le script :
   - `.md` : lit le format texte brut ci-dessus
   - `.html` : cherche d'abord un schema.org `Recipe` en JSON-LD, sinon repli heuristique
   - déduit **une seule** catégorie par mots-clés, sinon "Plat" par défaut : le
     multi-catégories (Entrée + Soupe) se décide à la main ou via `--category`
   - préserve `status`, `yield_label`, `mold`, la description et les temps si la
     recette existe déjà : une source muette n'écrase pas ce qui a été saisi à la main
   - signale l'absence totale de temps
   - signale une description vide (certaines sources n'en ont pas) : la rédiger
     avec l'utilisateur, elle s'affiche sur la carte de la page d'accueil
   - écrit `data/recipes/<slug>.md` (Markdown + frontmatter) et met à jour `data/index.json`
   - renseigne `created` (horodatage `YYYY-MM-DDTHH:MM`, **préservé** si la recette
     existe déjà) et `updated` (horodatage courant à chaque passage)
   - marque `needs_review: true` si l'extraction n'est pas sûre à 100%
   - laisse `main_ingredients: []` vide — à remplir manuellement
6. Ouvrir le `.md` généré et vérifier avec l'utilisateur, en particulier si `needs_review` est vrai :
   - titre correct ?
   - quantités/unités bien séparées du nom de l'ingrédient ?
   - **un seul ingrédient par ligne** : `Sel, poivre` doit devenir deux lignes,
     sinon la vérification et la liste de courses n'en voient qu'un. La
     préparation se met après une virgule (`courgettes, coupées en dés`), elle
     est ignorée au regroupement.
   - étapes complètes et dans l'ordre ?
   - catégories pertinentes ? une seule est devinée : en proposer une seconde si
     la recette relève de deux familles (une quiche = Entrée + Plat)
   - nombre de personnes cohérent avec les quantités ?
   - temps présents ? Si la recette n'en a aucun et vient d'une conversation
     Claude, orienter l'utilisateur vers le skill `recette-formatter` (section
     « Formater une recette dans Claude » du README) plutôt que d'estimer les
     durées soi-même.
   - proposer 2-4 `main_ingredients` pertinents (ex: courgette, poulet) pour activer
     le filtre de recherche. **Un tableau vide est une réponse valide** : certaines
     recettes n'ont aucun ingrédient qui les caractérise (une pâte à tarte, une
     béchamel). Ne pas insister ni inventer dans ce cas.
7. Si le fichier source venait d'une page web, ajouter son URL dans `source_url`.
8. Si des champs ont été modifiés à la main après l'extraction, lancer `node scripts/build-index.js`
   pour resynchroniser `data/index.json`. Le script complète au passage `created`/`updated`
   d'après la date du fichier sur le disque, et migre les anciennes fiches
   (`category:` au singulier -> `categories: [...]`, booléens `keeper`/`classic`
   -> `status`). `--no-touch` pour l'en empêcher.
9. Informer l'utilisateur qu'il peut committer/pousser (`git add`, `git commit`, `git push`) s'il
   travaille avec Claude Code et un repo connecté, ou lui indiquer les fichiers modifiés sinon.

## Les deux axes de classement
- `categories` : le ou les types de plat (Plat, Dessert, Entrée, Soupe, Apéro,
  Petit-déjeuner, Autre). Une recette peut en cumuler plusieurs.
- `status` : une seule valeur parmi `none` / `untried` (○ jamais essayé) /
  `favorite` (★ à refaire) / `classic` (◆ classique).

Les deux filtrent indépendamment sur la page d'accueil et se cumulent.
`status` se demande à l'utilisateur (voir « Comment faire »), `categories` se
devine partiellement.

## Format de sortie attendu (data/recipes/<slug>.md)
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

## Ne pas faire
- Ne pas inventer d'ingrédients ou d'étapes si l'extraction échoue : laisser `needs_review: true` et demander confirmation à l'utilisateur plutôt que de deviner.
- **Ne pas inventer le nombre de personnes** : le demander à l'utilisateur s'il n'est pas dans la source.
- Ne pas inventer des `main_ingredients` sans les proposer d'abord à l'utilisateur pour validation.
- Ne pas modifier `created` sur une recette déjà présente : cette date ne change jamais.
- Ne pas décider du `status` : c'est une appréciation de l'utilisateur, jamais
  déduite d'une extraction.
- Ne pas remplir `main_ingredients` de force : le tableau vide est valide.
- Ne pas fusionner deux ingrédients sur une même ligne : la liste de courses les
  perdrait.
- **Ne pas estimer les temps de cuisson soi-même** : ils viennent de la source ou
  de l'utilisateur. En cas d'absence, renvoyer au skill `recette-formatter`.
- Ne pas committer ou pousser sur git sans confirmation explicite de l'utilisateur.
