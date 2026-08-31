# Ma boîte à recettes

Site statique, sans build, pour garder tes recettes préférées — consultable sur
téléphone et ordinateur une fois publié sur GitHub Pages.

## Structure

```
mes-recettes/
├── index.html            page d'accueil : liste, recherche, filtres envies/catégorie/ingrédient
├── recipe.html           page détail d'une recette (?id=slug)
├── courses.html          liste de courses agrégée sur plusieurs recettes
├── style.css
├── assets/
│   └── recipe-format.js  parseur Markdown+frontmatter partagé (navigateur + scripts)
├── data/
│   ├── index.json         résumé léger de chaque recette (généré, ne pas éditer à la main)
│   └── recipes/
│       └── <slug>.md      fiche complète d'une recette (Markdown + frontmatter)
├── _staging/              dépose ici les .md (ou .html) à traiter
├── .nojekyll              désactive Jekyll sur GitHub Pages (indispensable, voir plus bas)
├── skill-recette-formatter.md   définition du skill claude.ai (copie de référence)
├── package.json
└── scripts/
    ├── serve.js            serveur local de prévisualisation
    ├── extract-recipe.js   extraction automatique depuis un .md ou du html
    ├── parse-staging-md.js lecture des recettes .md en texte brut de _staging/
    └── build-index.js      reconstruit data/index.json depuis les .md
```

## Prévisualiser en local

```
npm install
npm run dev
```
puis ouvre http://localhost:5173 — un serveur local est nécessaire car les
navigateurs bloquent le chargement de fichiers (`data/index.json`, `.md`) en
ouvrant `index.html` directement (`file://`).

## Format d'une fiche recette (`data/recipes/<slug>.md`)

```markdown
---
id: tarte-au-citron
title: Tarte au citron
description: Une tarte acidulée et facile.
categories: [Dessert]
servings: 6
yield_label: 
mold: 24 cm
prep_time: 20
cook_time: 25
rest_time: 
status: favorite
main_ingredients: [citron, oeuf]
source_url: 
created: 2026-08-30T14:05
updated: 2026-08-30T18:09
needs_review: false
---

## Ingrédients
- 200 g farine
- 3 citrons
- 150 g sucre
- 3 oeufs

## Étapes
1. Préchauffer le four à 180°C.
2. Mélanger les ingrédients et cuire 25 min.

## Notes
Section facultative : variantes, conseils, remarques.
```

### Classement

Deux axes indépendants, qui se cumulent dans les filtres :

**`categories`** — le ou les types de plat. Une recette peut en cumuler
plusieurs : `[Entrée, Soupe]` pour un velouté servi en entrée. L'extraction n'en
devine **qu'une seule** : ajoute la seconde à la main, ou passe
`--category "Entrée,Soupe"`.

**`status`** — une seule valeur, les trois s'excluent :

| valeur | affichage | sens |
|---|---|---|
| `none` | — | le cas par défaut, la recette est archivée |
| `untried` | ○ jamais essayé | ajoutée mais jamais faite — une curiosité en attente |
| `favorite` | ★ à refaire | déjà faite, à retenter — une envie |
| `classic` | ◆ classique | au répertoire, refaite régulièrement — une habitude |

Les quatre s'excluent. La progression naturelle va de `untried` (on l'a repérée)
à `favorite` (on l'a faite, on recommencera) puis `classic` (on la fait sans y
penser). `none` reste pour ce qu'on garde sans avis particulier. Le frontmatter
accepte aussi les formes françaises (`jamais essayé`, `à essayer`, `classique`).

`status` est ton appréciation : aucun script ne la décide, et elle est préservée
si tu ré-extrais une recette déjà présente.

### Rendement et moule

`yield_label` remplace le mot « portion » quand la recette ne se compte pas en
parts : `yield_label: moule` affiche « 1 moule », « 2 moules ». Laisse vide pour
l'affichage par défaut en portions.

`mold` est l'information de contenant (`24 cm`, `moule à cake 26 cm`), affichée
dans le bandeau de la fiche. Elle est indépendante de `servings` : une tarte peut
être `servings: 8` **et** `mold: 24 cm`. C'est la ligne `Moule` du skill.

