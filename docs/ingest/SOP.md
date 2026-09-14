# SOP: ingesting a client's data

The runbook an ACMR developer follows on a client project, from files arriving to a graph
agents can query.

Target: **half a day of developer time** for a typical engagement of two to four sources
and a few hundred columns. Most of that is steps 1 and 5. If a dataset is taking materially
longer, that is a finding, so record it.

Read `PIPELINE.md` and `MAPPING.md` first. This document assumes both.

---

## Step 0. Intake, before any data arrives

Do this in the discovery call.

- [ ] **List the sources.** System name, who owns it, export format, refresh expectation
      (one-off migration, or continuing sync).
- [ ] **Write the question list.** Fifteen to twenty questions the client actually asks
      today. "Which customers have not ordered in 90 days." "What is outstanding on the
      Ballyvourney site." "Which jobs slipped past their promised date last month."
- [ ] **Ask who to ask.** Name the person who can explain a coded column. There will be one.
- [ ] **Agree source precedence.** When the CRM and the accounts package disagree about an
      address, which wins? Record it now, because deciding it during publish means deciding
      it under time pressure.
- [ ] **Confirm what may not leave their tenancy**, if anything.

The question list is the acceptance test in step 7. Without it there is no definition of
done, and the engagement ends when somebody gets tired rather than when it works.

**Artifact:** `apps/<client>/extensions/intake.md`.

---

## Step 1. Land and shred

```bash
ingest connect --source crm --config sources/crm.yaml
ingest shred   --batch <batch-id>
```

Read the shred report. Check three things:

- Row counts match what the client said they exported. A mismatch here is usually a
  truncated export, and finding it now saves everything downstream.
- Every file produced at least one staging table. A file that shredded to nothing is a
  format the shredder did not handle, so say so rather than proceeding without it.
- Hints were donated where you would expect them. A SQL dump with no `foreign_key` hints
  means the export dropped constraints, which changes how much work step 4 is.

**Stop and escalate if:** a source will not shred, or row counts are off by more than a
rounding error. Do not proceed with partial data and plan to fix it later.

---

## Step 2. Profile

```bash
ingest profile --batch <batch-id>
```

Read the profile report and pull out the **client question list**: every low-cardinality
coded column the recognisers could not explain.

```
UNEXPLAINED CODED COLUMNS
  stg_jobs.status_code       7 distinct values: 1,2,3,5,7,8,9
  stg_jobs.pri               4 distinct values: A,B,C,U
  stg_accounts.cat           3 distinct values: T,W,X
```

Send that list to the named person from step 0. **These become questions, never guesses.**
A model can invent a plausible meaning for `status_code = 7` and be wrong in a way nobody
catches until an agent tells a customer something untrue.

**Artifact:** the answers, written into `apps/<client>/extensions/intake.md` under
"coded values", which then feed the mapping as enumerations.

---

## Step 3. Map

```bash
ingest map --batch <batch-id>
```

Open the review screen. It presents a diff:

```
214 columns
  138 auto-assigned          [review sample]
   51 carried
   19 deferred
    6 rejected
    0 undisposed

  23 need a decision
   4 flagged: low margin
   2 flagged: model disagreed with the top algorithmic candidate
```

Work in this order:

1. **The flagged ones first.** Low margin and model-disagreement are where the wrong answers
   are. Everything else is more likely right than your attention is worth.
2. **The 23 decisions.** Each shows the shortlist, each layer's score, sample values and the
   model's reasoning.
3. **Sample the auto-assigned.** Spot-check ten. If any is wrong, stop and raise it, because
   an auto-assignment being wrong means the thresholds are wrong for this dataset shape, and
   that is worth more than fixing one column.
4. **Read the rejected list in full.** It is short, and a wrongly rejected column is the one
   failure mode this review cannot catch later.

**Never approve in bulk without reading the rejected list.** Everything else is recoverable
by re-projection.

**Artifact:** `apps/<client>/extensions/mapping.yaml`, committed.

---

## Step 4. Link

```bash
ingest link --batch <batch-id>
```

Review proposed relationships. Each carries its method and evidence:

```
works_at   contacts.account_no -> customers.account_no
           inclusion_dependency  containment 1.00  coverage 0.994  distinct 8,412  unique target
           confidence 0.98                                                    [accept] [reject]

relates_to jobs.site_ref -> sites.ref
           inclusion_dependency  containment 0.71  coverage 0.62   distinct 340
           confidence 0.44                                                    [accept] [reject]
```

