// Build the DDZ hit-banner preview page from scripts/fx-lab.src.html.
//
// Two outputs, because the page has two homes with different constraints:
//
//   link   public/fx-lab.html  — references sounds/tier-N.wav relatively, so it
//                                works opened straight off disk, served by the
//                                dev server at /fx-lab.html, and deployed. Stays
//                                in sync with the sound files automatically.
//   embed  <path>              — inlines every stinger as a data URI, for hosts
//                                that block external requests (the Artifact CSP).
//
// Usage:
//   node scripts/build-fx-lab.mjs                       # link -> public/fx-lab.html
//   node scripts/build-fx-lab.mjs --embed out.html      # both
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE    = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(HERE, '..');
const SRC     = join(HERE, 'fx-lab.src.html');
const SOUNDS  = join(ROOT, 'public', 'sounds');
const LINK_OUT = join(ROOT, 'public', 'fx-lab.html');

const embedIdx = process.argv.indexOf('--embed');
const EMBED_OUT = embedIdx > -1 ? process.argv[embedIdx + 1] : null;

const MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
const MARKER = '/*__AUDIO__*/ {}';

/**
 * Audio for a level, in preference order. Supplied music tracks win over the
 * generated stingers, and both `tier6.mp3` and `tier-6.mp3` spellings are
 * accepted so dropping a file in never needs a code change.
 */
const CANDIDATES = {
  1: ['tier-1.wav'],
  2: ['tier-2.wav'],
  3: ['tier-3.wav'],
  4: ['tier-4.wav'],
  5: ['tier-5.wav'],
  6: ['tier6.mp3', 'tier-6.mp3', 'tier-6.wav'],
  7: ['tier7.mp3', 'tier-7.mp3', 'tier-7-rocket.mp3', 'tier-7-rocket.wav', 'tier-7.wav'],
  comeback: ['tier-comeback.mp3', 'tier-comeback.wav'],
  friendly: ['traitor.mp3', 'tier-friendly.mp3', 'tier-friendly.wav'],
};

/**
 * Cues the page loads by name rather than by tier: the 火箭 cold open, the
 * impact that rides on top of the tier-7 track, and the table sounds the round
 * itself makes — a card hitting the felt, a deal, the win and lose stings the
 * result screen plays. Keyed bare in the audio map, where tiers are `tier-N`.
 */
const EXTRA = {
  kamida: ['kamida.mp3'],
  godhand: ['god_hand_impact.mp3'],
  heavencue: ['made_in_heaven.mp3'],
  heaventrack: ['crucified_full.mp3'],
  kyoka: ['kyoka.mp3'],
  voissur: ['vois_sur.mp3'],
  saikyo: ['saikyo.mp3'],
  cardplay: ['card-play.wav'],
  deal: ['deal.wav'],
  win: ['win.wav'],
  lose: ['lose.wav'],
};

/** Levels whose audio is a full music track, not a stinger. */
const MUSIC_LEVELS = new Set(['6', '7', 'comeback', 'friendly']);

function pick(level, table = CANDIDATES) {
  for (const name of table[level] ?? []) {
    if (existsSync(join(SOUNDS, name))) return name;
  }
  return null;
}

const src = readFileSync(SRC, 'utf8');
if (!src.includes(MARKER)) throw new Error(`audio marker not found in ${SRC}`);

const files = [];
for (const level of Object.keys(CANDIDATES)) {
  const name = pick(level);
  if (!name) { console.warn(`  tier-${level}  MISSING`); continue; }
  files.push([`tier-${level}`, name]);
}
for (const cue of Object.keys(EXTRA)) {
  const name = pick(cue, EXTRA);
  if (!name) { console.warn(`  ${cue}  MISSING`); continue; }
  files.push([cue, name]);
}

const kb = (n) => (n / 1024).toFixed(0).padStart(5) + ' KB';

// ── link build ───────────────────────────────────────────────────────────────
{
  const map = {};
  for (const [key, name] of files) map[key] = `sounds/${name}`;
  writeFileSync(LINK_OUT, src.replace(MARKER, JSON.stringify(map)));
  console.log('link  public/fx-lab.html      ' + kb(statSync(LINK_OUT).size));
  for (const [key, name] of files) {
    const size = statSync(join(SOUNDS, name)).size;
    const tag = MUSIC_LEVELS.has(key.replace('tier-', '')) ? '  <- music track' : '';
    console.log(`        ${key.padEnd(13)} -> sounds/${name.padEnd(22)}${kb(size)}${tag}`);
  }
}

// ── embed build ──────────────────────────────────────────────────────────────
if (EMBED_OUT) {
  const map = {};
  let raw = 0;
  for (const [key, name] of files) {
    const bytes = readFileSync(join(SOUNDS, name));
    raw += bytes.length;
    const ext = name.slice(name.lastIndexOf('.'));
    map[key] = `data:${MIME[ext] ?? 'audio/wav'};base64,${bytes.toString('base64')}`;
  }
  writeFileSync(EMBED_OUT, src.replace(MARKER, JSON.stringify(map)));
  const size = statSync(EMBED_OUT).size;
  console.log(`embed ${EMBED_OUT}  ${kb(size)}  (audio ${kb(raw)} raw)`);
  if (size > 15.5 * 1024 * 1024) {
    console.error('WARNING: exceeds the 16MB artifact limit');
    process.exit(1);
  }
}
