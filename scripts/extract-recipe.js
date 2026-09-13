#!/usr/bin/env node
/**
 * Extrait une recette depuis un fichier déposé dans _staging/ et l'ajoute au
 * projet mes-recettes sous forme de fichier Markdown + frontmatter.
 *
 * Trois sources possibles :
 *   - .md  : recette en texte brut (titre, description, INGREDIENTS / STEPS / NOTES)
 *   - .html: page web (schema.org Recipe) ou widget Claude sauvegardé
 *   - --url: une page web téléchargée à la volée dans _staging/, puis traitée comme un .html
 *
 * Usage :
 *   node scripts/extract-recipe.js chemin/vers/fichier.md [--category "Entrée,Soupe"] [--servings 6]
 *                                    [--status untried|favorite|classic|none] [--yield-label moule]
 *   node scripts/extract-recipe.js --url https://... [--servings 6] [--status ...]
 *   node scripts/extract-recipe.js --staging   # traite tous les .md et .html de _staging/
 *
 * Le nombre de personnes est obligatoire : s'il est absent de la source, le
 * script le demande (terminal interactif) ou s'arrête en réclamant --servings.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import {
  slugify,
  parseAmountUnit,
  parseFrontmatter,
  stringifyRecipeMarkdown,
  normalizeCategories,
  normalizeStatus,
  normalizeType,
  STATUS_VALUES,
  formatYield,
  splitStepDuration,
  parseDuration,
  normalizeStamp,
  nowStamp,
} from '../assets/recipe-format.js';
import { parseStagingMarkdown, findServings } from './parse-staging-md.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RECIPES_DIR = path.join(ROOT, 'data', 'recipes');
const INDEX_PATH = path.join(ROOT, 'data', 'index.json');
const STAGING_DIR = path.join(ROOT, '_staging');
const SUPPORTED_EXT = ['.md', '.html', '.htm'];
// Certains sites de recettes renvoient une page vide à un client sans User-Agent.
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const FETCH_TIMEOUT_MS = 20000;

// Les titres et descriptions des sites de recettes traînent une queue SEO
// (« : la meilleure recette », « | Marmiton ») qui n'a rien à faire dans une fiche.
const TITLE_TAIL_NOISE = /^(la |le |les )?(meilleures? |vraie |bonne )?recettes?\b|^(facile|rapide|maison|inratable|traditionnelle?|savoureuse?)\b|^\d+\s*(min|personnes?)\b|^(marmiton|750g|cuisineaz|cuisine az|journal des femmes|ptitchef|jow)\b/i;
const SEO_DESCRIPTION = /\d+\s*(min|minutes|h)\b[^.]*\bde (préparation|cuisson)|^recette\b[^.]*\b(facile|rapide|meilleure)\b/i;

// « cuire 40 mn », « laisser lever 1 h 30 » : une durée annoncée dans le texte
// d'une étape. Ne dit pas qu'il FAUT un minuteur (« 2 min par crêpe » n'en veut
// pas), seulement qu'il faut regarder.
const STEP_DURATION_HINT = /\b\d+(?:\s*(?:à|-)\s*\d+)?\s*(?:min\b|mn\b|minutes?|h\b|heures?)/i;

const CATEGORY_KEYWORDS = {
  // En tête : ce qui accompagne un plat ne doit pas se faire attraper par
  // « crème » ou « tarte ». Mots-clés volontairement étroits — « sauce » seul
  // rangerait « poulet sauce moutarde » au rayon des sauces.
  // Marinade avant Sauce : une marinade est une sauce, l'inverse est faux.
  'Marinade': ['marinade','à mariner','saumure'],
  'Sauce': ['sauce ','vinaigrette','coulis','pesto','mayonnaise','aïoli','condiment','chutney'],
  // Avant Dessert, qui attraperait « caramel » et « chocolat » : ce qui nappe un
  // dessert n'en est pas un. Mots-clés étroits, une ganache de tarte reste Dessert.
  'Sauce sucrée': ['caramel beurre salé','pâte à tartiner','anko','azuki','lemon curd','crème anglaise','coulis de fruit','confiture'],
  'Dessert': ['sucre','farine','chocolat','gâteau','tarte','crème','vanille','biscuit','meringue','caramel'],
  'Soupe': ['bouillon','potage','velouté','soupe'],
  'Entrée': ['salade','entrée','tartare','carpaccio'],
  'Apéro': ['apéro','tapenade','houmous','dip','toast'],
  'Petit-déjeuner': ['pancake','porridge','granola','brioche'],
  // Après Dessert : un gâteau reste un dessert, seul ce qui se mange
  // explicitement à quatre heures bascule ici.
  'Goûter': ['goûter','gouter','crêpe','crepe','gaufre','madeleine','cookie'],
};

// Les sites rangent leurs recettes dans leurs propres rayons (« Plat principal »,
// « Mousse Aux Fruits ») : hors de question de les laisser entrer tels quels dans
// les filtres de l'accueil. Ce qui ne se reconnaît pas repart en devinette.
const SITE_CATEGORIES = [
  ['Marinade', /marinade|saumure/i],
  ['Sauce', /^sauces?$|sauces? et|condiment|vinaigrette|assaisonnement/i],
  ['Sauce sucrée', /sauces? sucr|p[âa]te [àa] tartiner|coulis|confiture|p[âa]te de fruits/i],
  ['Dessert', /dessert|p[âa]tisserie|g[âa]teau|tarte sucr|mousse|glace|confiserie/i],
  ['Entrée', /entr[ée]e|salade compos|amuse.?bouche.*entr/i],
  ['Soupe', /soupe|potage|velout[ée]|bouillon/i],
  ['Apéro', /ap[ée]ritif|ap[ée]ro|amuse.?(bouche|gueule)|tapas/i],
  ['Petit-déjeuner', /petit.?d[ée]jeuner|brunch|viennoiserie/i],
  ['Goûter', /go[ûu]ter|quatre.?heures|snack/i],
  ['Plat', /plats? principa|plat complet|plat unique|^plats?$/i],
];

function mapSiteCategory(value) {
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const raw of list) {
    const text = String(raw || '').trim();
    if (!text) continue;
    for (const [category, pattern] of SITE_CATEGORIES) {
      if (pattern.test(text) && !out.includes(category)) out.push(category);
    }
  }
  return out;
}

function guessCategory(text) {
  const low = text.toLowerCase();
  // "tarte salée" tombait dans Dessert à cause du mot "tarte".
  const savoury = /\bsal[ée]e?s?\b/.test(low);
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === 'Dessert' && savoury) continue;
    if (keywords.some(k => low.includes(k))) return cat;
  }
  return 'Plat';
}

// Retire la queue SEO d'un titre : « Cake à la banane : la meilleure recette »,
// « Tarte aux pommes | Marmiton ». On ne coupe que sur un séparateur explicite,
// et seulement si le segment de queue n'est que du remplissage.
function cleanTitle(raw) {
  const original = String(raw || '').replace(/\s+/g, ' ').trim();
  const parts = original.split(/\s+[:|–—]\s+|\s+-\s+/);
  while (parts.length > 1 && TITLE_TAIL_NOISE.test(parts[parts.length - 1].trim())) parts.pop();
  let title = parts.join(' : ').trim();
  title = title.replace(/^recette\s+(de\s+la\s+|de\s+l'|du\s+|des\s+|de\s+)?/i, '');
  if (!title) return original;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// Une description qui récite « 6 personnes, 90 min de préparation » est un
// gabarit SEO, pas une description : mieux vaut aucune (le script la réclame)
// qu'une phrase à rallonge sur la fiche.
// Certains sites encodent les entités HTML *dans* leur JSON-LD : « d&apos;une
// quiche » arrive tel quel jusqu'à la fiche. cheerio les décode pour le repli
// heuristique, mais le chemin JSON-LD ne passe pas par lui.
const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â',
  ccedil: 'ç', ugrave: 'ù', ucirc: 'û', icirc: 'î', iuml: 'ï',
  ocirc: 'ô', oelig: 'œ', laquo: '«', raquo: '»', deg: '°', hellip: '…',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—',
};

function decodeEntities(raw) {
  return String(raw == null ? '' : raw).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const named = HTML_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

// Les durées schema.org sont en ISO 8601, et pas toujours sous la forme courte :
// l'atelier des chefs sert « P0Y0M0DT0H0M900S », soit 15 min. On lit la partie
// temps (après le T) plus les jours, et on rend des minutes.
function parseIsoDuration(raw) {
  const text = String(raw == null ? '' : raw).trim().toUpperCase();
  const m = text.match(/^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return null;
  const [, , , weeks, days, hours, minutes, seconds] = m.map(v => (v === undefined ? 0 : Number(v)));
  const total = ((weeks * 7 + days) * 24 + hours) * 60 + minutes + seconds / 60;
  const rounded = Math.round(total);
  return rounded > 0 ? rounded : null;
}

function cleanDescription(raw) {
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  if (!text || SEO_DESCRIPTION.test(text)) return '';
  return text;
}

function cleanStepText(raw) {
  return decodeEntities(raw).replace(/\s+/g, ' ').trim();
}

// L'inverse existe aussi : une seule « étape » qui contient toute la recette,
// ses paragraphes séparés par une ligne vide. Chaque paragraphe est une étape —
// et c'est ce qui permet d'y accrocher un minuteur.
function splitParagraphs(text) {
  const parts = String(text || '').split(/\n\s*\n+/).map(x => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [text];
}

// Marmiton & co coupent parfois une phrase en deux étapes (« Ajouter les oeufs, »
// / « et bien mélanger. »). Une étape qui finit sur une virgule n'est jamais finie.
function mergeTruncatedSteps(steps) {
  const merged = [];
  for (const step of steps) {
    const last = merged[merged.length - 1];
    if (last && /,$/.test(last)) merged[merged.length - 1] = `${last} ${step}`;
    else merged.push(step);
  }
  return merged;
}

// Les étapes arrivent en HowToStep, parfois groupées en HowToSection.
function flattenInstructions(raw, depth = 0) {
  if (!raw || depth > 3) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const steps = [];
  for (const step of list) {
    if (typeof step === 'string') { steps.push(step); continue; }
    if (!step || typeof step !== 'object') continue;
    if (step.itemListElement) { steps.push(...flattenInstructions(step.itemListElement, depth + 1)); continue; }
    const text = step.text || step.name || '';
    if (text) steps.push(text);
  }
  return steps;
}

// Le JSON-LD se lit à la regex : pas besoin de cheerio, donc pas de Node >= 20
// pour le cas courant (Marmiton, 750g, la plupart des blogs).
function jsonLdDocuments(raw) {
  const docs = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(raw))) {
    try { docs.push(JSON.parse(match[1].trim())); } catch (e) { /* bloc invalide, ignoré */ }
  }
  return docs;
}

