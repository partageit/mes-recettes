#!/usr/bin/env node
// Reconstruit data/index.json à partir de tous les fichiers data/recipes/*.md
// À lancer après avoir édité une recette à la main.
//
// Au passage, le frontmatter est complété :
//   - created : ajouté s'il manque (date du fichier sur le disque)
//   - updated : recalé sur la date du fichier si celui-ci a été modifié depuis
//     (la date du fichier est restaurée après notre écriture, sinon le simple
//      fait de réécrire relancerait un bump au passage suivant)
//   - category (ancien champ au singulier) migré vers categories: [...]
//   - keeper/classic (anciens booléens) fusionnés en status: none|favorite|classic
//   - yield_label : ajouté s'il manque
// Utiliser --no-touch pour ne rien réécrire et se contenter de lire.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseRecipeMarkdown, parseFrontmatter, normalizeCategories, normalizeStatus, normalizeStamp, formatStamp, nowStamp } from '../assets/recipe-format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RECIPES_DIR = path.join(ROOT, 'data', 'recipes');
const INDEX_PATH = path.join(ROOT, 'data', 'index.json');

function parseFrontmatterOf(raw) {
  return { meta: parseFrontmatter(raw).meta };
}

function removeFrontmatterField(raw, key) {
  return raw.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, 'm'), '');
}

function insertAfterField(raw, afterKey, line) {
  if (new RegExp(`^${afterKey}\\s*:`, 'm').test(raw)) {
    return raw.replace(new RegExp(`^(${afterKey}\\s*:.*)$`, 'm'), `$1\n${line}`);
  }
  return raw.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, `$1\n${line}$2`);
}

function setFrontmatterField(raw, key, value) {
  const re = new RegExp(`^(${key}\\s*:).*$`, 'm');
  if (re.test(raw)) return raw.replace(re, `$1 ${value}`);
  // Champ absent : on l'insère à la fin du frontmatter.
  return raw.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, `$1\n${key}: ${value}$2`);
}

// Fiches écrites avant le passage au multi-catégories : `category: Dessert`
// devient `categories: [Dessert]`. Les booléens keeper/classic, qui pouvaient
// se contredire, fusionnent dans le champ unique `status`.
function migrateFields(raw) {
  let content = raw;
  let changed = false;

  const { meta } = parseFrontmatterOf(content);
  if (meta.categories == null) {
    const cats = normalizeCategories(meta.category).join(', ');
    if (/^category\s*:/m.test(content)) {
      content = content.replace(/^category\s*:.*$/m, `categories: [${cats}]`);
    } else {
      content = content.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, `$1\ncategories: [${cats}]$2`);
    }
    changed = true;
  }
  if (meta.yield_label == null) {
    content = insertAfterField(content, 'servings', 'yield_label: ');
    changed = true;
  }
  for (const [key, after] of [['mold', 'yield_label'], ['prep_time', 'mold'], ['cook_time', 'prep_time'], ['rest_time', 'cook_time']]) {
    if (meta[key] == null) {
      content = insertAfterField(content, after, `${key}: `);
      changed = true;
    }
  }
  if (meta.status == null) {
    const status = normalizeStatus(null, {
      keeper: meta.keeper === true,
      classic: meta.classic === true,
    });
    content = insertAfterField(content, 'yield_label', `status: ${status}`);
    content = removeFrontmatterField(content, 'keeper');
    content = removeFrontmatterField(content, 'classic');
    changed = true;
  }
  return { content, changed };
}

// Les dates du frontmatter font foi ; le disque ne sert qu'à combler les trous
// et à détecter une édition manuelle postérieure à la dernière date connue.
function reconcileDates(raw, fileDate, today) {
  // On compare aux valeurs BRUTES du frontmatter : parseRecipeMarkdown les
  // normalise déjà, ce qui masquerait une fiche écrite en date seule.
  const meta = parseFrontmatter(raw).meta;
  const created = normalizeStamp(meta.created);
  const updated = normalizeStamp(meta.updated);
  let content = raw;
  let changed = false;

  const nextCreated = created || fileDate;
  if (nextCreated !== String(meta.created || '').trim()) {
    content = setFrontmatterField(content, 'created', nextCreated);
    changed = true;
  }

  // Comparaison de dates seules (YYYY-MM-DD) : l'opération est idempotente,
  // relancer le script sans rien éditer ne retouche aucun fichier.
  let nextUpdated = updated || nextCreated || today;
  if (fileDate > nextUpdated) nextUpdated = fileDate;
  if (nextUpdated !== String(meta.updated || '').trim()) {
    content = setFrontmatterField(content, 'updated', nextUpdated);
    changed = true;
  }

  return { content, changed, created: nextCreated, updated: nextUpdated };
}

function main() {
  const touch = !process.argv.includes('--no-touch');

  if (!fs.existsSync(RECIPES_DIR)) {
    console.log('Aucun dossier data/recipes/.');
    return;
  }
  const files = fs.readdirSync(RECIPES_DIR).filter(f => f.endsWith('.md'));
  const today = nowStamp();
  const touched = [];

  const index = files.map(f => {
    const fullPath = path.join(RECIPES_DIR, f);
    let raw = fs.readFileSync(fullPath, 'utf-8');
    const stat = fs.statSync(fullPath);
    const fileDate = formatStamp(stat.mtime);

    const migration = migrateFields(raw);
    const dates = reconcileDates(migration.content, fileDate, today);
    if ((migration.changed || dates.changed) && touch) {
      fs.writeFileSync(fullPath, dates.content, 'utf-8');
      // Compléter le frontmatter n'est pas une modification du contenu : on rend
      // au fichier sa date d'origine pour que l'opération reste idempotente.
      fs.utimesSync(fullPath, stat.atime, stat.mtime);
      raw = dates.content;
      touched.push(f);
    }

    const r = parseRecipeMarkdown(raw);
    const missing = [];
    // Un mémo ne se compte pas en portions.
    if (!r.servings && r.type !== 'memo') missing.push('servings');
    if (missing.length) {
      console.log(`⚠ ${f} : champ(s) manquant(s) -> ${missing.join(', ')}`);
    }
    // Un renvoi vers une fiche renommée ou supprimée ne s'afficherait plus.
    const broken = r.see_also.filter(slug => !files.includes(`${slug}.md`));
    if (broken.length) {
      console.log(`⚠ ${f} : see_also introuvable -> ${broken.join(', ')}`);
    }

    return {
      id: r.id || path.basename(f, '.md'),
      type: r.type,
      title: r.title,
      description: r.description,
      categories: r.categories,
      servings: r.servings,
      yield_label: r.yield_label,
      mold: r.mold,
      prep_time: r.prep_time,
      cook_time: r.cook_time,
      rest_time: r.rest_time,
      total_time: (r.prep_time || 0) + (r.cook_time || 0) + (r.rest_time || 0) || null,
      status: r.status,
      needs_review: r.needs_review,
      main_ingredients: r.main_ingredients,
      created: dates.created,
      updated: dates.updated,
    };
  }).sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`Index reconstruit : ${index.length} recette(s) -> data/index.json`);
  if (touched.length) {
    console.log(`Dates mises à jour dans : ${touched.join(', ')}`);
  }
}

main();
