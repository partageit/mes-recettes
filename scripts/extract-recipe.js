#!/usr/bin/env node
/**
 * Extrait une recette depuis un fichier déposé dans _staging/ et l'ajoute au
 * projet mes-recettes sous forme de fichier Markdown + frontmatter.
 *
 * Deux formats de source :
 *   - .md  : recette en texte brut (titre, description, INGREDIENTS / STEPS / NOTES)
 *   - .html: page web (schema.org Recipe) ou widget Claude sauvegardé
 *
 * Usage :
 *   node scripts/extract-recipe.js chemin/vers/fichier.md [--category "Entrée,Soupe"] [--servings 6]
 *                                    [--status untried|favorite|classic|none] [--yield-label moule]
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

const CATEGORY_KEYWORDS = {
  'Dessert': ['sucre','farine','chocolat','gâteau','tarte','crème','vanille','biscuit','meringue','caramel'],
  'Soupe': ['bouillon','potage','velouté','soupe'],
  'Entrée': ['salade','entrée','tartare','carpaccio'],
  'Apéro': ['apéro','tapenade','houmous','dip','toast'],
  'Petit-déjeuner': ['pancake','porridge','granola','confiture','brioche'],
};

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

function extractFromJsonLd($) {
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const el of scripts) {
    let data;
    try {
      data = JSON.parse($(el).contents().text());
    } catch (e) {
      continue;
    }
    let candidates = Array.isArray(data) ? data : [data];
    for (const item of [...candidates]) {
      if (item && item['@graph']) candidates = candidates.concat(item['@graph']);
    }
    for (const item of candidates) {
      if (!item || typeof item !== 'object') continue;
      const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
      if (types.includes('Recipe')) {
        const title = item.name || '';
        const description = item.description || '';
        let servings = item.recipeYield || '';
        if (Array.isArray(servings)) servings = servings[0];
        servings = String(servings).match(/\d+/)?.[0] || '';
        const ingredientsRaw = item.recipeIngredient || item.ingredients || [];
        const instructionsRaw = item.recipeInstructions || [];
        const steps = [];
        for (const step of instructionsRaw) {
          if (typeof step === 'string') steps.push(step);
          else if (step && typeof step === 'object') steps.push(step.text || step.name || '');
        }
        return {
          title,
          description,
          servings,
          categories: normalizeCategories(item.recipeCategory, null),
          mold: '',
          unknown_infos: [],
          source_url: item.url || '',
          ingredients: ingredientsRaw.filter(Boolean).map(parseAmountUnit),
          steps: steps.filter(Boolean).map(splitStepDuration),
          notes: '',
          prep_time: parseDuration(item.prepTime && String(item.prepTime).replace(/^PT/, '').replace('H', ' h ').replace('M', ' min')),
          cook_time: parseDuration(item.cookTime && String(item.cookTime).replace(/^PT/, '').replace('H', ' h ').replace('M', ' min')),
          rest_time: null,
          confidence: 'high',
        };
      }
    }
  }
  return null;
}

function extractHeuristic($) {
  const title = ($('h1').first().text() || $('title').first().text() || 'Recette sans titre').trim();

  let description = $('meta[name="description"]').attr('content') || '';
  if (!description) {
    description = ($('p').first().text() || '').trim().slice(0, 200);
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

// cheerio n'est chargé que pour les sources .html : il tire undici, qui exige
// Node >= 20. Le flux .md doit rester utilisable sans cette contrainte.
async function extractFromHtml(raw) {
  let cheerio;
  try {
    cheerio = await import('cheerio');
  } catch (e) {
    throw new Error(
      `impossible de charger cheerio (${e.message}).\n`
      + `   → les sources .html demandent Node >= 20 (tu es en ${process.version}), `
      + `ou npm install si la dépendance manque.`
    );
  }
  const $ = cheerio.load(raw);
  return extractFromJsonLd($) || extractHeuristic($);
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

async function processFile(filePath, options) {
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
    data = ext === '.md' ? parseStagingMarkdown(raw) : await extractFromHtml(raw);
  } catch (e) {
    console.log(`[\u2717] ${path.basename(filePath)} : ${e.message}`);
    return null;
  }
  if (!data.title) data.title = path.basename(filePath, ext);

  const previous = existingMeta(slugify(data.title));
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
    source_url: data.source_url || previous.source_url || '',
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
  if (!previous.created && !recipe.main_ingredients.length) {
    console.log('   → main_ingredients: [] — remplis-le (ex: [courgette, poulet]) si 2-4 ingrédients');
    console.log('     caractérisent la recette, sinon laisse vide.');
  }
  return recipe;
}

function parseArgs(argv) {
  const options = { staging: false, categories: [], servings: null, status: null, yieldLabel: null, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--staging') options.staging = true;
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
  } else {
    console.log('Usage: node scripts/extract-recipe.js <fichier.md|.html> [--category "Entrée,Soupe"] [--servings 6]');
    console.log('       [--status untried|favorite|classic|none] [--yield-label moule]');
    console.log('   ou: node scripts/extract-recipe.js --staging');
  }
}

main();