// Une URL de recette porte souvent un identifiant qui prime sur le slug : sur
// marmiton, .../recette_soupe-a-l-oignon_18889.aspx sert le boeuf bourguignon.
// Comparer l'URL demandée à l'URL canonique de la page évite d'importer, sans
// s'en apercevoir, une recette qui n'est pas celle qu'on croyait.
function samePage(a, b) {
  try {
    const ua = new URL(a), ub = new URL(b);
    const norm = u => u.pathname.replace(/\/+$/, '').toLowerCase();
    return ua.hostname.replace(/^www\./, '') === ub.hostname.replace(/^www\./, '') && norm(ua) === norm(ub);
  } catch (e) {
    return false;
  }
}

function extractFromJsonLd(docs) {
  for (const data of docs) {
    let candidates = Array.isArray(data) ? data : [data];
    for (const item of [...candidates]) {
      if (item && item['@graph']) candidates = candidates.concat(item['@graph']);
    }
    for (const item of candidates) {
      if (!item || typeof item !== 'object') continue;
      const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
      if (types.includes('Recipe')) {
        const title = cleanTitle(decodeEntities(item.name || ''));
        const description = cleanDescription(item.description || '');
        let servings = item.recipeYield || '';
        if (Array.isArray(servings)) servings = servings[0];
        servings = String(servings).match(/\d+/)?.[0] || '';
        const ingredientsRaw = item.recipeIngredient || item.ingredients || [];
        const steps = mergeTruncatedSteps(flattenInstructions(item.recipeInstructions).flatMap(splitParagraphs).map(cleanStepText).filter(Boolean));
        return {
          title,
          description,
          servings,
          categories: mapSiteCategory(item.recipeCategory),
          mold: '',
          unknown_infos: [],
          source_url: typeof item.url === 'string' ? item.url : (typeof item['@id'] === 'string' ? item['@id'] : ''),
          ingredients: ingredientsRaw.filter(Boolean).map(x => parseAmountUnit(decodeEntities(x))),
          steps: steps.filter(Boolean).map(splitStepDuration),
          notes: '',
          prep_time: parseIsoDuration(item.prepTime),
          cook_time: parseIsoDuration(item.cookTime),
          rest_time: null,
          confidence: 'high',
        };
      }
    }
  }
  return null;
}

