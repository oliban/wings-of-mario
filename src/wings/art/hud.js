import { makeSprite } from '../../core/gfx.js';

// The instrument panel. Period carrier games put the pilot behind a piece of
// painted steel, not behind a translucent web overlay, so the strip across the
// top of the screen is a riveted plate with bezelled gauges cut into it.
export const HUD_PAL = [
  '#04060b', // 0 outline / panel edge
  '#111826', // 1 panel shadow
  '#1c2637', // 2 panel face
  '#2c3a52', // 3 bezel
  '#48597a', // 4 bezel highlight
  '#9fb8e0', // 5 engraved label
  '#3fc466', // 6 gauge full
  '#c9412e', // 7 gauge empty
  '#e0aa3e', // 8 gauge caution
];

// One tile of the panel, repeated across the width of the screen. The rivets
// sit on a 16px pitch, which is why the plate is tiled rather than filled.
export const HUD_PLATE = makeSprite(
  [
    '4444444444444444',
    '3333333333333333',
    '2222222222222222',
    '2242222222422222',
    '2212222222122222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2222222222222222',
    '2242222222422222',
    '2212222222122222',
    '2222222222222222',
    '1111111111111111',
    '0000000000000000',
  ],
  HUD_PAL,
  { name: 'wings.hud.plate' }
);

// The fuel gauge bezel. The well is transparent so the needle bar painted
// underneath shows through the cut-out instead of sitting on top of it.
const WELL = '.'.repeat(62);
export const FUEL_BEZEL = makeSprite(
  [
    '0'.repeat(66),
    '0' + '4'.repeat(64) + '0',
    '04' + WELL + '40',
    '04' + WELL + '40',
    '04' + WELL + '40',
    '04' + WELL + '40',
    '04' + WELL + '40',
    '04' + WELL + '40',
    '0' + '1'.repeat(64) + '0',
    '0'.repeat(66),
  ],
  HUD_PAL,
  { name: 'wings.hud.fuelbezel' }
);

// One aircraft remaining in the squadron, drawn as a plan-view silhouette.
export const SQUADRON_PIP = makeSprite(
  [
    '...5...',
    '...5...',
    '5555555',
    '..555..',
    '...5...',
  ],
  HUD_PAL,
  { name: 'wings.hud.pip' }
);

// The hook indicator: a stubby arrestor hook that visibly drops when the pilot
// selects it, so the HUD says the same thing the aircraft does.
export const HOOK_PIP_UP = makeSprite(
  ['55555..', '...55..', '...55..', '.......', '.......'],
  HUD_PAL,
  { name: 'wings.hud.hookup' }
);

export const HOOK_PIP_DOWN = makeSprite(
  ['55555..', '...55..', '...55..', '...555.', '.....55'],
  HUD_PAL,
  { name: 'wings.hud.hookdown' }
);
