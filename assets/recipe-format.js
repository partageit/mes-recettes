// Module partagé (navigateur + Node) pour lire/écrire les fichiers recette
// au format Markdown + frontmatter. Aucune dépendance externe.

export function slugify(text) {
  const ascii = (text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return ascii.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'recette';
}

// Date locale au format YYYY-MM-DD (pas toISOString, qui bascule en UTC le soir).
export function todayISO(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Horodatage local YYYY-MM-DDTHH:MM. Deux recettes ajoutées le même jour doivent
// pouvoir être départagées ; l'ordre lexicographique suit l'ordre chronologique.
export function formatStamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${todayISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nowStamp() {
  return formatStamp(new Date());
}

// Les fiches d'avant l'horodatage ne portent qu'une date : on la complète à
// T00:00, qui vaut « heure inconnue » et trie correctement entre deux jours.
export function normalizeStamp(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return '';
  return m[2] ? `${m[1]}T${m[2]}:${m[3]}` : `${m[1]}T00:00`;
}

// "il y a 2 h", "hier", "il y a 3 jours" — repère de fraîcheur sur les cartes.
export function relativeTime(value, now = new Date()) {
  const d = parseStamp(value);
  if (!d) return '';
  const minutes = Math.round((now - d) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'hier';
  if (days < 31) return `il y a ${days} jours`;
  const months = Math.round(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.round(months / 12);
  return years === 1 ? 'il y a un an' : `il y a ${years} ans`;
}

// Une recette est "nouvelle" pendant une semaine après son ajout.
export function isRecent(value, days = 7, now = new Date()) {
  const d = parseStamp(value);
  if (!d) return false;
  return (now - d) < days * 24 * 3600 * 1000;
}

export function parseStamp(value) {
  const normalized = normalizeStamp(value);
  if (!normalized) return null;
  const d = new Date(normalized);
  return isNaN(d) ? null : d;
}

// Unités reconnues -> forme canonique française.
// Les widgets recette Claude sortent les unités en anglais ("500 grams"), on les
// ramène ici sur la même écriture que les recettes saisies à la main.
const UNIT_ALIASES = {
  'g': 'g', 'gr': 'g', 'gram': 'g', 'grams': 'g', 'gramme': 'g', 'grammes': 'g',
  'kg': 'kg', 'kilogram': 'kg', 'kilograms': 'kg', 'kilo': 'kg', 'kilos': 'kg',
  'mg': 'mg', 'milligram': 'mg', 'milligrams': 'mg',
  'ml': 'ml', 'milliliter': 'ml', 'milliliters': 'ml', 'millilitre': 'ml', 'millilitres': 'ml',
  'cl': 'cl', 'centiliter': 'cl', 'centiliters': 'cl', 'centilitre': 'cl', 'centilitres': 'cl',
  'l': 'L', 'liter': 'L', 'liters': 'L', 'litre': 'L', 'litres': 'L',
  'c.à.c': 'c.à.c', 'c.a.c': 'c.à.c', 'cac': 'c.à.c', 'càc': 'c.à.c',
  'teaspoon': 'c.à.c', 'teaspoons': 'c.à.c', 'tsp': 'c.à.c',
  'c.à.s': 'c.à.s', 'c.a.s': 'c.à.s', 'cas': 'c.à.s', 'càs': 'c.à.s',
  'tablespoon': 'c.à.s', 'tablespoons': 'c.à.s', 'tbsp': 'c.à.s',
  'cuillère': 'cuillère', 'cuillères': 'cuillère', 'cuillere': 'cuillère', 'cuilleres': 'cuillère',
  'tasse': 'tasse', 'tasses': 'tasse', 'cup': 'tasse', 'cups': 'tasse',
  'pincée': 'pincée', 'pincee': 'pincée', 'pincées': 'pincée', 'pinch': 'pincée', 'pinches': 'pincée',
  'gousse': 'gousse', 'gousses': 'gousse', 'clove': 'gousse', 'cloves': 'gousse',
  'tranche': 'tranche', 'tranches': 'tranche', 'slice': 'tranche', 'slices': 'tranche',
  'sachet': 'sachet', 'sachets': 'sachet', 'packet': 'sachet', 'packets': 'sachet',
  'pot': 'pot', 'pots': 'pot',
  'boite': 'boîte', 'boîte': 'boîte', 'boites': 'boîte', 'boîtes': 'boîte',
  'can': 'boîte', 'cans': 'boîte',
  'pièce': 'pièce', 'pièces': 'pièce', 'piece': 'pièce', 'pieces': 'pièce',
  'botte': 'botte', 'bottes': 'botte', 'bunch': 'botte', 'bunches': 'botte',
};

export function normalizeUnit(unit) {
  return UNIT_ALIASES[(unit || '').trim().toLowerCase()] || '';
}

// Unités anglaises telles que sortent les widgets recette Claude. Utilisé pour
// nettoyer le texte libre des étapes, où l'unité est collée dans la phrase.
const ENGLISH_UNITS = [
  'kilograms', 'kilogram', 'milligrams', 'milligram', 'grams', 'gram',
  'milliliters', 'milliliter', 'millilitres', 'millilitre',
  'centiliters', 'centiliter', 'liters', 'liter',
  'tablespoons', 'tablespoon', 'teaspoons', 'teaspoon',
  'cups', 'cup', 'pinches', 'pinch', 'cloves', 'clove',
  'slices', 'slice', 'packets', 'packet', 'bunches', 'bunch',
];

const ENGLISH_UNITS_RE = new RegExp(
  '(\\d+(?:[.,]\\d+)?)\\s+(' + ENGLISH_UNITS.join('|') + ')\\b',
  'gi'
);

export function normalizeUnitsInText(text) {
  return (text || '').replace(ENGLISH_UNITS_RE, (full, amount, unit) => {
    const canonical = normalizeUnit(unit);
    return canonical ? `${amount} ${canonical}` : full;
  });
}

// Unités écrites en plusieurs mots : le découpage sur un seul mot ne les voit pas.
const MULTIWORD_UNITS = [
  [/^cuill[eè]re?s?\s+[àa]\s+soupe\.?/i, 'c.à.s'],
  [/^cuill[eè]re?s?\s+[àa]\s+caf[ée]\.?/i, 'c.à.c'],
  [/^c\.?\s*[àa]\.?\s*s(?:oupe)?\.?(?=\s|$)/i, 'c.à.s'],
  [/^c\.?\s*[àa]\.?\s*c(?:af[ée])?\.?(?=\s|$)/i, 'c.à.c'],
];

// Article qui suit l'unité : « 300 g de riz » -> nom « riz ».
const LEADING_ARTICLE = /^(?:de\s+|d'|du\s+|des\s+)/i;

export function parseAmountUnit(line) {
  line = (line || '').trim();
  const m = line.match(/^([\d.,/]+)\s*(.*)$/);
  if (!m || !m[1]) return { amount: null, unit: '', name: line };

  let amount = null;
  const rawAmt = m[1].replace(',', '.');
  if (rawAmt.includes('/')) {
    const [num, den] = rawAmt.split('/').map(Number);
    if (den) amount = num / den;
  } else {
    const parsed = parseFloat(rawAmt);
    if (!isNaN(parsed)) amount = parsed;
  }

  let rest = (m[2] || '').trim();
  let unit = '';

  for (const [re, canonical] of MULTIWORD_UNITS) {
    const found = rest.match(re);
    if (found) {
      unit = canonical;
      rest = rest.slice(found[0].length).trim();
      break;
    }
  }

  if (!unit) {
    const word = rest.match(/^([a-zA-Zàâäéèêëïîôöùûüç.]+)\s*(.*)$/);
    if (word) {
      const canonical = normalizeUnit(word[1]);
      // Sans correspondance, le mot fait partie du nom ("2 œufs", "1 gros œuf").
      if (canonical) {
        unit = canonical;
        rest = (word[2] || '').trim();
      }
    }
  }

  let name = unit ? rest.replace(LEADING_ARTICLE, '').trim() : rest;
  if (!name) name = line;
  return { amount, unit, name };
}

export const DEFAULT_CATEGORY = 'Plat';

// Une recette peut relever de plusieurs catégories (Entrée + Soupe). On accepte
// un tableau, une liste séparée par des virgules, ou l'ancien champ `category`
// au singulier des fiches écrites avant ce changement.
export function normalizeCategories(value, fallback) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') list = value.replace(/^\[|\]$/g, '').split(',');
  else if (value != null) list = [String(value)];

  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const name = String(raw).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  if (out.length) return out;
  return fallback === null ? [] : [fallback || DEFAULT_CATEGORY];
}

// Place d'une recette dans le répertoire. Valeur unique : une recette est soit
// une envie à retenter, soit une habitude installée, jamais les deux.
export const STATUS_VALUES = ['none', 'untried', 'favorite', 'classic'];

export const STATUS_META = {
  none:     { icon: '',  label: '' },
  untried:  { icon: '○', label: 'jamais essayé' },
  favorite: { icon: '★', label: 'à refaire' },
  classic:  { icon: '◆', label: 'classique' },
};

const STATUS_ALIASES = {
  'none': 'none', 'aucun': 'none', 'false': 'none',
  'favorite': 'favorite', 'favori': 'favorite', 'favorite_status': 'favorite',
  'keeper': 'favorite', 'à refaire': 'favorite', 'a refaire': 'favorite',
  'classic': 'classic', 'classique': 'classic',
  'untried': 'untried', 'jamais essayé': 'untried', 'jamais essaye': 'untried',
  'jamais_essaye': 'untried', 'à essayer': 'untried', 'a essayer': 'untried',
  'nouveau': 'untried', 'new': 'untried',
};

// `legacy` reprend les anciens booléens keeper/classic. Si les deux étaient à
// true, `classic` l'emporte : l'habitude prime sur l'envie.
export function normalizeStatus(value, legacy) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  // Champ absent ou vide : on retombe sur les anciens booléens, pas sur 'none',
  // sinon la migration d'une fiche keeper/classic perdrait l'information.
  const mapped = raw ? STATUS_ALIASES[raw] : null;
  if (mapped) return mapped;
  if (legacy) {
    if (legacy.classic === true) return 'classic';
    if (legacy.keeper === true) return 'favorite';
  }
  return 'none';
}

// "6 portions", "1 moule", "2 moules" — yield_label remplace le mot par défaut.
export function formatYield(count, label) {
  const n = Number(count);
  const word = (label || 'portion').trim();
  const plural = n > 1 && !/s$/i.test(word) ? word + 's' : word;
  return `${isNaN(n) ? '' : n} ${plural}`.trim();
}

// --- Durées ---
// Stockées en minutes. À l'écriture d'une étape, la durée est notée en fin de
// ligne entre accolades : "3. Enfourner et cuire. {40 min}".
const STEP_DURATION_RE = /\s*\{([^{}]+)\}\s*$/;

// Accepte "40 min", "1 h 30", "1h30", "2 heures", "90".
export function parseDuration(text) {
  const raw = String(text == null ? '' : text).trim().toLowerCase();
  if (!raw) return null;

  const hm = raw.match(/^(\d+)\s*(?:h|heures?)\s*(\d+)?\s*(?:min|minutes?)?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);

  const m = raw.match(/^(\d+)\s*(?:min|minutes?|mn)?$/);
  if (m) return Number(m[1]);

  return null;
}

export function formatDuration(minutes) {
  const n = Number(minutes);
  if (!n || isNaN(n) || n <= 0) return '';
  const h = Math.floor(n / 60);
  const min = n % 60;
  if (!h) return `${min} min`;
  return min ? `${h} h ${min}` : `${h} h`;
}

export function splitStepDuration(line) {
  const text = String(line == null ? '' : line).trim();
  const found = text.match(STEP_DURATION_RE);
  if (!found) return { text, minutes: null };
  const minutes = parseDuration(found[1]);
  // Accolades non reconnues : on laisse la ligne intacte plutôt que de la tronquer.
  if (minutes == null) return { text, minutes: null };
  return { text: text.replace(STEP_DURATION_RE, '').trim(), minutes };
}

// --- Rapprochement des ingrédients ---
// Sert à regrouper "courgettes moyennes, coupées en dés" et "courgette" sous une
// même entrée de liste de courses. On ne retire QUE ce qui décrit la découpe ou
// le calibre : "liquide", "fraîche" ou "sec" distinguent des produits différents
// et doivent survivre, sinon la crème liquide et la crème fraîche fusionnent.
// \b ne reconnaît pas les lettres accentuées : "râpé" ne serait jamais retiré.
// On borne donc sur "pas une lettre unicode", avec le drapeau u.
const PREPARATION_WORDS = new RegExp(
  '(?<!\\p{L})(?:' + [
    'r[âa]p[ée]e?s?', '[ée]minc[ée]e?s?', 'coup[ée]e?s?', '[ée]cras[ée]e?s?',
    'd[ée]noyaut[ée]e?s?', 'hach[ée]e?s?', 'pel[ée]e?s?', '[ée]pluch[ée]e?s?',
    'lav[ée]e?s?', 'ciselée?s?', 'fondue?s?', 'ramollie?s?',
    'moyen(?:ne)?s?', 'gros(?:se)?s?', 'petite?s?', 'mou', 'molle',
    'chaude?s?', 'froide?s?', 'ti[èe]de?s?',
    'finement', 'grossi[èe]rement', 'r[ée]guli[èe]re?s?', 'frais', 'fra[îi]chement',
  ].join('|') + ')(?!\\p{L})', 'gu'
);

const NOISE_WORDS = /(?<!\p{L})(?:de|du|des|au|aux|la|le|les|un|une|pour|en|à|a|et|ou)(?!\p{L})/gu;
// Élisions : "d'olive" laisserait "'olive" si on retirait juste le "d".
const ELISIONS = /(?<!\p{L})(?:d|l|n|s|j|c|m|t|qu)'/gu;

export function isOptionalIngredient(name) {
  return /\((?:optionnel|facultatif)/i.test(name || '');
}

export function normalizeIngredientName(name) {
  let n = String(name == null ? '' : name).toLowerCase();
  n = n.replace(/[\u2018\u2019\u02bc`]/g, "'");
  n = n.replace(/\([^)]*\)/g, ' ');   // parenthèses d'abord, avant la virgule
  n = n.split(',')[0];                // "mirabelles, dénoyautées" -> "mirabelles"
  n = n.replace(PREPARATION_WORDS, ' ');
  n = n.replace(ELISIONS, ' ');
  n = n.replace(NOISE_WORDS, ' ');
  n = n.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  // pluriel : seulement sur les mots assez longs, "ails" n'existe pas mais "riz" si
  n = n.split(' ').map(w => (w.length > 3 && !w.endsWith('ss') ? w.replace(/s$/, '') : w)).join(' ');
  return n.trim();
}

// Libellé lisible pour la liste de courses : le nom d'origine, débarrassé de la
// préparation, mais sans la normalisation destructrice (accents conservés).
export function ingredientLabel(name) {
  let n = String(name == null ? '' : name);
  n = n.replace(/\([^)]*\)/g, ' ').split(',')[0];
  return n.replace(/\s+/g, ' ').trim() || String(name || '');
}

// --- Lecture ---

export function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  match[1].split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (/^\[.*\]$/.test(val)) {
      val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    }
    meta[key] = val;
  });
  return { meta, body: match[2] || '' };
}

export function parseRecipeSections(body) {
  const lines = body.split('\n');
  let section = null;
  const ingredientsRaw = [];
  const stepsRaw = [];
  const notesRaw = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,3}\s*ingr[ée]dients/i.test(line)) { section = 'ing'; continue; }
    if (/^#{1,3}\s*[ée]tapes/i.test(line)) { section = 'steps'; continue; }
    if (/^#{1,3}\s*notes/i.test(line)) { section = 'notes'; continue; }
    if (/^#{1,3}\s/.test(line)) { section = null; continue; }
    if (!line && section !== 'notes') continue;
    if (section === 'ing') {
      ingredientsRaw.push(line.replace(/^[-*]\s*/, ''));
    } else if (section === 'steps') {
      stepsRaw.push(splitStepDuration(line.replace(/^(\d+[.)]|[-*])\s*/, '')));
    } else if (section === 'notes') {
      notesRaw.push(line);
    }
  }
  return {
    ingredients: ingredientsRaw.map(parseAmountUnit),
    steps: stepsRaw,
    notes: notesRaw.join('\n').trim(),
  };
}

export function parseRecipeMarkdown(raw) {
  const { meta, body } = parseFrontmatter(raw);
  const { ingredients, steps, notes } = parseRecipeSections(body);
  return {
    id: meta.id || '',
    title: meta.title || '',
    description: meta.description || '',
    categories: normalizeCategories(meta.categories != null ? meta.categories : meta.category),
    servings: meta.servings != null ? String(meta.servings) : '',
    yield_label: (meta.yield_label || '').trim(),
    mold: (meta.mold || '').trim(),
    prep_time: parseDuration(meta.prep_time),
    cook_time: parseDuration(meta.cook_time),
    rest_time: parseDuration(meta.rest_time),
    status: normalizeStatus(meta.status, { keeper: meta.keeper === true, classic: meta.classic === true }),
    main_ingredients: Array.isArray(meta.main_ingredients) ? meta.main_ingredients : [],
    source_url: meta.source_url || '',
    created: normalizeStamp(meta.created),
    updated: normalizeStamp(meta.updated),
    needs_review: meta.needs_review === true,
    ingredients,
    steps,
    notes,
  };
}

// --- Écriture ---

export function stringifyRecipeMarkdown(recipe) {
  const lines = [];
  lines.push('---');
  lines.push(`id: ${recipe.id}`);
  lines.push(`title: ${recipe.title}`);
  lines.push(`description: ${recipe.description || ''}`);
  lines.push(`categories: [${normalizeCategories(recipe.categories != null ? recipe.categories : recipe.category).join(', ')}]`);
  lines.push(`servings: ${recipe.servings || ''}`);
  lines.push(`yield_label: ${recipe.yield_label || ''}`);
  lines.push(`mold: ${recipe.mold || ''}`);
  lines.push(`prep_time: ${recipe.prep_time || ''}`);
  lines.push(`cook_time: ${recipe.cook_time || ''}`);
  lines.push(`rest_time: ${recipe.rest_time || ''}`);
  lines.push(`status: ${normalizeStatus(recipe.status, recipe)}`);
  lines.push(`main_ingredients: [${(recipe.main_ingredients || []).join(', ')}]`);
  lines.push(`source_url: ${recipe.source_url || ''}`);
  lines.push(`created: ${normalizeStamp(recipe.created) || nowStamp()}`);
  lines.push(`updated: ${normalizeStamp(recipe.updated) || nowStamp()}`);
  lines.push(`needs_review: ${recipe.needs_review ? 'true' : 'false'}`);
  lines.push('---');
  lines.push('');
  lines.push('## Ingrédients');
  (recipe.ingredients || []).forEach(ing => {
    const parts = [];
    if (ing.amount != null && ing.amount !== '') parts.push(ing.amount);
    if (ing.unit) parts.push(ing.unit);
    parts.push(ing.name);
    lines.push(`- ${parts.join(' ')}`);
  });
  lines.push('');
  lines.push('## Étapes');
  (recipe.steps || []).forEach((step, i) => {
    const { text, minutes } = typeof step === 'string' ? { text: step, minutes: null } : step;
    lines.push(`${i + 1}. ${text}${minutes ? ` {${formatDuration(minutes)}}` : ''}`);
  });
  if (recipe.notes) {
    lines.push('');
    lines.push('## Notes');
    lines.push(recipe.notes);
  }
  lines.push('');
  return lines.join('\n');
}
