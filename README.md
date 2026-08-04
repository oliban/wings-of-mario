# Super Mario — an original homage

A from-scratch Super Mario Bros. homage that runs in the browser with **no build step and no
dependencies**. Every sprite, tile and piece of music is authored from scratch as code in this
repo — there are no image files and no audio files, and no Nintendo ROM data is reproduced.

Faithful silhouettes and physics. Original pixels and melodies.

## Run it

```bash
npm start           # serves on http://127.0.0.1:8123
```

Any static file server works; the game is plain ES modules loaded natively by the browser.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` | Move |
| `Z` / `Space` / `↑` | Jump — hold longer to jump higher |
| `X` / `Shift` | Run, and throw fireballs as Fire Mario |
| `↓` | Duck (big Mario), enter pipes |
| `Enter` | Pause |
| `F` | Cycle video filter: `pure` → `crisp` → `crt` |

Gamepads are supported.

## The physics is the real thing

Movement uses Super Mario Bros.'s actual constants at its actual frame rate (60.0988 Hz), with
positions and velocities in **pixels per frame** rather than per second. `tools/probe.mjs` drives
the game headlessly and measures it:

```
maxWalkSpeed    1.5625      maxRunSpeed   2.5625
terminalVy      4.5  (reached in 11 frames)
standing jump   4.125 tiles
running jump    5.125 tiles
```

The jump is speed-dependent, exactly as the original: above `2.3125` px/frame the takeoff velocity
changes from `-4.0` to `-5.0` **and** hold-gravity weakens, which is why a running jump goes
genuinely higher rather than merely further. Jumps integrate as explicit Euler — the takeoff frame
travels a full `vy0` before gravity applies — which is worth exactly 4px of height and is the
difference between clearing a pipe and clipping its lip.

## Layout

```
src/core/      sprite baking, fixed-timestep loop, input, deterministic RNG
src/data/      all pixel art (sprites, tiles, scenery, font) and level data
src/game/      physics, player state machine, collision, world, 28 entity types
src/render/    256x240 framebuffer + WebGL2 post chain (bloom, scanlines, CRT curvature)
src/audio/     an APU-style synth: 2 pulse + triangle + noise, and an original score
src/ui/        HUD, title, pause, options, level-complete tally
tools/         the verification harness
```

## Tools

The interesting part of this repo is that it can look at itself.

```bash
node tools/validate.mjs                       # import every module, report what breaks and why
node tools/probe.mjs                          # measure physics against the SMB reference table
node tools/sheet.mjs src/data/tiles.js        # render any art module to a labelled contact sheet
node tools/shot.mjs --scenes tools/scenes.json  # capture gameplay scenes deterministically
```

`validate.mjs` exists because `world.js` deliberately imports its dependencies through a
`try`/`catch` so one broken module degrades a single feature instead of blanking the screen. That
is right for players and terrible for debugging — a single ragged sprite row once silently deleted
Mario from the game. `validate.mjs` removes the safety net and names the culprit.

## Tests

```bash
npm run test:unit     # pure logic, no browser, about a second
npm run test:browser  # drives the real game in headless Chromium
npm test              # both
```

Use `test:unit` while working. The browser suite is the expensive one: every test file starts a
headless Chromium, so it takes a **machine-wide lock** and runs one browser at a time even across
separate `npm test` invocations — a second run waits for the first rather than competing with it.
A run that finds a static server already on port 8199 reuses it instead of starting another, and
leaves it running afterwards.

If a run is killed and something seems stuck, `pkill -f "node --test"` clears it; the browsers are
children and go with it. The lock records its holder's PID, so the next run reclaims it
automatically once that process is gone.

## Architecture

`ARCHITECTURE.md` is the binding contract: coordinate system and units, the sprite and animation
format, the entity interface, the world API, render layers, the level format and its tile legend,
and the debug API that the screenshot harness drives.