`main_ingredients` alimente le filtre "Ingrédient principal" sur la page
d'accueil — à remplir à la main (2-4 ingrédients qui définissent le plat, pas la
liste complète). Un tableau vide est parfaitement valide : certaines recettes
n'ont pas d'ingrédient qui les caractérise (une pâte à tarte, une béchamel).

`servings` est obligatoire : c'est la base du calcul des quantités quand on
change le nombre de portions sur la fiche.

`created` ne change jamais une fois la recette ajoutée ; `updated` est recalé à
chaque extraction, et par `build-index` d'après la date du fichier sur le disque.
Les deux s'affichent en bas de la fiche recette.

Le format est `YYYY-MM-DDTHH:MM` en heure locale — l'heure permet de départager
deux recettes ajoutées le même jour, ce dont le tri « Récentes » a besoin. Une
fiche écrite avant cet horodatage, qui ne portait qu'une date, est complétée en
`T00:00` (« heure inconnue ») au prochain `build-index`.

> `build-index` restaure la date du fichier sur le disque après avoir complété un
> frontmatter : sans ça, sa propre écriture relancerait un `updated` au passage
> suivant, indéfiniment.

Après une édition manuelle d'un fichier `.md`, régénère l'index :
```
npm run build-index          # complète created/updated, migre les anciens champs
npm run build-index -- --no-touch   # lecture seule, ne réécrit aucun .md
```

## Ajouter une recette automatiquement

1. Dépose un ou plusieurs fichiers dans `_staging/` :
   - **`.md`** — le format courant : le texte de la recette copié tel quel depuis
     un widget recette Claude (voir ci-dessous)
   - **`.html`** — page de recette enregistrée depuis le web, ou widget sauvegardé
2. Lance :
   ```
   node scripts/extract-recipe.js --staging
   ```
   ou pour un seul fichier : `node scripts/extract-recipe.js chemin/fichier.md --category "Entrée,Soupe"`

   Options utiles : `--servings 6`, `--status favorite|classic|none`,
   `--yield-label moule`, `--category "Entrée,Soupe"`.
3. Le script crée `data/recipes/<slug>.md` et met à jour `data/index.json`.
   Si l'extraction n'était pas sûre, la recette est marquée `needs_review: true`
   (badge "à vérifier" sur le site) — ouvre le fichier `.md` et corrige à la main,
   puis relance `npm run build-index`.

### Format d'un `.md` déposé dans `_staging/`

Le format produit par le skill `recette-formatter` (voir plus bas) est celui
attendu ici. Toutes les sections sont facultatives sauf les ingrédients et les
étapes :

```
Tarte aux mirabelles
Une tarte simple et gourmande qui met en valeur la mirabelle bien mûre.

INFOS
Personnes: 6
Moule: 24 cm

TEMPS
Cuisson: 40 min

INGREDIENTS
• 500 grams mirabelles, dénoyautées
• 1 teaspoons sucre vanillé

STEPS
1. Préchauffer le four à 180°C.
2. Enfourner. {40 min}

NOTES
Un peu de cannelle se marie très bien avec la mirabelle.
```

- Les en-têtes acceptent le français et l'anglais, en majuscules ou en titres
  Markdown (`## Ingrédients`, `PREPARATION`, `Notes:`…).
- Les unités anglaises (`grams`, `milliliters`, `teaspoons`…) sont converties en
  `g`, `ml`, `c.à.c`, y compris dans le texte des étapes.
- **Le nombre de personnes est obligatoire.** Le script le prend dans `INFOS →
  Personnes`, ou à défaut dans le texte (« pour 6 personnes », « 4 portions »).
  S'il ne le trouve nulle part, il refuse d'écrire la recette plutôt que d'en
  inventer un : relance avec `--servings 6`, ou ajoute la mention dans le fichier.
- Une source qui ne dit rien n'efface pas ce qui a déjà été saisi : description,
  temps, `mold`, `status` et `main_ingredients` d'une fiche existante sont
  préservés lors d'une ré-extraction.
- Un frontmatter en tête de fichier est facultatif et sert de valeurs par défaut
  (`servings`, `categories`, `mold`, `prep_time`, `source_url`…).

> `cheerio` (sources `.html` uniquement) demande Node >= 20. Le flux `.md` n'en
> dépend pas et fonctionne sur les versions antérieures.