function extractHeuristic($) {
  const title = cleanTitle($('h1').first().text() || $('title').first().text() || '') || 'Recette sans titre';

  let description = cleanDescription($('meta[name="description"]').attr('content') || '');
  if (!description) {
    description = cleanDescription(($('p').first().text() || '').slice(0, 200));
  }

  function findSection(keywords) {
    let result = [];
    $('h1,h2,h3,h4,strong,div,span').each((_, el) => {
      const txt = $(el).text().trim().toLowerCase();
      if (keywords.some(k => txt.includes(k))) {
        const list = $(el).nextAll('ul,ol').first();
        if (list.length) {
          const items = list.find('li').map((_, li) => $(li).text().trim()).get().filter(Boolean);
          if (items.length) { result = items; return false; }
        }
      }
    });
    return result;
  }

  const ingredientsRaw = findSection(['ingrédient', 'ingredient']);
  const stepsRaw = findSection(['étape', 'etape', 'préparation', 'preparation', 'instructions', 'method', 'directions']);

  const ingredients = ingredientsRaw.map(parseAmountUnit);
  const confidence = (!ingredientsRaw.length || !stepsRaw.length) ? 'low' : 'medium';

  return {
    title,
    description,
    servings: findServings($('body').text()),
    categories: [],
    mold: '',
    unknown_infos: [],
    source_url: '',
    ingredients,
    steps: stepsRaw.map(splitStepDuration),
    notes: '',
    prep_time: null,
    cook_time: null,
    rest_time: null,
    confidence,
  };
}

