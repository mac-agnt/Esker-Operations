# Pulse demo template

A complete operations dashboard mockup, built to be re-skinned for a client in
one pass. Fill in a brief, hand it to an agent, get back something that looks
like it was built for that business.

Ships with a worked fixture: Kilbride Group, a plumbing and heating merchant in
Cork. That fixture is the thing you replace.

## Use it

1. **Create a repo from this template** on GitHub (green *Use this template*
   button), or clone it.
2. **Fill in the brief** at the top of [PROMPT.md](PROMPT.md) — the business,
   six people, six customers, three sites, seven systems, eight numbers.
3. **Paste the whole of PROMPT.md** to Claude Code in the new repo.
4. **Check it**, and fix whatever it reports:

```bash
./verify.sh
```

5. **Look at it:**

```bash
node tools/serve.js
```

Then open <http://localhost:8731>. The page pulls React from a CDN at runtime,
so it needs `http://` rather than opening the file directly.

## What's in here

| File | What it is |
|---|---|
| `Pulse v4 Glass.dc.html` | The whole app. One file. |
| `AgentFace.dc.html` | The agent avatar component. Generic; leave it alone. |
| `support.js` | Generated template runtime. Never edit. |
| `PROMPT.md` | The brief to fill in and the instructions to the agent. |
| `CLAUDE.md` | Rules the agent reads before touching anything. |
| `AGENTS.md` | The same rules under the cross-tool filename. Keep the two in step. |
| `tools/` | The checks, plus `serve.js` for looking at it and `recolour.js` for rebranding. |
| `verify.sh` | Runs all the checks. |

## How the main file is laid out

Three regions, marked with banner comments:

```
ENGINE PRELUDE     colour aliases and icons. Declared first because the data
                   below refers to them. Not business content.

EDIT ZONE          CONFIG, the cast, and every list the demo renders.
                   This is the entire customisation surface.

ENGINE WALL        graph maths, layout, state, event plumbing, the render
                   pass. Zero business strings live down here — that is
                   enforced, not just intended.
```

A customisation pass touches the edit zone and nothing else. Every block in it
carries a comment saying which screen it feeds and how many entries it needs.

Blocks marked `[STRUCTURE]` drive routing, filters and permissions rather than
copy — rename their labels if the client's vocabulary differs, but do not add
or remove entries.

## The checks

`./verify.sh` runs five passes. Each is also runnable on its own.

| Check | What it catches |
|---|---|
| `tools/check.js` | The file stopped parsing, a page stopped rendering, or a `{{ binding }}` in the markup lost its value. |
| `tools/counts.js` | A list changed length. Fifty-two lists have counts the layouts depend on; a seventh organisation breaks a grid. |
| `tools/reach.js` | A block renders nowhere — you rewrote it and it never reaches a screen. |
| `tools/consistency.js` | `CONFIG` and the data disagree. The currency is pounds but the inbox still quotes euros; the owner was renamed but the avatar still shows the old initials. |
| `tools/leftovers.js` | A name from the shipped fixture survived. This is the one that stops you standing in front of a client in Manchester whose dashboard says "Ballincollig depot". |

`tools/leftovers.js` reads its term list from `tools/fixture-terms.txt`. If you
ever re-cut this template against a different fixture, replace that list.

Node is the only requirement, any recent version. Nothing to install.

## Pages

Ten screens: Home, Agents, Dashboard, Work, Records, Activity, Settings, plus
Automations, System health and Installed modules. The last three had data but
no markup when the mockup was imported; they are built and reachable now, from
the command palette or the context nav that runs across the top of all three.

One block is still dead: `REVENUE_SPLIT` feeds `metricGroups`, a second
dashboard view that never got markup — the Dashboard renders `ASPECT_DEFS`
instead. It is marked `[NOT CURRENTLY RENDERED]` in the file and skipped by
name in `tools/reach.js`. Skip it when customising, or build the view and
delete its name from `KNOWN_UNREACHABLE`.

## Rebranding the colour

Eight palettes ship in the file. Each defines about thirty variables, but nine
of them derive from one accent colour, so you do not hand-tune thirty:

```bash
node tools/recolour.js "#2f5fd0" "#0b0c0b"
```

That prints the accent block for a navy brand on the dark background. Paste it
over the matching lines in the theme you are changing, and set the same hex on
that theme in the `THEMES` list. The hero gradient it prints is a starting
point — look at it on the Dashboard and nudge the middle stops if the hue
drifts.

The other twenty-odd variables per theme are neutral scaffolding — background,
ink, surfaces, and the ok/warn/bad states. Leave them.

## What this template is not for

It is a demo. The data is fiction and the buttons mostly do not do anything.
It exists to show a client what their operations could look like in one place,
convincingly enough to have a real conversation about building it.

Do not present generated numbers as though they came from the client's systems.