## Formater une recette dans Claude — skill `recette-formatter`

Les recettes données en conversation libre n'ont ni temps minutables ni infos
pratiques regroupées. Le skill **`recette-formatter`**, installé côté claude.ai,
s'en charge : dans la conversation où Claude vient d'écrire une recette, il la
redonne à l'identique, enrichie des temps et des infos, directement au format
attendu par `_staging/`.

Sa définition est versionnée ici dans **`skill-recette-formatter.md`** — c'est la
copie de référence. Après l'avoir modifiée, pense à la re-téléverser dans
claude.ai, sinon le skill installé garde l'ancienne version.

**Le cycle complet :**

1. Demander une recette à Claude, dans une conversation normale.
2. Déclencher le skill dans la même conversation — il reprend la dernière recette
   sans qu'on ait à la recoller.
3. Copier le bloc de code obtenu dans `_staging/<nom>.md`.
4. `node scripts/extract-recipe.js --staging`

Le skill n'invente rien : un temps qu'il ne peut pas déduire de la recette est
omis plutôt que estimé.

### Le format produit

```
Titre de la recette
Description en une phrase.

INFOS
Personnes: 6
Moule: 24 cm

TEMPS
Préparation: 20 min
Cuisson: 25 min
Repos: 1 h

INGREDIENTS
• 200 g chocolat noir
• 3 œufs

STEPS
1. Préchauffer le four à 180°C. {10 min}
2. Mélanger, verser dans le moule et enfourner. {25 min}
3. Saler, poivrer et servir aussitôt.

NOTES
Variantes et conseils, s'il y en a.
```

| section | devient | remarque |
|---|---|---|
| `INFOS` → `Personnes` | `servings` | seul le nombre est retenu |
| `INFOS` → `Moule` | `mold` | texte libre (`24 cm`), affiché sur la fiche |
| `TEMPS` | `prep_time` / `cook_time` / `rest_time` | en minutes ; leur somme donne le `⏱` de la carte |
| `{durée}` sur une étape | un minuteur cliquable | facultatif, indépendant de `TEMPS` |

`INFOS` n'accepte que `Personnes` et `Moule`. Toute autre ligne est ignorée à
l'import, mais l'extraction te la signale au lieu de la perdre en silence :

```
⚠ ligne INFOS non reconnue, ignorée : « Difficulté: facile »
```

Toutes les sections sont facultatives, et les en-têtes sont acceptés en français
comme en anglais (`TEMPS`/`TIMES`, `INFOS`/`INFORMATIONS`, `STEPS`/`ÉTAPES`…).

### Sans le skill : le prompt équivalent

Si le skill n'est pas disponible (autre compte, autre outil), le même résultat
s'obtient en collant ce prompt dans la conversation :

```
Reprends la recette que tu viens de me donner et redonne-la moi à l'identique
— mêmes ingrédients, mêmes quantités, mêmes étapes dans le même ordre — en y
ajoutant les temps et les infos pratiques.

Réponds UNIQUEMENT avec un bloc de code contenant du texte brut, sans rien
avant ni après, au format INFOS / TEMPS / INGREDIENTS / STEPS / NOTES décrit
dans skill-recette-formatter.md.

Règles :
- INFOS : uniquement les lignes « Personnes » et « Moule », et seulement si
  l'information est connue ou déductible. Ne répète pas « pour X personnes »
  dans la description.
- TEMPS : ne mets que les lignes qui s'appliquent. Ces trois temps décrivent la
  recette entière.
- Ajoute {durée} à la fin d'une étape uniquement si elle a une durée réelle à
  minuter : cuisson, repos, levée, marinade. Pas sur « saler et poivrer ».
- Durées : « 10 min », « 1 h », « 1 h 30 ». Une seule valeur, jamais de
  fourchette : pour « 18 à 20 minutes », écris {20 min}.
- N'invente aucun temps que tu ne peux pas déduire : omets-le plutôt.
- Ne change ni les quantités, ni le nombre d'étapes, ni leur ordre.
- Unités métriques uniquement : g, ml, L, c.à.s, c.à.c.
```

### Les temps dans une fiche