// cheerio n'est chargé que pour le repli heuristique : il tire undici, qui exige
// Node >= 20. Une page qui expose un schema.org Recipe se lit sans lui.
async function extractFromHtml(raw, sourceUrl = '') {
  const fromJsonLd = extractFromJsonLd(jsonLdDocuments(raw));
  if (fromJsonLd) {
    const canonical = fromJsonLd.source_url;
    if (sourceUrl && canonical && !samePage(sourceUrl, canonical)) {
      console.log(`   ⚠ la page servie est ${canonical}`);
      console.log(`     et non l'URL demandée : vérifie que « ${fromJsonLd.title} » est bien la recette voulue.`);
    }
    if (sourceUrl && !canonical) fromJsonLd.source_url = sourceUrl;
    return fromJsonLd;
  }

  // cheerio tire undici, qui lève une erreur non rattrapable en Node < 20 (elle
  // survient après le catch et tue le process) : on refuse avant de l'importer.
  if (Number(process.versions.node.split('.')[0]) < 20) {
    throw new Error(
      `pas de schema.org Recipe dans la page, et le repli heuristique demande Node >= 20 `
      + `(tu es en ${process.version}).\n`
      + `   → nvm use 20, ou reformate la recette à la main dans _staging/<nom>.md.`
    );
  }
  let cheerio;
  try {
    cheerio = await import('cheerio');
  } catch (e) {
    throw new Error(
      `pas de schema.org Recipe dans la page, et cheerio est introuvable pour le repli (${e.message}).\n`
      + `   → npm install, ou reformate la recette à la main dans _staging/<nom>.md.`
    );
  }
  const data = extractHeuristic(cheerio.load(raw));
  if (sourceUrl) data.source_url = sourceUrl;
  return data;
}

