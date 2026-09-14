# Evaluation

How we test the mapper and drive it to the version we ship.

The principle: **build the scoreboard before the players.** Every layer in `MAPPING.md` is
added one at a time and kept only if it moves a number. Without that discipline the cascade
becomes seven layers of folklore that nobody can remove.

---

## 1. Metrics

Measured per dataset, reported as a table across the whole corpus.

| Metric | Definition | Why it matters |
|---|---|---|
| **wrong-and-confident** | auto-assigned mappings that gold says are wrong, over all auto-assignments | The corruption metric. Everything else is secondary to this |
| column F1 | precision and recall over `(column, field)` pairs against gold | Overall mapping quality |
| auto rate | fraction decided without a model call | Cost and speed |
| coverage | fraction of columns given a disposition other than `deferred` | Context retained |
| edge precision | correct edges over asserted edges | A wrong edge corrupts, so precision is weighted over recall |
| edge recall | correct edges over gold edges | A missing edge is recoverable, so this is the softer target |
| merge precision / recall | over gold cluster membership | Over-merging is the worst failure in the pipeline |
| round-trip fidelity | source cells reconstructable from the graph | Direct measurement of context loss |
| **interventions per 100 columns** | human decisions required | The commercial metric. This is what a client engagement actually costs |
| wall time, token cost | per 100 columns | Watched until it becomes a problem, then optimised |

`wrong-and-confident` and `interventions per 100 columns` are the two that decide whether
this ships. The rest diagnose why.

---

## 2. The gold corpus

```
tools/ingest/eval/gold/<dataset>/
  raw/                 the source files, unmodified
  mapping.yaml         the known-correct mapping
  edges.yaml           the known-correct relationships
  clusters.yaml        the known-correct entity resolution
  notes.md             every ambiguity found while hand-mapping, and how it was settled
```

`notes.md` matters as much as the mapping. Where a human hesitated is where the algorithm
will fail, and writing it down is how a threshold gets set for a reason instead of by feel.

### Choosing the datasets

Three to start, deliberately unlike each other, because a corpus of three similar datasets
measures nothing:

| Slot | Shape | Tests |
|---|---|---|
| **D1** | The Azure set | Whatever it actually is. First and largest |
| **D2** | A wide flat spreadsheet, one sheet, denormalised | Functional dependency detection, entity extraction from a flat table |
| **D3** | A normalised SQL export with declared foreign keys | The donated-hint path, and whether hints are trusted correctly rather than blindly |
| **D4** | Two overlapping exports of the same business from different systems | Cross-source resolution, the only thing that tests it |

D4 is the one that will be tempting to skip and must not be. It is the only dataset that
exercises the load-bearing component.

### The corpus grows by itself

Every approved client mapping becomes gold for the next run, and every human correction
during review becomes a labelled row. The corpus is a by-product of doing the work, which
is the only reason it will still exist in a year.

---

## 3. The harness

```bash
ingest-eval run   <dataset> [--layers 1,2,3]   # score one dataset, optionally with layers off
ingest-eval sweep <param> <lo> <hi> <step>     # calibration curve for one threshold
ingest-eval all                                # the full table, held-out marked separately
ingest-eval diff  <run-a> <run-b>              # what changed, per column, with reasons
```

`diff` is the one that gets used daily. A number moving is a fact; knowing which twelve
columns moved and why is what lets somebody act on it.

Every run writes to `tools/ingest/eval/runs/<timestamp>/` with the config that produced it,
so a result is reproducible six months later.

---

## 4. Phases

### Phase 0: gold, before any algorithm

Hand-map D1 to D4 end to end. Write `notes.md` honestly.

Roughly one day per dataset. Nothing before this produces a number that means anything, and
hand-mapping is also how the team learns what the algorithm actually has to do.

**Exit:** four datasets with mapping, edges and clusters, and the hand-mapping time recorded
per dataset. That time is the baseline the automation has to beat.

### Phase 1: harness and floor

Build `ingest-eval`. Then build the dumbest possible mapper: exact column-name match against
ontology field names, nothing else.

That is the floor. Every layer added afterwards has to beat it, and having a floor stops the
first real layer from being credited with the whole result.

**Exit:** `ingest-eval all` runs and prints the table for the trivial mapper.

### Phase 2: layers, one at a time

Add in cascade order, measuring after each. Expected contribution, to be checked rather than
assumed:

| Added | Expect to move |
|---|---|
| 1 recognisers | auto rate up sharply, wrong-and-confident near zero on what it decides |
| 3 lexical | recall up, precision down, wrong-and-confident up. This is the layer that needs the margin rule |
| 4 embedding shortlist | little change to F1, large drop in model-call breadth |
| 5 structure | fixes whole tables the other layers misread. Small count, large impact |
| 6 assignment | precision up, no recall cost. Free |
| 2 reference corpus | nothing on the first dataset, then rises with corpus size. Measure this on D4 with D1 to D3 in the corpus |
| 7 model | closes the residue. Interventions per 100 columns drops |

**The rule: a layer that does not move a metric is deleted.** Seeming reasonable earns it
nothing, and neither does the work it took. Delete it and record the result in `notes.md`.

Layer 2 is measured differently from the rest: it only exists once other datasets have been
approved, so it is scored by adding datasets to the corpus one at a time and watching the
curve.

**Exit:** every layer either earns its place with a number or is gone.

### Phase 3: calibration

Sweep the parameters. There are about fifteen:

```
T_AUTO           auto-assign threshold
T_MARGIN         required gap over the runner-up
w[1..7]          per-layer weights in the noisy-or
IND_MIN_DISTINCT minimum distinct values for an inclusion dependency
IND_MIN_COVERAGE minimum match rate on the referencing side
FD_MIN_SUPPORT   minimum rows for a functional dependency to count
T_MERGE_HIGH     auto-merge score
T_MERGE_LOW      discard score
```

Grid search on the corpus, with **one dataset held out and never tuned on**. The held-out
number is the only honest one, and it is the one reported.

The output that matters is the calibration curve rather than a single tuned number:

```
T_AUTO   auto rate   wrong-and-confident   interventions/100
0.75        84%             4.1%                 11
0.85        71%             1.2%                 19
0.90        63%             0.4%                 26
0.95        48%             0.1%                 38
```

Pick the operating point deliberately, write down why, and put it in the config with a
comment. A threshold nobody can explain is a threshold nobody can defend to a client.

**Exit:** parameters set from the curve, held-out numbers recorded, operating point
justified in writing.

### Phase 4: adversarial

Deliberately nasty inputs, each becoming a permanent regression case:

- two columns with the same name in one sheet
- a column that is 94% null
- a column whose type changes halfway down (dates, then free text)
- four date formats in one column
- a spreadsheet with two unrelated tables on one sheet
- non-English column headers
- a column whose meaning changes mid-file (`notes` becomes `next_action` from row 40,000)
- an export where the header row is row 7
- a numeric column stored with thousands separators and a trailing minus
- two customers with identical names and different VAT numbers, which must never merge
- the same customer with a typo in the VAT number, which must not auto-merge either

The last two are the resolution guards, and they are the cases where a wrong answer is most
expensive.

**Exit:** every case has an expected outcome recorded, and the suite runs in CI.

### Phase 5: pilot with the escape hatch

First real client. The developer reviews everything, and **every correction is captured as a
gold row**. Nothing runs unattended.

Watch two numbers across the engagement: interventions per 100 columns, and whether any
`wrong-and-confident` case reached publish. The second must be zero.

**Ship when:**

| Metric | Target on held-out data |
|---|---|
| wrong-and-confident | under 1% |
| column F1 | at least 0.90 |
| interventions per 100 columns | at most 15 |
| round-trip fidelity | at least 99% |
| edge precision | at least 0.95 |
| merge precision | at least 0.98 |

Those are targets to argue with once there are real numbers, and they are written down now
so that the argument happens against a stated bar rather than against a feeling.

---

## 5. Guiding it after it ships

The corpus grows with every client, so re-run `ingest-eval all` on every change to the
recogniser library, the ontology, a prompt, or a weight. A change that improves the average
while regressing one dataset gets inspected before it is accepted.

Two things to watch for over time:

**Corpus contamination.** Once a client's approved mapping is gold, the mapper that produced
it is being scored partly on its own output. Mark gold rows that a human corrected, and
report accuracy on corrected rows separately, because those are the ones the mapper got
wrong.

**Held-out rotation.** Rotating which dataset is held out over time leaks it into the tuned
set. Keep one dataset permanently held out and add new ones to the tuning pool instead.

### The one upgrade path worth naming

If hand-tuned weights plateau, replace the noisy-or with a **logistic regression over the
layer scores**, fitted on gold column-mappings.

```
# ponytail: fit it OFFLINE, once, in whatever tool suits, and paste the coefficients into
# the weights config. About 15 features, fully interpretable, and the coefficients drop
# straight into the noisy-or as weights. Nothing new ships at runtime. This is the only
# machine learning in the design, and it needs a few hundred gold mappings, so it is
# unavailable until client three.
```

Everything else stays rules, statistics and one adjudicating model call. If a proposal
arrives to train a model on client data, the questions are: which metric does it move, on
the held-out set, against the logistic-regression baseline. Nothing has earned it yet.
