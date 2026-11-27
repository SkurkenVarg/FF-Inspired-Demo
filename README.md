# RPG Demo Starter

Grid-based movement prototype. Everything tunable lives in `data/`.

- `data/config.json` – movement speed, turn delay, encounter rate, text speed, debug overlay
- `data/tiles.json` – one entry per map character: name, color, solid, encounter, image
- `data/maps/*.json` – tile rows, NPCs, chests, warps (add a file, then point a warp at it)
- `assets/` – drop PNGs here, then reference them in the JSON (e.g. `"image": "assets/tiles/grass.png"`)

Player sprite sheet: 16x16 frames, columns = stand, walk A, walk B; rows = down, left, right, up.
Set `"sprite": "assets/sprites/player.png"` in config.json. NPCs use the same layout via their `"sprite"` field.

Try values live without editing files: `index.html?stepFrames=10&turnDelayFrames=0`
Controls: arrows/WASD + Z (or the on-screen pad + A). Backtick toggles the debug overlay.

Run locally: `python3 -m http.server`, then open http://localhost:8000. On GitHub Pages it just works.