/**
 * Télécharge une page dans _staging/ (gitignoré) : l'extraction repart ensuite
 * du fichier, et le HTML reste sur le disque si la fiche est à reprendre.
 */
async function downloadPage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw new Error(`URL invalide : ${url}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`URL non supportée (${parsed.protocol}) : seul http(s) est téléchargeable.`);
  }

  let res;
  try {
    res = await fetch(parsed.href, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fr-FR,fr;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`téléchargement impossible (${e.message}).`);
  }
  if (!res.ok) throw new Error(`la page a répondu ${res.status} ${res.statusText}.`);

  const html = await res.text();
  const last = decodeURIComponent(parsed.pathname.replace(/\/+$/, '').split('/').pop() || '');
  const stem = last.replace(/\.(html?|aspx?|php|jsp)$/i, '').trim();
  const base = slugify(stem || parsed.hostname);
  fs.mkdirSync(STAGING_DIR, { recursive: true });
  const outPath = path.join(STAGING_DIR, `${base}.html`);
  fs.writeFileSync(outPath, html, 'utf-8');
  console.log(`[↓] ${parsed.href}\n   → _staging/${base}.html (${Math.round(html.length / 1024)} ko)`);
  // Une URL de recette qui redirige mène souvent à une autre recette : le dire.
  if (res.url && !samePage(res.url, parsed.href)) {
    console.log(`   ↪ redirigé vers ${res.url}`);
  }
  return { path: outPath, finalUrl: res.url || parsed.href };
}

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

/**
 * Le nombre de personnes ne doit jamais être deviné : soit la source l'indique,
 * soit --servings le fournit, soit on le demande, soit on refuse d'écrire.
 */
async function resolveServings(data, override, fileLabel, previous) {
  // Une source muette n'efface pas le nombre déjà saisi sur une fiche existante.
  const fromSource = String(override || data.servings || previous.servings || '').match(/\d+/)?.[0];
  if (fromSource) return fromSource;

  if (!process.stdin.isTTY) {
    return null;
  }
  for (let i = 0; i < 3; i++) {
    const answer = await ask(`Nombre de personnes pour « ${data.title || fileLabel} » ? `);
    const n = answer.match(/\d+/)?.[0];
    if (n && Number(n) > 0) return n;
    console.log('   → réponds par un nombre (ex. 6).');
  }
  return null;
}

function updateIndex(recipe) {
  let index = [];
  if (fs.existsSync(INDEX_PATH)) {
    index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  }
  index = index.filter(r => r.id !== recipe.id);
  index.push({
    id: recipe.id,
    type: 'recipe',
    title: recipe.title,
    description: recipe.description,
    categories: recipe.categories,
    servings: recipe.servings,
    yield_label: recipe.yield_label,
    status: recipe.status,
    needs_review: recipe.needs_review,
    main_ingredients: recipe.main_ingredients || [],
    created: recipe.created,
    updated: recipe.updated,
  });
  index.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

// Une recette déjà présente garde sa date de création d'origine.
function existingMeta(slug) {
  const outPath = path.join(RECIPES_DIR, `${slug}.md`);
  if (!fs.existsSync(outPath)) return {};
  return parseFrontmatter(fs.readFileSync(outPath, 'utf-8')).meta;
}

async function processFile(filePath, options, sourceUrl = '') {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXT.includes(ext)) {
    console.log(`[ignoré] ${path.basename(filePath)} : extension non supportée (${SUPPORTED_EXT.join(', ')}).`);
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  if (!raw.trim()) {
    console.log(`[✗] ${path.basename(filePath)} : fichier vide, rien à extraire.`);
    return null;
  }

  let data;
  try {
    data = ext === '.md' ? parseStagingMarkdown(raw) : await extractFromHtml(raw, sourceUrl || options.sourceUrl || '');
  } catch (e) {
    console.log(`[\u2717] ${path.basename(filePath)} : ${e.message}`);
    return null;
  }
  if (!data.title) data.title = path.basename(filePath, ext);

  const previous = existingMeta(slugify(data.title));
  // Un mémo s'écrit à la main : la réécriture au format recette effacerait ses tableaux.
  if (normalizeType(previous.type) === 'memo') {
    console.log(`[✗] ${path.basename(filePath)} : data/recipes/${slugify(data.title)}.md est un mémo, il ne s'écrase pas.`);
    return null;
  }
  const servings = await resolveServings(data, options.servings, path.basename(filePath), previous);
  if (!servings) {
    console.log(`[✗] ${path.basename(filePath)} : nombre de personnes introuvable dans la source.`);
    console.log(`   → relance avec --servings <n>, ou ajoute "Pour 6 personnes" dans le fichier.`);
    console.log('   → recette non écrite.');
    return null;
  }

  // Une catégorie devinée par mots-clés reste un pis-aller : le multi-catégories
  // (Entrée + Soupe) se décide à la main ou via --category.
  const categories = options.categories.length
    ? options.categories
    : (data.categories.length ? data.categories : [guessCategory(data.title + ' ' + data.description)]);
  const slug = slugify(data.title);
  const now = nowStamp();

  const recipe = {
    id: slug,
    title: data.title,
    // Une source muette (b.md n'a pas de description) ne doit pas effacer une
    // description rédigée à la main lors d'un premier passage.
    description: data.description || previous.description || '',
    categories,
    servings,
    yield_label: options.yieldLabel != null ? options.yieldLabel : (previous.yield_label || ''),
    mold: data.mold || previous.mold || '',
    // Les temps d'une source muette ne doivent pas écraser ceux déjà saisis.
    prep_time: data.prep_time || parseDuration(previous.prep_time),
    cook_time: data.cook_time || parseDuration(previous.cook_time),
    rest_time: data.rest_time || parseDuration(previous.rest_time),
    status: options.status != null ? options.status : normalizeStatus(previous.status, previous),
    main_ingredients: Array.isArray(previous.main_ingredients) ? previous.main_ingredients : [],
    ingredients: data.ingredients,
    steps: data.steps,
    notes: data.notes || '',
    source_url: sourceUrl || options.sourceUrl || data.source_url || previous.source_url || '',
    created: normalizeStamp(previous.created) || now,
    updated: now,
    needs_review: data.confidence !== 'high' || data.ingredients.length === 0 || data.steps.length === 0,
  };

  fs.mkdirSync(RECIPES_DIR, { recursive: true });
  const outPath = path.join(RECIPES_DIR, `${slug}.md`);
  fs.writeFileSync(outPath, stringifyRecipeMarkdown(recipe), 'utf-8');
  updateIndex(recipe);

  const verb = previous.created ? 'mise à jour' : 'créée';
  console.log(`[${recipe.needs_review ? '⚠ à vérifier' : 'OK'}] ${recipe.title} -> data/recipes/${slug}.md (${categories.join(' + ')}, ${formatYield(servings, recipe.yield_label)}, ${recipe.status}, ${verb})`);
  if (recipe.needs_review) {
    console.log('   → relis les ingrédients/étapes.');
  }
  if (!recipe.description) {
    console.log('   → la source ne donne pas de description : à rédiger dans le .md.');
  }
  // Un main_ingredients vide est un état valide (une pâte à tarte n'a pas
  // d'ingrédient qui la caractérise) : on le rappelle à la création, pas après.
  for (const info of (data.unknown_infos || [])) {
    console.log(`   ⚠ ligne INFOS non reconnue, ignorée : « ${info} »`);
  }
  if (!recipe.prep_time && !recipe.cook_time && !recipe.steps.some(s => s.minutes)) {
    console.log('   → aucun temps trouvé : voir le prompt « Demander les temps » du README.');
  }
  // Aucune page web n'écrit de {durée} : les minuteurs se posent toujours à la
  // relecture. Signaler les étapes qui annoncent une durée sans en porter une
  // évite l'oubli — c'est le seul moyen de les repérer sans relire la fiche.
  const sansMinuteur = recipe.steps
    .map((step, i) => ({ n: i + 1, step }))
    .filter(({ step }) => !step.minutes && STEP_DURATION_HINT.test(step.text));
  if (sansMinuteur.length) {
    console.log(`   → ${sansMinuteur.length} étape(s) annoncent une durée sans minuteur : `
      + sansMinuteur.map(({ n }) => `§${n}`).join(', '));
    console.log('     ajoute {40 min} en FIN de ligne si la durée est à minuter ; une étape qui');
    console.log('     en enchaîne deux se coupe en deux (voir « Une étape, un minuteur »).');
  }
  if (!previous.created && !recipe.main_ingredients.length) {
    console.log('   → main_ingredients: [] — remplis-le (ex: [courgette, poulet]) si 2-4 ingrédients');
    console.log('     caractérisent la recette, sinon laisse vide.');
  }
  return recipe;
}

