// Lit un fichier recette déposé dans _staging/ au format texte/Markdown :
//
//   Titre de la recette
//   Description sur une ou plusieurs lignes
//
//   INGREDIENTS
//   • 500 grams mirabelles
//
//   STEPS
//   1. Titre de l'étape: texte de l'étape. {20 min}
//
//   NOTES
//   Texte libre.
//
//   INFOS
//   Personnes: 6
//   Moule: 24 cm
//
//   TEMPS
//   Préparation: 20 min
//
// Les en-têtes acceptent le français et l'anglais, en majuscules ou en titres
// Markdown (## Ingrédients). Un frontmatter en tête de fichier est facultatif :
// s'il existe, ses champs servent de valeurs par défaut (servings, category…).
import {
  parseFrontmatter,
  parseAmountUnit,
  normalizeUnitsInText,
  normalizeCategories,
  parseDuration,
  splitStepDuration,
} from '../assets/recipe-format.js';

const SECTIONS = [
  { key: 'ingredients', re: /^(ingr[ée]dients?|ingredients?)$/i },
  { key: 'steps', re: /^([ée]tapes?|pr[ée]paration|instructions?|steps?|method|directions?)$/i },
  { key: 'notes', re: /^(notes?|remarques?|astuces?|tips?)$/i },
  { key: 'times', re: /^(temps|times|dur[ée]es?)$/i },
  { key: 'infos', re: /^(infos?|informations?|pratique|pratiques)$/i },
];

// Lignes d'une section INFOS : "Personnes: 6", "Moule: 24 cm".
const INFO_KEYS = [
  { key: 'servings', re: /^(personnes?|parts?|portions?|pers\.?|convives?|servings?)$/i },
  { key: 'mold', re: /^(moule|plat|pan|mould|mold)$/i },
];

// Lignes d'une section TEMPS : "Préparation: 20 min", "Cuisson : 1 h 30".
const TIME_KEYS = [
  { key: 'prep_time', re: /^(pr[ée]paration|prep(?:_time)?)$/i },
  { key: 'cook_time', re: /^(cuisson|cook(?:_time)?)$/i },
  { key: 'rest_time', re: /^(repos|r[ée]frig[ée]ration|attente|rest(?:_time)?)$/i },
];

