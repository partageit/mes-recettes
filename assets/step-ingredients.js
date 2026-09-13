// Quels ingrédients une étape cite-t-elle ? Sert à afficher les quantités sous
// l'étape, pour ne pas remonter à la liste en pleine préparation. Aucune
// dépendance : la détection tourne dans le navigateur, à l'affichage.
//
// Heuristique volontairement prudente : un ingrédient mal attribué est pire
// qu'un ingrédient absent. Les désignations indirectes (« tous les ingrédients
// de la marinade », « faire une omelette ») ne sont pas repérées, et c'est voulu.

import { ingredientLabel } from './recipe-format.js';

const STOP = new Set('de d du des la le les l a à au aux en et ou pour non avec sans un une sur'.split(' '));

// Mots qui peuvent précéder le produit dans un nom d'ingrédient sans le désigner :
// « gros sel » se cite « le sel », « feuilles de laurier » se cite « le laurier ».
const LEADING = new Set((
  'petit petite petits petites gros grosse grosses grand grande grands grandes ' +
  'moyen moyenne moyens moyennes mûr mûre mûrs mûres frais fraîche fraîches ' +
  'entier entière entiers entières noir noire blanc blanche neutre fin fine bien ' +
  'jeune jeunes beau belle belles extra bio sucré sucrée doux douce demi liquide ' +
  'épaisse épais vieux vieille primeur ' +
  'bouquet bouquets brin brins tranche tranches feuille feuilles filet filets ' +
  'botte bottes poignée poignées rouleau rouleaux déco quelques'
).split(' '));

// Mots en minuscules, « œ » écrit « oe », pluriel en s/x retiré au-delà de trois
// lettres. Les accents restent : « beurré » ne doit pas devenir « beurre », sinon
// « un moule beurré » afficherait le beurre de la garniture.
function tokenize(text) {
  const t = String(text == null ? '' : text).toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[‘’ʼ`]/g, "'");
  return (t.match(/[\p{L}\p{N}]+/gu) || []).map(raw => ({
    raw,
    key: raw.length > 3 && !raw.endsWith('ss') ? raw.replace(/[sx]$/, '') : raw,
  }));
}

// Les formes sous lesquelles une étape peut citer l'ingrédient : le libellé
// entier, puis ses débuts de plus en plus courts (« cacao en poudre non sucré »
// jusqu'à « cacao »), avec et sans les mots de tête (« gros sel » -> « sel »).
function citations(label) {
  const toks = tokenize(label);
  const words = toks.map(t => t.key);
  const skippable = t => LEADING.has(t.raw) || STOP.has(t.raw);
  const isLeading = key => toks.some(t => t.key === key && LEADING.has(t.raw));
  const bases = [words];
  let start = 0;
  while (start < toks.length && skippable(toks[start])) start++;
  if (start > 0 && start < words.length) bases.push(words.slice(start));
  const out = new Map();
  for (const base of bases) {
    for (let n = base.length; n >= 1; n--) {
      const seq = base.slice(0, n);
      if (STOP.has(seq[0]) || STOP.has(seq[n - 1])) continue;
      if (n === 1 && (isLeading(seq[0]) || seq[0].length < 3)) continue;
      const key = seq.join(' ');
      if (!out.has(key)) out.set(key, seq);
    }
  }
  return [...out.values()];
}

// Renvoie, pour chaque étape, les index (dans recipe.ingredients) des
// ingrédients qu'elle cite, dans l'ordre de la liste.
export function stepIngredients(recipe) {
  const ingredients = (recipe.ingredients || []).map((ing, idx) => {
    const label = ingredientLabel(ing.name);
    return { idx, fullKey: tokenize(label).map(t => t.key).join(' '), seqs: citations(label) };
  });

  // Une même forme peut appartenir à plusieurs ingrédients : « sucre » vient de
  // « sucre » et de « sucre vanillé ». On les regroupe pour trancher ensemble.
  const groups = new Map();
  for (const ing of ingredients) {
    for (const seq of ing.seqs) {
      const key = seq.join(' ');
      if (!groups.has(key)) groups.set(key, { key, seq, members: [] });
      groups.get(key).members.push(ing);
    }
  }
  // Les formes longues d'abord : « sucre vanillé » consomme ses mots avant que
  // « sucre » ne puisse les réclamer.
  const ordered = [...groups.values()].sort((a, b) =>
    b.seq.length - a.seq.length || b.key.length - a.key.length);

  // Un ingrédient en double (le sucre de la pâte, le sucre de la crème) suit
  // l'ordre de la recette : la première étape qui le cite prend la première
  // ligne, la suivante la deuxième.
  const duplicateSeen = new Map();

  return (recipe.steps || []).map(step => {
    const toks = tokenize(step.text);
    const consumed = new Array(toks.length).fill(false);
    const found = new Set();
    const duplicateHere = new Map();

    for (const group of ordered) {
      const len = group.seq.length;
      for (let p = 0; p + len <= toks.length; p++) {
        let hit = true;
        for (let j = 0; j < len; j++) {
          if (consumed[p + j] || toks[p + j].key !== group.seq[j]) { hit = false; break; }
        }
        if (!hit) continue;
        for (let j = 0; j < len; j++) consumed[p + j] = true;

        const members = group.members;
        const last = toks[p + len - 1];
        let picks = [];
        if (members.length === 1) {
          picks = members;
        } else if (new Set(members.map(m => m.fullKey)).size === 1) {
          if (!duplicateHere.has(group.key)) {
            const seen = duplicateSeen.get(group.key) || 0;
            duplicateHere.set(group.key, members[Math.min(seen, members.length - 1)]);
          }
          picks = [duplicateHere.get(group.key)];
        } else {
          const exact = members.filter(m => m.fullKey === group.key);
          const remaining = members.filter(m => !found.has(m.idx));
          if (exact.length === 1) picks = exact;
          // « le sucre » après « le sucre vanillé » : c'est l'autre.
          else if (remaining.length === 1) picks = remaining;
          // « les poivrons » pour un poivron rouge et un poivron jaune : les deux.
          else if (last.raw !== last.key && !exact.length) picks = members;
          // Sinon ambigu : mieux vaut ne rien afficher.
        }
        picks.forEach(m => found.add(m.idx));
      }
    }

    duplicateHere.forEach((m, key) => duplicateSeen.set(key, (duplicateSeen.get(key) || 0) + 1));
    return [...found].sort((a, b) => a - b);
  });
}
