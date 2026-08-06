#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Every level's clock, against the one the ROM's own header asks for.
//
//   node tools/check-times.mjs
//
// The timer is DATA, not a convention. GetAreaDataAddrs (smbdis.asm:4415-4423)
// takes the top two bits of an area's first header byte and indexes
// GameTimerData (asm:2828-2831) = dummy, $04, $03, $02 -> 400, 300, 200. Our
// generators used to guess it from the level TYPE instead — castles are 300,
// everything else 400 — and that guess was wrong ten times in both directions.
// Three castles ran TIGHTER than the original, including 8-4, the hardest level
// in the game, which was giving 100 seconds less than it should.
//
// WHAT THIS ENFORCES, and what it deliberately does not:
//
//   FAIL   a level tighter than the original. That is the direction that can
//          make a level unbeatable, and nobody chose it — it is always drift.
//   ALLOW  a level more generous than the original, but name it. Seven ship
//          that way by an explicit decision (see below); tightening them would
//          make the game harder in seven places nobody complained about.
//
// So this is not a fidelity check, it is a FAIRNESS check with a fidelity
// report attached. If you want the seven corrected too, that is a gameplay
// decision, not a bug fix, and it belongs in the generators.
//
// reference/ is ROM-derived and gitignored, so on a fresh clone there is
// nothing to check against: this reports that and exits 0 rather than failing
// a build for a file it was never going to have.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF_PATH = join(ROOT, 'reference', 'smb-areas.json');

// GameTimerData (asm:2828-2831). Index 0 is the dummy byte the disassembly
// shares with PlayerBGPriorityData and is never a real setting.
const GAME_TIMER = [null, 400, 300, 200];

// Levels shipping MORE time than the original, by decision rather than by
// accident. Recorded here so the report can tell a choice from a regression —
// an unexplained mismatch is the thing worth looking at.
const DELIBERATELY_GENEROUS = new Set(['1-3', '2-3', '3-2', '5-1', '7-3', '8-1', '8-3']);

if (!existsSync(REF_PATH)) {
  console.log('reference/smb-areas.json is absent (it is gitignored and ROM-derived).');
  console.log('Run `node tools/smb-ref.mjs` to fetch it. Nothing checked.');
  process.exit(0);
}

const REF = JSON.parse(readFileSync(REF_PATH, 'utf8'));

const rows = [];
for (const [id, entry] of Object.entries(REF.levelMap)) {
  if (id.endsWith('-sub')) continue;
  const area = REF.areas[entry.area];
  if (!area || !Array.isArray(area.header)) continue;
  const file = join(ROOT, 'src', 'data', 'levels', `${id}.js`);
  if (!existsSync(file)) continue;
  const m = readFileSync(file, 'utf8').match(/^\s*time:\s*(\d+)/m);
  if (!m) continue;
  const rom = GAME_TIMER[(area.header[0] & 0xc0) >> 6];
  if (!rom) continue;
  rows.push({ id, area: entry.area, rom, ours: Number(m[1]) });
}

rows.sort((a, b) => a.id.localeCompare(b.id));

const tighter = rows.filter((r) => r.ours < r.rom);
const generous = rows.filter((r) => r.ours > r.rom);
const undeclared = generous.filter((r) => !DELIBERATELY_GENEROUS.has(r.id));
const stale = [...DELIBERATELY_GENEROUS].filter((id) => !generous.some((r) => r.id === id));

for (const r of tighter) {
  console.error(
    `TIGHTER  ${r.id.padEnd(5)} ${r.area.padEnd(14)} ours ${r.ours} < ROM ${r.rom}` +
      '   <-- less time than the original'
  );
}
for (const r of generous) {
  const tag = DELIBERATELY_GENEROUS.has(r.id) ? 'by decision' : 'NOT DECLARED';
  console.log(`generous ${r.id.padEnd(5)} ${r.area.padEnd(14)} ours ${r.ours} > ROM ${r.rom}   (${tag})`);
}
for (const id of stale) {
  console.error(`STALE    ${id} is listed as deliberately generous but now matches the ROM.`);
}

console.log(
  `\n${rows.length} levels checked — ${rows.length - tighter.length - generous.length} exact, ` +
    `${generous.length} generous, ${tighter.length} tighter.`
);

if (tighter.length || undeclared.length || stale.length) {
  if (tighter.length) console.error(`\n${tighter.length} level(s) give LESS time than the original.`);
  if (undeclared.length) {
    console.error(
      `${undeclared.length} level(s) are more generous without being declared — ` +
        'add them to DELIBERATELY_GENEROUS with a reason, or fix the generator.'
    );
  }
  process.exit(1);
}

console.log('No level is tighter than the original.');