function sectionOf(line) {
  const clean = line.replace(/^#{1,6}\s*/, '').replace(/^\*\*|\*\*$/g, '').replace(/\s*:\s*$/, '').trim();
  if (!clean) return null;
  const found = SECTIONS.find(s => s.re.test(clean));
  return found ? found.key : null;
}

// "pour 6 personnes", "6 portions", "Servings: 4", "Pour 4 pers."
export function findServings(text) {
  const patterns = [
    /pour\s+(\d+)\s*(?:personnes?|pers\.?|parts?|portions?|convives?)/i,
    /(\d+)\s*(?:personnes?|pers\.?|parts?|portions?|convives?)\b/i,
    /(?:servings?|yield|rendement)\s*[:=]?\s*(\d+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return '';
}

// "Préparation : 20 min", "Cuisson: 1 h 30" quelque part dans le texte.
function findDuration(text, keywords) {
  for (const kw of keywords) {
    const re = new RegExp(kw + `\\s*:?\\s*(\\d+\\s*(?:h|heures?)\\s*\\d*\\s*(?:min|minutes?)?|\\d+\\s*(?:min|minutes?|mn))`, 'i');
    const m = text.match(re);
    if (m) {
      const parsed = parseDuration(m[1]);
      if (parsed) return parsed;
    }
  }
  return null;
}

export function parseStagingMarkdown(raw) {
  const { meta, body } = parseFrontmatter(raw);
  const lines = body.split('\n');

  let title = (meta.title || '').trim();
  const descLines = [];
  const ingredientsRaw = [];
  const stepsRaw = [];
  const notesLines = [];
  const times = { prep_time: null, cook_time: null, rest_time: null };
  const infos = { servings: '', mold: '' };
  const unknownInfos = [];
  let section = title ? 'description' : 'title';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const next = sectionOf(line);
    if (next) { section = next; continue; }

    if (section === 'title') {
      if (!line) continue;
      title = line.replace(/^#{1,6}\s*/, '').trim();
      section = 'description';
      continue;
    }
    if (section === 'description') {
      if (!line) continue;
      descLines.push(line);
      continue;
    }
    if (section === 'ingredients') {
      if (!line) continue;
      const item = line.replace(/^[-*•·–—]\s*/, '').trim();
      if (item) ingredientsRaw.push(item);
      continue;
    }
    if (section === 'steps') {
      if (!line) continue;
      // Certaines sources posent le numéro seul sur sa ligne, le texte suivant
      // en dessous : on ouvre alors une étape vide que la suite viendra remplir.
      if (/^\d+[.)]?$/.test(line)) {
        stepsRaw.push('');
        continue;
      }
      const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
      if (numbered) {
        stepsRaw.push(numbered[2].trim());
      } else if (stepsRaw.length) {
        // ligne de continuation de l'étape en cours
        const text = line.replace(/^[-*•]\s*/, '').trim();
        stepsRaw[stepsRaw.length - 1] = (stepsRaw[stepsRaw.length - 1] + ' ' + text).trim();
      } else {
        stepsRaw.push(line.replace(/^[-*•]\s*/, '').trim());
      }
      continue;
    }
    if (section === 'notes') {
      notesLines.push(rawLine.replace(/\s+$/, ''));
      continue;
    }
    if (section === 'times') {
      if (!line) continue;
      const [label, ...rest] = line.replace(/^[-*•]\s*/, '').split(':');
      const value = parseDuration(rest.join(':'));
      const match = TIME_KEYS.find(t => t.re.test(label.trim()));
      if (match && value) times[match.key] = value;
      continue;
    }
    if (section === 'infos') {
      if (!line) continue;
      const [label, ...rest] = line.replace(/^[-*•]\s*/, '').split(':');
      const value = rest.join(':').trim();
      const match = INFO_KEYS.find(t => t.re.test(label.trim()));
      if (!match || !value) {
        // Ligne non reconnue : on la remonte plutôt que de la perdre en silence.
        if (line) unknownInfos.push(line);
        continue;
      }
      // "Personnes: 6" ne garde que le nombre ; "Moule: 24 cm" reste du texte.
      infos[match.key] = match.key === 'servings' ? (value.match(/\d+/)?.[0] || '') : value;
    }
  }

  const description = normalizeUnitsInText((meta.description || descLines.join(' ')).trim());
  const servings = String(meta.servings || '').trim() || infos.servings || findServings(body);

  // Le titre seul ne suffit pas : sans ingrédients ni étapes, l'extraction a raté.
  const confidence = (ingredientsRaw.length && stepsRaw.length) ? 'high' : 'low';

  return {
    title,
    description,
    servings,
    prep_time: parseDuration(meta.prep_time) ?? times.prep_time ?? findDuration(body, ['pr[ée]paration', 'prep']),
    cook_time: parseDuration(meta.cook_time) ?? times.cook_time ?? findDuration(body, ['cuisson', 'cook']),
    rest_time: parseDuration(meta.rest_time) ?? times.rest_time ?? findDuration(body, ['repos', 'r[ée]frig[ée]ration', 'rest']),
    mold: (meta.mold || infos.mold || '').trim(),
    unknown_infos: unknownInfos,
    categories: normalizeCategories(meta.categories != null ? meta.categories : meta.category, null),
    source_url: (meta.source_url || '').trim(),
    ingredients: ingredientsRaw.map(parseAmountUnit),
    steps: stepsRaw.filter(Boolean).map(normalizeUnitsInText).map(splitStepDuration),
    notes: normalizeUnitsInText(notesLines.join('\n').trim()),
    confidence,
  };
}
