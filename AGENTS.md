# AGENTS.md

Read this before touching anything.

## What this repo is

A demo template. One file, `Pulse v4 Glass.dc.html`, holding a complete
operations dashboard: home with an agent chat, an action inbox, work queues,
approvals, directories, a universal record page, dashboards, automations,
system health, modules, notifications and settings.

It ships populated with a fixture business (Kilbride Group, a plumbing and
heating merchant in Cork). The job is to replace that fixture with a real
client's world so the demo reads as though it was built for them.

There is no `Pulse/` source tree in this repo, no build step and no package
manager. The `.dc.html` file is the deliverable.

## The one rule

**Change the data. Do not change the design.**

The layout, the styling, the component structure, the page set and the
navigation are signed off. A customisation pass repopulates them. If a change
would move, resize, add or remove a UI element, it is out of scope — say so
rather than doing it.

## File layout

`Pulse v4 Glass.dc.html` is in three regions, marked by banner comments:

1. **ENGINE PRELUDE** — colour aliases and the icon set. Declared first because
   the data refers to them. Do not edit.
2. **EDIT ZONE** — `CONFIG`, the cast, and every list the demo renders. This is
   the whole customisation surface.
3. **ENGINE WALL** — graph maths, layout, state, event plumbing, the render
   pass. No business strings live below it, and none should be added.

`support.js` is a generated runtime. Never edit it.
`AgentFace.dc.html` is the agent avatar, driven by shape and tint props. It is
already business-neutral; leave it.

## Working in the edit zone

- Every block has a comment above it naming the screen it feeds and the number
  of entries it must have. **Keep the counts.** They are asserted by
  `tools/counts.js` because the layouts are built around them.
- **Keep the shape of every object** — same keys, same value types. Change what
  is inside the quotes.
- Blocks marked `[STRUCTURE]` drive routing, filters and permissions. Rename
  their labels if the client's vocabulary differs; do not add or remove
  entries.
- Strings like `core:approval:decide` and `core.automation.failed` are engine
  permission and event names. They are not business language. Leave them.
- Set `CONFIG` first, then the cast (`ORGS`, `TEAMS`, `LOCATIONS`, `CONTACTS`),
  then work down. Later blocks refer back to those names by hand, including by
  initials, so settle them before you write anything else.

## Product conventions the demo must keep expressing

These are the ideas the demo exists to sell. Rewriting copy must not
contradict them.

- **The agent proposes, it does not execute.** Anything with a write or
  external effect waits for an explicit confirmation. Never write copy in which
  the agent has already sent, posted or paid something on its own.
- **The action inbox answers three questions per item**: what happened, why it
  matters, what I can do about it. Keep all three.
- **Decisions are written as the person who made them.** Approvals, edits and
  write-offs carry a named human, not the system.
- **Modules contribute, core does not know about them.** Anything from the
  site-visits module is labelled as the module's. Keep that labelling.

## Writing the copy

- Plain and specific. The way an owner talks, not the way a brochure reads.
- No exclamation marks.
- No "seamless", "elevate", "unleash", "revolutionise", "next-gen".
- Untidy numbers: 41,207 not 40,000; 68% not 70%.
- Numbers must agree across screens. If an account owes 28,410, the invoice,
  the overdue total and the chase task all say so.
- Keep something broken: one integration disconnected, one workflow failing,
  one account on stop, one task overdue. The demo is about handling problems.

## Before saying it is done

Run the checks and report what they said:

```bash
./verify.sh
```

- syntax parses
- all twelve pages render
- every `{{ binding }}` in the markup resolves
- all fifty-two counted lists are the right length
- every block you edited actually reaches a screen
- no name from the shipped fixture survives

If a check fails, fix it and run again. Do not report completion on a failing
check — say which one is failing and why.

## Blocks marked `[NOT CURRENTLY RENDERED]`

One block, `REVENUE_SPLIT`, feeds a second dashboard view that never got
markup. Skip it — do not spend effort writing copy for a screen nobody can
open, and do not build the view, because that is a layout change.

## When something does not fit

Do not invent a workaround below the wall. Either:

1. Add the field to the data model in the edit zone and wire it, or
2. Stop and say what the brief needs that the template cannot express.