```markdown
---
prep_time: 20
cook_time: 25
rest_time: 60
---

## Étapes
1. Préchauffer le four à 180°C. {10 min}
2. Saler, poivrer et servir aussitôt.
```

Les trois champs du frontmatter sont en **minutes** (vides si inconnus) et leur
somme s'affiche sur la carte d'accueil (`⏱ 1 h 45`). Le `{durée}` en fin d'étape
est facultatif, indépendant des trois autres, et se lit aussi bien en `{25 min}`
qu'en `{1 h 30}`. Une accolade non reconnue est laissée telle quelle dans le
texte plutôt que supprimée.

## Retrouver les recettes récentes

L'accueil propose deux tris, à droite de la barre d'outils :

- **Récentes** (par défaut) — les recettes les plus récemment ajoutées ou
  retouchées en tête, avec un repère de fraîcheur sur chaque carte (`il y a 2 h`,
  `hier`, `il y a 3 jours`). Le tri se fait sur `updated`, donc une recette que
  tu viens de corriger remonte aussi.
- **A-Z** — l'ordre alphabétique.

Indépendamment du tri, une recette **ajoutée** depuis moins de 7 jours porte un
badge vert `nouveau`, pour la repérer même en vue alphabétique.

## Vérifier les ingrédients et faire les courses

Deux usages du même mécanisme, tous deux sans rien à configurer au préalable.

**À l'improviste** — sur une fiche recette, le bouton `Vérifier les ingrédients`
transforme la liste en cases à cocher. Tu ouvres le placard, tu coches ce que tu
as, et le compteur te dit ce qui manque (`3 à vérifier sur 10`, puis `Tu as tout ✓`).
Les ingrédients marqués `(optionnel)` dans la recette ne comptent pas comme
manquants.