The second one is the shape to be suspicious of. Low containment with low coverage usually
means the columns share a domain without one referencing the other, or that the export is
missing rows. **Reject it and ask the client rather than accepting it at low confidence.**

Check the direction of every one-to-many. A reversed predicate passes every statistical test
and reads backwards to an agent forever.

---

## Step 5. Resolve

```bash
ingest resolve --batch <batch-id>
```

This is the step that most affects the finished graph and the step where a mistake is
hardest to see afterwards. Give it the time.

The review queue holds the middle band only, model pre-triaged, ordered by salience so the
records that matter most are decided first.

For each pair, look at the **evidence against** before the evidence for:

- Different non-null VAT or CRO numbers means no merge, regardless of the score. The veto
  should have caught it, so if you are seeing it, raise it.
- Same name, different county, no shared identifier is usually two real businesses.
- Same name, one has a suffix (`Ltd`, `Group`, `Holdings`) is usually one business, and
  occasionally a parent and a subsidiary that must stay separate.

When unsure, **do not merge**. A duplicate is visible and someone will report it. A bad merge
is silent, it lands in every metric, and the client will not find it.

Check the reported merge rate against the previous batch before moving on.

---

## Step 6. Publish, dry run

```bash
ingest publish --batch <batch-id> --dry-run
```

Read the generated migration as a diff, in the client's own app, before it is applied. This
is real DDL going into `apps/<client>/extensions/migrations/`, and it is reviewed like any
other migration.

Check:

- [ ] Table and column names read as English a client would recognise
- [ ] Every table has `pulse_bind_typed_table()` and `pulse_secure_table()`
- [ ] Every table and column has a `comment on` that an agent can read, because those
      become the GraphQL descriptions
- [ ] Types are what the profile evidence says, especially dates and money
- [ ] The verification report passes every check

Then apply:

```bash
npm run db:sync && supabase db push
ingest publish --batch <batch-id>
```

---

## Step 7. Acceptance

Take the question list from step 0. Answer every question as **one GraphQL query**.

```
Q3  "Which customers have not ordered in 90 days"    PASS   1 query
Q7  "What is outstanding on the Ballyvourney site"   PASS   1 query
Q11 "Which jobs slipped past promised date"          FAIL   needs raw SQL against staging
```

A question that needs raw SQL against staging means the **entity grain is wrong**. Go back
to step 3 and fix the mapping. The grain is a modelling decision, so patching it inside a
query only hides it until the next question.

A technically correct graph can be useless. If every row became an entity, there are 400,000
`order_line` nodes, no `customer`, and no agent can answer anything. This step is the only
one that catches that.

The passing queries become the agents' first tool set, so nothing here is wasted.

**Sign-off:** every question answered in one query, verification green, coverage report
filed.

---

## Step 8. Feed the flywheel

```bash
ingest promote --batch <batch-id>
```

- Approved mapping joins the gold corpus for `ingest-eval`
- Approved column mappings join `ingest.reference_columns` as k-min sketches, so client
  N+1 is easier than client N
- Every correction made in steps 3, 4 and 5 is recorded as a labelled row, and corrections
  are the highest-value rows in the corpus because they are exactly what the mapper got wrong
- Any recogniser you had to add is contributed back to the shared library, versioned

Skipping this step is how the tool stays as hard to use on client twenty as it was on client
one.

---

## Ongoing batches

After the first publish, a new export from the same source runs steps 1, 2, 6 and 7
automatically against the approved mapping.

Steps 3 to 5 re-run only when the profile diff shows something new:

| Trigger | Lands as |
|---|---|
| A column that was not there before | mapping proposal in the action inbox |
| A value distribution that moved beyond threshold | review task, with the before and after |
| An enumeration that gained a member | question for the client |
| Coverage or a reconciliation check failing | blocked publish, raised immediately |

**Nothing auto-applies.** A schema that changes itself in production is how the graph stops
meaning what the client was told it means.

---

## Escalation

Stop and raise rather than working around:

| Situation | Why it is not a workaround |
|---|---|
| Row counts do not reconcile | Something upstream is truncating, and every later number inherits it |
| An auto-assigned mapping was wrong | The thresholds are wrong for this dataset shape, which affects the other 137 |
| Merge rate moved sharply between batches | The source changed, and finding out how matters more than this batch |
| A coded column nobody can explain | Guessing puts a fiction into the graph that an agent will repeat |
| A question from step 0 cannot be answered in one query after two mapping passes | The ontology is missing something, and the fix belongs in a pack |

The last row is worth restating. If two clients in a row need the same missing thing, it
belongs in an ontology pack, never copied into a second client's mapping.