function parseArgs(argv) {
  const options = { staging: false, categories: [], servings: null, status: null, yieldLabel: null, sourceUrl: null, urls: [], files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--staging') options.staging = true;
    else if (arg === '--url') options.urls.push(argv[++i]);
    else if (arg === '--source-url') options.sourceUrl = argv[++i];
    else if (arg === '--category') options.categories.push(...normalizeCategories(argv[++i], null));
    else if (arg === '--servings') options.servings = argv[++i];
    else if (arg === '--status') {
      const raw = argv[++i];
      const value = normalizeStatus(raw);
      if (value === 'none' && !/^(none|aucun)$/i.test(String(raw || ''))) {
        console.log(`⚠ --status "${raw}" non reconnu, valeurs possibles : ${STATUS_VALUES.join(', ')}. Ignoré.`);
      } else {
        options.status = value;
      }
    }
    else if (arg === '--yield-label') options.yieldLabel = argv[++i];
    else if (arg.startsWith('--')) console.log(`Option inconnue ignorée : ${arg}`);
    else options.files.push(arg);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  for (const url of options.urls) {
    let page;
    try {
      page = await downloadPage(url);
    } catch (e) {
      console.log(`[✗] ${url} : ${e.message}`);
      console.log('   → si la page résiste, copie la recette à la main dans _staging/<nom>.md');
      console.log('     (voir le format dans le README) puis relance --staging.');
      continue;
    }
    await processFile(page.path, options, page.finalUrl);
  }

  if (options.staging) {
    if (!fs.existsSync(STAGING_DIR)) {
      console.log('Le dossier _staging/ n\'existe pas.');
      return;
    }
    const files = fs.readdirSync(STAGING_DIR)
      .filter(f => SUPPORTED_EXT.includes(path.extname(f).toLowerCase()))
      .sort();
    if (!files.length) {
      console.log(`Aucun fichier ${SUPPORTED_EXT.join(' / ')} dans _staging/`);
      return;
    }
    if (files.length > 1 && options.servings) {
      console.log('⚠ --servings s\'applique à toutes les recettes traitées.');
    }
    for (const f of files) {
      await processFile(path.join(STAGING_DIR, f), options);
    }
  } else if (options.files.length) {
    for (const f of options.files) {
      await processFile(f, options);
    }
  } else if (!options.urls.length) {
    console.log('Usage: node scripts/extract-recipe.js <fichier.md|.html> [--category "Entrée,Soupe"] [--servings 6]');
    console.log('       [--status untried|favorite|classic|none] [--yield-label moule] [--source-url https://...]');
    console.log('   ou: node scripts/extract-recipe.js --url https://... [--servings 6]');
    console.log('   ou: node scripts/extract-recipe.js --staging');
  }
}

main();
