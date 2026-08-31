---
name: recette-formatter
description: "Reformate la recette la plus récente de la conversation en texte brut structuré (INFOS, TEMPS, INGREDIENTS, STEPS, NOTES) avec temps de cuisson/repos et infos pratiques, prêt pour la collection markdown de recettes."
---

# Recette Formatter

## Pourquoi

Les recettes données en conversation libre n'ont pas de temps exploitables (pas de
minutage par étape) ni d'infos pratiques regroupées (nombre de personnes, taille de
moule). Cette skill les extrait et les structure pour qu'elles s'intègrent proprement
dans une collection markdown personnelle.

## Comportement

Quand cette skill se déclenche :

1. Repère la recette la plus récente donnée dans la conversation (écrite par toi ou
   collée par l'utilisateur). Ne redemande jamais la recette : elle est déjà là.
2. Redonne-la à l'identique — mêmes ingrédients, mêmes quantités, mêmes étapes, même
   ordre — en ajoutant uniquement les temps et les infos pratiques qui se déduisent de la
   recette elle-même.
3. Réponds UNIQUEMENT avec un bloc de code contenant du texte brut, rien avant ni après,
   exactement au format ci-dessous.

## Format exact

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
2. Faire fondre le chocolat au bain-marie. {5 min}
3. Mélanger, verser dans le moule et enfourner. {25 min}
4. Saler, poivrer et servir aussitôt.

NOTES
Variantes et conseils, s'il y en a.
```

## Règles

- **INFOS** : deux lignes possibles, et deux seulement — `Personnes` et `Moule`. Toute
  autre ligne (Difficulté, Coût, Matériel…) serait ignorée à l'import : ne les écris pas.
  "Personnes" si le nombre de personnes/parts est connu ou déductible. "Moule" seulement
  pour une pâte, un gâteau ou une préparation qui utilise un moule/plat de taille précise.
  Omets tout le bloc INFOS s'il n'y a rien à y mettre. La phrase de description ne doit
  plus répéter "pour X personnes" — cette info va uniquement dans INFOS désormais.
- **TEMPS** : ne mets que les lignes qui s'appliquent (omets Repos s'il n'y en a pas). Ces
  trois temps décrivent la recette entière, pas une étape en particulier.
- **{durée} sur une étape** : ajoute-la uniquement si l'étape a une vraie durée à minuter
  (cuisson, repos, levée, marinade, réduction). Pas de {durée} sur une étape instantanée
  comme "saler et poivrer".
- **Durées acceptées** : "10 min", "1 h", "1 h 30". Une seule valeur, jamais de
  fourchette — pour "18 à 20 minutes", écris {20 min} (borne haute).
- **NOTES** : omets complètement la section s'il n'y a ni variante ni conseil à donner.
  N'écris jamais "Aucune." ou "Rien à signaler" — une section absente vaut mieux qu'une
  note vide.
- **N'invente rien** : si un temps ou une info ne peut pas être déduit de la recette,
  omets-le plutôt que de l'inventer. Cela vaut en particulier pour les temps de cuisson :
  ne déduis un temps que si la recette le mentionne ou s'il découle sans ambiguïté d'une
  étape ("enfourner 30 à 35 minutes"). Sinon, laisse la section TEMPS sans cette ligne.
- **Un seul ingrédient par ligne.** N'écris jamais "Sel, poivre" sur une ligne :
  fais-en deux. Ce qui suit une virgule est traité comme de la préparation
  ("courgettes, coupées en dés") et ignoré lors du regroupement des courses —
  n'y mets donc jamais un second ingrédient.
- Ne change ni les quantités, ni le nombre d'étapes, ni leur ordre.
- Unités métriques uniquement : g, ml, L, c.à.s, c.à.c.
