# Mapping

How a profiled staging column becomes an ontology field, how relationships are found, how
records from different sources become one record, and what the mapping file looks like.

`PIPELINE.md` covers the stages around this. This document is stages 3, 4 and 5.

---

## 1. The target

Mapping is **matching onto a known target**, which has good deterministic methods, rather
than **inducing an ontology from nothing**, which does not and produces something no second
client can reuse.

```
tools/ingest/ontology/
  core.yaml            person, organisation, location, document, interaction,
                       agreement, transaction, asset, work_item
  packs/wholesale.yaml
  packs/trades.yaml
  packs/practice.yaml
```

The core pack covers roughly 70% of any business, because every business has people,
places, paperwork, money and work. Industry packs carry the last 30%. Anything that matches
nothing becomes a proposed new type, and a new type is created only through review.

Each field in the ontology declares a name, a description (which becomes the GraphQL
description and the model's context), a type, and the recognisers that satisfy it:

```yaml
organisation:
  labels: {singular: Organisation, plural: Organisations}
  fields:
    name:        {type: text, required: true, description: "Registered or trading name."}
    vat_number:  {type: text, recognisers: [vat_ie, vat_uk, vat_eu]}
    cro_number:  {type: text, recognisers: [cro_ie]}
    founded_on:  {type: date}
  predicates:
    - {name: works_at, inverse_of: employs, from: person, cardinality: many-to-many}
    - {name: located_at, from: organisation, to: location, cardinality: one-to-many}
```

---

## 2. The cascade

Every layer votes on candidate assignments of `(staging column) -> (ontology field)` with a
score in `[0, 1]`. Cheap and precise layers run first.

| # | Layer | Signal | Cost | Precision alone |
|---|---|---|---|---|
| 1 | Recognisers | regex plus value distribution | zero | very high |
| 2 | Reference corpus | value overlap against every previously approved mapping | zero | high |
| 3 | Lexical | column name against field name, with synonyms and abbreviations | zero | low |
| 4 | Embedding | name plus samples plus table context, cosine against field descriptions | one cached call per column | shortlist only |
| 5 | Structure | table shape constrains what the table can be | zero | high as a constraint |
| 6 | Assignment | solve the whole table at once | zero | corrective |
| 7 | Model | adjudicates the shortlist, handles residue, writes labels | tokens per ambiguous column | needs review |
| 8 | Human | decides | minutes | final |

### Layer 1: recognisers

Deterministic detectors that fire on format and value distribution. Versioned as a library,
shared across every client, carrying no client data.

```typescript
// packages/modules/ingest/recognisers/registry.ts
{
  name: 'eircode',
  pattern: '^[ACDEFHKNPRTVWXY][0-9]{2}\\s?[0-9ACDEFHKNPRTVWXY]{4}$',
  minHitRate: 0.85,        // fraction of non-null values that must match
  semanticType: 'location.eircode',
}
```

A recogniser is a data row. The registry is loaded into `ingest.recognisers` and every
hit rate is measured by one SQL statement over all columns at once, using Postgres regex:

```sql
select column_name,
       count(*) filter (where v ~ r.pattern)::numeric / nullif(count(*), 0) as hit_rate
from staging.stg_crm_accounts, ingest.recognisers r
...
```

Starting set: `email`, `phone_ie`, `phone_uk`, `phone_e164`, `eircode`, `postcode_uk`,
`vat_ie`, `vat_uk`, `cro_ie`, `iban`, `bic`, `uuid`, `url`, `iso_date`, `dmy_date`,
`mdy_date`, `currency_eur`, `percentage`, `county_ie`, `nace_code`, `person_name`,
`org_suffix`.

When a recogniser fires above its hit rate, its score is 1.0 and the column skips layers 3
and 4 entirely. This is the cheapest and most reliable signal in the system, and it
typically resolves 20% to 35% of columns in real business data outright.

### Layer 2: the reference corpus

The asset that compounds. Every approved mapping contributes its columns:

```sql
create table ingest.reference_columns (
  id             uuid primary key default gen_random_uuid(),
  ontology_field text not null,
  sketch         bigint[] not null,     -- k smallest hashtext() values, k = 128
  name_tokens    text[] not null,
  stats          jsonb not null,        -- cardinality ratio, length profile, char classes
  approved_at    timestamptz not null default now()
);
```

The sketch is a k-minimum-values summary, built in one statement with no extension, since
Supabase carries no `hll`:

```sql
-- the 128 smallest hashes of a column's distinct values
select array_agg(h order by h) from (
  select distinct hashtext(cust_name) as h
  from staging.stg_crm_accounts
  where cust_name is not null
  order by h limit 128
) s;
```

Two sketches give a Jaccard estimate from `array_length(a & b) / array_length(a | b)` using
`intarray`-style set operators on `bigint[]`, which is fast enough to score a new column
against the whole corpus in one query. Exact containment then confirms the top few. "82% of
this column's distinct values appear in columns previously mapped to `location.county`" is a
stronger signal than any name similarity.

The same sketch prunes inclusion-dependency candidates in §3, so it is built once per
column and used twice.

Only hashes are stored, never values, so the corpus crosses client boundaries without
carrying client data. That matters given one Supabase project per client: the corpus is the
one thing that legitimately travels.

### Layer 3: lexical

Column name against field name after normalisation: lowercase, split on delimiters and
camel case, expand abbreviations (`cust`, `acct`, `dt`, `amt`, `qty`, `ref`, `no`, `desc`,
`addr`), then trigram similarity plus a synonym table.

Never decides alone. `name` matches forty things.

### Layer 4: embedding shortlist

Embed `"{table_name} / {column_name}: {top 10 sample values}"` and compare against embedded
field descriptions from the ontology. Return the top 5.

Its job is turning "match against 300 fields" into "pick from 5". Cache embeddings by
content hash.

> The embedding model version is part of the reference corpus's identity. Changing the
> model invalidates every stored sketch that used it. Pin it in `mapping.yaml` and treat a
> change as a corpus rebuild.

### Layer 5: structure

The table's shape constrains what it can be, regardless of what its columns are called.

- A table with a foreign key to an organisation, a date and an amount is a transaction.
- A table with exactly two foreign keys and nothing else is a join table, so it is a
  predicate rather than an entity.
- A table whose candidate key is also a foreign key is an extension of that entity.
- A column that a functional dependency shows is determined by another column belongs to
  the entity that determinant identifies.

Structure applies a multiplier to the whole table's candidate set rather than scoring a
single column, which is why it catches a badly named table that every other layer misreads.

### Layer 6: global assignment

Column matches are locally ambiguous and mutually constraining. Solve the table in one
step rather than as N independent decisions.

Build a cost matrix of columns against candidate fields, cost `1 - score`, then run the
Hungarian algorithm. Add constraints: a field with `cardinality: one` may take at most one
column; a field the ontology marks required must be filled if any candidate exists.

```
# ponytail: munkres-js on a table of at most a few hundred columns is milliseconds, and it
# is the one piece of the cascade that stays in the driver rather than in SQL. Greedy
# assignment with local swap repair reaches the same answer at this size if the dependency
# is unwelcome. Move to a real constraint solver only if soft constraints beyond one-to-one
# turn out to matter.
```

This is the layer most pipelines skip and it is free.

### The combination rule

```python
score = 1 - prod(1 - w[layer] * s[layer] for layer in layers)   # noisy-or
```

Then the decision, where the **margin matters as much as the threshold**:

```python
if top >= T_AUTO and (top - second) >= T_MARGIN:
    decide(auto)                    # no model call
elif shortlist:
    decide(model_adjudicates)
else:
    decide(human)                   # or dispose as 'carried'
```

A top score of 0.91 against a runner-up of 0.89 is a coin flip. Auto-assigning it is the
main source of confident wrong mappings, and the margin rule is what prevents it.
`T_AUTO` and `T_MARGIN` are calibrated in `EVALUATION.md`, never guessed.

### Layer 7: the model

Sees the profile digest, the shortlist with each layer's score and reasoning, the ontology
field descriptions for the shortlisted fields, and the rest of the table's assignments so
far. Emits a declaration.

```typescript
// packages/modules/ingest/src/adjudicate.ts
const response = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 4096,
  thinking: { type: "adaptive" },
  output_config: {
    effort: "medium",
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["field", "confidence", "reasoning", "parse"],
        properties: {
          field:      { type: ["string", "null"] },   // null means "none of these"
          confidence: { type: "number" },
          reasoning:  { type: "string" },
          parse:      { type: ["string", "null"] },   // e.g. a strptime format
        },
      },
    },
  },
  system: [
    { type: "text", text: ONTOLOGY_AND_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
  ],
  messages: [{ role: "user", content: columnDigest }],
});
```

Three things about that call:

- **The stable prefix is cached.** The ontology and instructions are identical for every
  column in a dataset, so the shared prefix is written once and read at roughly a tenth of
  the cost afterwards. Verify with `usage.cache_read_input_tokens`; if it is zero across
  repeated calls, something volatile has leaked into the prefix.
- **Structured output, so a malformed declaration is impossible** rather than merely
  unlikely.
- **Batch it.** Adjudication is not latency-sensitive, so it goes through
  `client.messages.batches.create()` at half price. Results arrive in any order, so key by
  `custom_id`.

Cost is negligible and worth stating so nobody optimises the wrong thing. A 200-column
dataset with 50 ambiguous columns is a few euro at `claude-opus-5` rates, before caching
and batch discount. **The cost of this pipeline is engineering time and review minutes.**

Note also that model tokens scale with **column count**, never row count. The same 200-column
dataset costs the same to map at 50 thousand rows or 50 million.

---

## 3. Relationship discovery

Two mechanisms, because a source boundary changes the problem completely.

### Within one source: structure

**Donated foreign keys** from `source_hints` are the best case. A SQL dump or a Dataverse
extract hands over the graph and the work drops to confirmation.

**Nesting** from JSON and XML is a stated parent-child relationship. It becomes a foreign
key with no discovery at all.

**Inclusion dependencies.** Column A references column B when A's distinct values are
contained in B's and B is unique.

```sql
-- exact confirmation, after sketch pruning
select count(*) = 0 as is_ind
from (select distinct cust_ref as v from staging.stg_orders where cust_ref is not null) a
left join (select distinct ref as v from staging.stg_customers) b using (v)
where b.v is null;
```

Inclusion holds by coincidence constantly, so four guards run before anything reaches a
model, in this order:

| Guard | Rejects |
|---|---|
| Minimum distinct cardinality on the referencing side | a four-value `status` column is "contained in" every other four-value column |
| Uniqueness on the referenced side | containment without a key is not a foreign key |
| Coverage floor on the referencing side | a 2% match rate is coincidence wearing a key's clothes |
| Semantic type agreement | a date contained in a date proves nothing |

Only survivors are scored and shortlisted. A false edge has to pass four independent tests,
then a model, then a human.

**Functional dependencies.** This is the one that turns a dump into a graph, because a
dumped spreadsheet has no relationships for the simple reason that it is denormalised.

```sql
-- customer_ref determines customer_name if no ref maps to two names
select count(*) = 0 as is_fd
from (
  select customer_ref
  from staging.stg_orders
  group by customer_ref
  having count(distinct customer_name) > 1
) violations;
```

When `customer_ref` determines `customer_name`, `customer_email` and `customer_town`, there
is a customer entity hiding inside the orders table. Split the determinant out as its own
entity and replace the columns with an edge. Automated normalisation is where most of the
graph comes from.

```
# ponytail: pairwise FD test over columns of the same table, pruned by cardinality. O(n^2)
# in column count, which is fine to a few hundred columns. Prune with the k-min sketch and
# with min/max range overlap from the profile before running the exact test.
```

**Weak signals** rank candidates and never assert. Column name similarity, value-domain
Jaccard, embedding proximity of headers.

### Across sources: entity resolution

A CRM export and an accounting export share no keys. Every cross-source edge in the finished
graph descends from recognising that `Kilbride Group` and `KILBRIDE GROUP LIMITED` are one
organisation. Resolution is therefore the load-bearing component of the whole pipeline.

Postgres carries everything this needs: `pg_trgm` for blocking and trigram similarity,
`fuzzystrmatch` for `levenshtein` and `dmetaphone`, `unaccent` and `citext` for
normalisation. Four steps, all SQL.

**1. Normalise once, into a materialised comparison table.** Lowercase, unaccent, strip
company suffixes into a separate column, reduce phones to their last 7 digits, reduce
Eircodes to the routing key. Index it with `gin (name_norm gin_trgm_ops)`.

**2. Block.** Generate candidate pairs only where a cheap key agrees. Nothing else is ever
compared, which is what keeps this from being O(n squared).

```sql
select a.id as a_id, b.id as b_id
from ingest.rr a join ingest.rr b
  on a.id < b.id
 and a.source_id <> b.source_id
 and (a.name_norm % b.name_norm            -- pg_trgm similarity above threshold
      or a.email_domain = b.email_domain
      or a.phone_last7  = b.phone_last7
      or a.eircode_key  = b.eircode_key
      or a.vat_number   = b.vat_number);
```

**3. Score, then veto.** A weighted sum of per-field agreement, with hard identifiers able
to force the answer in both directions:

```sql
select p.a_id, p.b_id,
       0.45 * similarity(a.name_norm, b.name_norm)
     + 0.20 * (1 - least(levenshtein(a.town, b.town), 6) / 6.0)
     + 0.15 * (a.email = b.email)::int
     + 0.10 * (a.phone_last7 = b.phone_last7)::int
     + 0.10 * (dmetaphone(a.name_norm) = dmetaphone(b.name_norm))::int
       as score,
       -- the veto: different non-null hard identifiers can never be one record
       (a.vat_number is not null and b.vat_number is not null
        and a.vat_number <> b.vat_number) as vetoed
from pairs p join ingest.rr a on a.id = p.a_id join ingest.rr b on b.id = p.b_id;
```

The veto is evaluated **after** the score and overrides it completely. Negative evidence
outranks positive similarity, always. Two businesses with the same name and different VAT
numbers are two businesses, whatever the trigram says.

**4. Cluster.** Union-find over accepted pairs, as an iterative label-propagation query:
join each record to the minimum id in its component and repeat until nothing moves.
Typically three or four iterations on a business graph.

```
auto-merge   score >= T_MERGE_HIGH and not vetoed
review       T_MERGE_LOW .. T_MERGE_HIGH     -> action inbox, model pre-triaged
discard      score <  T_MERGE_LOW  or vetoed
```

Bands are **asymmetric, biased to under-merging on purpose**. A surviving duplicate is
visible and someone reports it. A bad merge is invisible, lands in every metric, and
corrupts every agent decision downstream.

One canonical record per cluster, derived from `ingest.record_aliases`. No source row is
destroyed, so un-merging is a re-projection.

```
# ponytail: fixed weights, calibrated against the gold corpus by the harness in
# EVALUATION.md. Splink would give EM-estimated match weights and a proper
# Fellegi-Sunter model, and it costs a Python runtime plus a DuckDB or Spark backend.
# Revisit only if the harness shows fixed weights are the binding constraint on merge
# precision, which is a measurement rather than an argument.
```

The merge rate is reported per batch and a large move between batches fails verification.
A jump from 3% to 30% means something changed upstream, and that should be found before it
ships rather than by a client noticing.

---

## 4. Quantification

Two separate things, both cheap, neither needing a model.

**Metrics** fall out of the profile classification in `PIPELINE.md` §6. Count of entity,
sum and average of each measure, grouped by each dimension, over each grain. Declared in
`mapping.yaml` and compiled to SQL.

**Salience**, one number per record, refreshed nightly by the existing scheduler:

```sql
-- degree from the edge table, recency from the spine, volume from activity
select r.id,
       0.5 * ln(1 + coalesce(e.degree, 0))
     + 0.3 * exp(-extract(epoch from now() - r.updated_at) / 2592000.0)
     + 0.2 * ln(1 + coalesce(a.events, 0)) as salience
from records r
left join (
  select id, count(*) as degree from (
    select from_id as id from relationships union all
    select to_id   as id from relationships
  ) both_ends group by id
) e on e.id = r.id
left join (select record_id as id, count(*) as events from audit_log group by record_id) a
  on a.id = r.id
where r.deleted_at is null;
```

One number, four consumers: agent prioritisation, node size in the ontology view, search
rank tiebreak, and inbox ordering.

```
# ponytail: degree plus recency plus volume. PageRank only if the harness shows this
# ordering is measurably wrong, which on a business graph of this shape it will not be.
```

---

## 5. The mapping file

One YAML file per client dataset, committed to `apps/<client>/extensions/`. It is the
approved artifact, the publisher's only input, and the thing a human reviews.

```yaml
version: 1
dataset: acme-crm-export
mapping_version: 3
ontology: [core@1.4, trades@0.2]
recognisers: 2026.09.1
embedding_model: <pinned id>

sources:
  - id: crm
    connector: file
    precedence: 10          # wins a field conflict against accounts
  - id: accounts
    connector: sql
    precedence: 50

entities:
  - type: ext.customer
    table: ext_customers
    from: staging.stg_crm_accounts
    natural_key: [account_no]
    title: name
    description: "Customer accounts imported from the legacy CRM."
    fields:
      account_ref:
        column: account_no
        type: text
        description: "Client-side account reference, unique per customer."
      name:
        column: cust_name
        type: text
      vat_number:
        column: vat
        type: text
        recogniser: vat_ie
        confidence: 1.0
      created_at:
        column: dt_created
        type: timestamptz
        parse: "%d/%m/%Y"          # from the profile, reviewed by a human
    carried: [legacy_code, sales_region_txt, rep_initials]
    deferred:
      - {column: notes_internal, reason: "free text, no consumer yet"}
    rejected:
      - {column: col_47, reason: "100% null across 1,284,331 rows"}
      - {column: _rowid,  reason: "export artefact, carries no business meaning"}

relationships:
  - predicate: works_at
    from: {entity: ext.contact, column: staging.stg_crm_contacts.account_no}
    to:   {entity: ext.customer, natural_key: account_no}
    cardinality: many-to-many
    method: inclusion_dependency
    evidence: {containment: 1.0, coverage: 0.994, distinct_from: 8412, target_unique: true}
    confidence: 0.98
    approved_by: <user id>

resolution:
  - entity: ext.customer
    across: [crm, accounts]
    blocking: [name_trigram, vat_number, eircode_routing]
    veto_on: [vat_number, cro_number]
    thresholds: {merge: 0.94, review: 0.62}

metrics:
  - id: ext.customer.count
    entity: ext.customer
    aggregate: count
    dimensions: [sales_region_txt, location.county]
    grain: month
    permission: "ext:customer:view"
```

### The validation rule that makes it safe

**Every profiled column appears exactly once** across `fields`, `carried`, `deferred` and
`rejected`. The publisher refuses to run otherwise. That converts "we forgot a column" from
a silent loss discovered a year later into a build failure.

`carried` is what resolves the tension between typed tables for agents and keeping
everything. A carried column stays on the record as a searchable attribute without earning a
typed field, so the bar for proper modelling can stay high at no information cost.

---

## 6. What the model is structurally prevented from doing

- It never writes a row. It writes a proposal into `ingest.mapping_proposals`.
- It never sees a value it should not: the digest carries sample values, so a column the
  recognisers flag as sensitive is digested as format and cardinality only.
- It never chooses the threshold that decides whether its own answer is used.
- It is absent from the publish path, proven by an import-graph test.

A hallucinated mapping is a bad proposal caught in review. There is no path from it to
silent data corruption.