**En planification** — la page `courses.html` (lien 🛒 sur l'accueil) : un champ
de recherche propose les recettes au fur et à mesure de la frappe, tu les ajoutes
d'un clic, tu ajustes le nombre de portions de chacune, et la liste agrégée se
construit. `Copier la liste` la met dans le presse-papier pour l'envoyer sur ton
téléphone.

Seules les recettes retenues sont affichées : la collection entière n'encombre
pas la page, et le sélecteur ne montre que 8 suggestions à la fois — au-delà, il
invite à préciser la recherche.

Les cases cochées et la sélection de recettes vivent dans le `localStorage` du
navigateur : rien à commiter, mais rien de partagé non plus entre ton téléphone
et ton ordinateur.

### Comment les ingrédients sont rapprochés

Pour qu'une liste de courses ne sorte pas `courgette` et `courgettes moyennes`
sur deux lignes, les noms sont normalisés avant regroupement. La règle est
volontairement prudente : **seuls les mots de découpe et de calibre sont
retirés** (`râpé`, `émincé`, `coupé en dés`, `moyen`, `gros`, `mou`), jamais
ceux qui distinguent deux produits.

```
courgettes moyennes, coupées en petits dés  ┐
courgette                                   ├─→  courgette
courgettes moyennes                         ┘

crème liquide entière   →  crème liquide entière   ┐ deux produits,
crème fraîche           →  crème fraîche           ┘ deux lignes
```

Les quantités ne s'additionnent qu'à unité identique. Sinon elles se juxtaposent
(`500 g + 2`) plutôt que de produire une somme fausse. Le libellé retenu est le
moins circonstancié des variantes rencontrées.

Ce rapprochement reste heuristique. Si deux ingrédients qui devraient être
distincts se retrouvent fusionnés, la correction se fait à la source : nomme-les
plus précisément dans la fiche.

## Publier sur GitHub Pages

Le site est statique et sans build : GitHub Pages sert les fichiers du dépôt tels
quels, il n'y a rien à compiler. Tous les chemins sont relatifs, donc le site
fonctionne aussi bien à la racine d'un domaine que dans un sous-dossier
`/<nom-du-repo>/`.

### 1. Le premier envoi

Depuis ce dossier, une seule fois :

```bash
git add -A
git commit -m "Ma boîte à recettes"
git branch -M main            # GitHub attend 'main' comme branche par défaut
```

Crée ensuite le dépôt sur **github.com → New repository** :

| champ | valeur |
|---|---|
| Repository name | `mes-recettes` (ce sera le nom dans l'URL) |
| Visibilité | **Public** — Pages sur un dépôt privé demande un compte payant |
| Add a README / .gitignore / licence | **décoché** — tout est déjà là, et ces fichiers créeraient un conflit au premier `push` |

Puis relie et pousse (remplace `<ton-pseudo>`) :

```bash
git remote add origin https://github.com/<ton-pseudo>/mes-recettes.git
git push -u origin main
```

> Si `git push` demande un mot de passe : GitHub n'accepte plus le mot de passe
> du compte. Crée un *personal access token* (Settings → Developer settings →
> Personal access tokens → Fine-grained, portée `Contents: read and write` sur ce
> dépôt) et colle-le à la place du mot de passe. Alternative : installer
> [`gh`](https://cli.github.com) et faire `gh auth login`, qui règle
> l'authentification une fois pour toutes — `gh repo create mes-recettes --public
> --source=. --push` fait alors création et envoi en une commande.

### 2. Activer Pages

Sur la page du dépôt : **Settings** → **Pages** (colonne de gauche), puis

- **Source** : `Deploy from a branch`
- **Branch** : `main`, dossier `/ (root)`
- **Save**

C'est tout — aucune GitHub Action à configurer, le mode « Deploy from a branch »
publie directement le contenu de la branche.

Le premier déploiement prend une à deux minutes. L'onglet **Actions** du dépôt
montre le job `pages build and deployment` en cours ; quand il est vert, l'URL
s'affiche en haut de Settings → Pages :

```
https://<ton-pseudo>.github.io/mes-recettes/
```

> **Cas particulier :** un dépôt nommé exactement `<ton-pseudo>.github.io` est
> publié à la racine, sur `https://<ton-pseudo>.github.io/`, sans sous-dossier.

### 3. `.nojekyll` — à ne pas supprimer

Le fichier vide **`.nojekyll`** à la racine est indispensable ici. Sans lui,
GitHub Pages fait passer le dépôt par Jekyll, qui repère un frontmatter YAML en
tête des fichiers `.md` et les transforme en pages HTML : `data/recipes/*.md` ne
serait alors plus servi tel quel, et le site n'afficherait plus aucune recette.
Il neutralise au passage la règle Jekyll qui ignore les dossiers commençant par
`_`.

### 4. Mettre à jour le site

Chaque `push` sur `main` redéclenche le déploiement. Après avoir ajouté ou
corrigé des recettes :

```bash
npm run build-index     # si tu as édité un .md à la main
git add -A
git commit -m "Ajout tarte aux mirabelles"
git push
```

Compte une à deux minutes avant que le changement soit en ligne. Si l'ancienne
version persiste au-delà, c'est le cache du navigateur : recharge en forçant
(`Ctrl+Maj+R`, ou `Cmd+Maj+R` sur Mac).

`node_modules/` et `_staging/` sont dans `.gitignore` : ils ne partent pas sur
GitHub, et n'ont rien à y faire — le site publié n'a besoin que des `.html`, du
`.css`, de `assets/` et de `data/`.

### 5. Le rendre plus pratique sur téléphone

Une fois l'URL ouverte dans Safari ou Chrome sur mobile, « Ajouter à l'écran
d'accueil » installe une icône qui ouvre le site en un geste. Les cases cochées
et la liste de courses vivant dans le `localStorage` du navigateur, elles restent
propres à chaque appareil.

### Si le site affiche une page blanche

| symptôme | cause probable |
|---|---|
| 404 sur l'URL entière | Pages pas encore déployé, ou branche/dossier mal réglés dans Settings → Pages |
| La page s'affiche mais aucune recette | `.nojekyll` manquant, ou `data/index.json` non commité (`git status` doit être propre) |
| Une recette manque | son `.md` n'a pas été poussé, ou `npm run build-index` n'a pas été relancé avant le commit |
| Le style ne s'applique pas | `style.css` non commité |

La console du navigateur (F12 → Console) nomme le fichier qui manque.

## Travailler avec Claude Code

Ce dossier est pensé pour être ouvert tel quel dans Claude Code : demande-lui
de traiter les fichiers de `_staging/`, de relire les recettes marquées
`needs_review`, de remplir `main_ingredients`, ou de committer/pousser après ajout.
