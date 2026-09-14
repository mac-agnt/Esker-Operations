# The customisation prompt

Fill in the brief below, then paste the whole file to the agent.

Everything under **The brief** is yours to fill in. Everything under **The job**
is instructions to the agent and should be pasted unchanged.

---

## The brief

**Business**

- Name:
- What they do, in one sentence:
- Sector:
- Where they are (head office and any other sites):
- Roughly how big (staff, turnover if you know it):
- Currency and locale:
- Who the demo is for (name, job title). This is whose screen it is:

**Their people** — six names, with job titles. Four internal, two external is
the shape that fits.

1.
2.
3.
4.
5.
6.

**Their customers, clients or accounts** — six. Include one that owes money and
is a problem, and one supplier. Balances if you have them.

1.
2.
3.
4.
5.
6.

**Their sites** — three. Names and towns.

1.
2.
3.

**Systems they run** — seven. The real ones: accounting, CRM, email, messaging,
whatever is on their desks. Note any that are broken, half-connected or that
somebody complains about.

1.
2.
3.
4.
5.
6.
7.

**The numbers they care about** — eight. The ones the owner actually looks at,
not the ones a dashboard vendor would pick.

1.
2.
3.
4.
5.
6.
7.
8.

**Their business areas** — the parts of the business a manager would review
separately. Sales, operations, finance, and whatever else is real for them.

**Their vocabulary** — what do they call a customer, a job, a site, a booking?
Use their words, not generic ones.

**What goes wrong** — the recurring problems. Late payers, missed bookings,
double entry, a system that keeps dropping its connection. This is what makes a
demo land, so be specific.

**Anything to avoid** — names, competitors, sore subjects.

**Brand colour** — hex if you have it.

---

## The job

You are customising a demo dashboard. It is one file:
`Pulse v4 Glass.dc.html`. Read `CLAUDE.md` in this repo before you start.

**What you are changing:** the data. The names, companies, places, numbers,
copy and vocabulary, so the whole thing reads as though it was built for this
business.

**What you are not changing:** the layout, the styling, the component
structure, the page set, the navigation, or anything below the `ENGINE WALL`
comment. This is a working demo whose design is already signed off. You are
repopulating it, not redesigning it.

Work in this order.

1. **Read the file first.** Everything you need is between the `EDIT ZONE`
   banner and the `ENGINE WALL` banner. Read all of it before you change
   anything, so the names you pick in the first block are the ones you use in
   the last.

2. **Set `CONFIG`.** Company, owner, sector, currency, locale, timezone. The
   product name and the agent name stay as they are unless the brief says
   otherwise.

3. **Set the cast** — `ORGS`, `TEAMS`, `LOCATIONS`, `CONTACTS`. These names
   are referenced by every list further down, so settle them now and then use
   them consistently. Initials matter: `who:"AN"` in a task list has to match
   somebody in `CONTACTS`.

4. **Work down the file block by block.** Each block has a comment above it
   saying which screen it feeds and how many entries it must have. Rewrite the
   values inside; leave the keys and the counts alone.

5. **Write the action inbox last** (`ITEMS`). It is the first screen anyone
   sees and the one they read properly. Each item answers three questions:
   what happened, why it matters, what I can do about it. Make the "why"
   specific to this business — a real threshold, a real deadline, a real
   consequence.

6. **Run `./verify.sh`.** It checks that the file still parses, that every
   screen still renders, that every template binding resolves, that no list
   changed length, that every block you edited reaches a screen, and that no
   name from the shipped fixture survived. Fix anything it reports and run it
   again.

Rules while you work.

- **Keep every list the length it is.** The counts are in the comments and are
  asserted by `tools/counts.js`. Six organisations, not seven. The layouts are
  built around them.
- **Keep the shape of every object.** Same keys, same value types. Change what
  is inside the quotes.
- **Leave `[STRUCTURE]` blocks alone.** They drive routing, filters and
  permissions, not copy.
- **Skip `[NOT CURRENTLY RENDERED]` blocks.** One feeds a dashboard view that
  has no markup. Leave it as it is.
- **Leave the `core:*` and `core.*` strings alone.** Those are engine
  permission and event names, not business language.
- **Do not touch anything below the `ENGINE WALL`.** If you think you need
  something down there, the data model above is missing a field. Add it above
  and wire it, or stop and say so.
- **Make the numbers agree with each other.** If an organisation owes 28,410
  then the invoice, the overdue total and the chase task should say so too. A
  demo falls apart when someone reads two screens.
- **Make the numbers untidy.** 41,207 not 40,000. 68% not 70%.
- **Keep one thing broken.** One integration disconnected, one workflow
  failing, one account on stop, one task overdue. The demo is about handling
  problems, so it needs some.
- **No exclamation marks.** No "seamless", "elevate", "unleash",
  "revolutionise". Write the way the owner talks.

When you are done, say what you changed, what `./verify.sh` reported, and
anything in the brief you could not use.
