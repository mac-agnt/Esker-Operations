# The Ingest Pipeline

Stages, storage layout, bookkeeping schema, and the rules each stage obeys.
The mapping algorithm itself is in `MAPPING.md`.

---

## 1. The stages

```
  0 CONNECT    move bytes or rows to the landing zone            no model
  1 SHRED      parse one format into staging tables + hints      no model
  2 PROFILE    per-column statistics and semantic types          no model
  3 MAP        propose entity and field declarations             model
  4 LINK       propose relationship declarations                 model, over algorithmic candidates
  5 RESOLVE    cluster records that are the same thing           algorithmic, model on the middle band
  6 REVIEW     a developer approves, edits or rejects            human
  7 PUBLISH    emit DDL, load rows, write provenance             no model, deterministic
  8 VERIFY     reconcile the graph against staging               no model
```

Stages 0 to 6 produce proposals. Stage 7 executes them. That boundary is the safety
property the whole design rests on, and it is enforced rather than intended:

> `tools/ingest/publish/` may not import anything that can reach an Anthropic client.
> A test walks the import graph and fails if it can. Same pattern as core's proof that
> Helios has no SQL tool.

Re-running stage 7 against the same staging and the same mapping version produces a
byte-identical result. No randomness, no clock, no model, recogniser library pinned by
version.

---

## 2. Storage layout

Four Postgres schemas, with a clear owner each.

| Schema | Holds | Written by | Lifetime |
|---|---|---|---|
| `staging` | Raw landed rows, every column `text` | Shredders | Permanent, immutable |
| `ingest` | Bookkeeping: sources, batches, profiles, hints, proposals, candidates, provenance | The ingest module | Permanent |
| `public` | Pulse core plus the generated `ext_*` typed tables and the spine | The publisher, through `createRecordWriter` | Live |
| `graph` | Generated read views the agent GraphQL surface reflects | The publisher | Regenerated per publish |

Every table in every one of these schemas calls `pulse_secure_table()`. A table without it
is readable by the anon key.

### Why published tables are `ext_*`

The publisher writes real migrations into `apps/<client>/extensions/migrations/`, using
the naming and tooling that already exist:

```sql
create table ext_customers (
  id          uuid primary key references records (id) on delete cascade,
  account_ref text not null,
  vat_number  text,
  created_at  timestamptz
);
select pulse_bind_typed_table('ext_customers', 'ext.customer');
select pulse_secure_table('ext_customers');

comment on table  ext_customers             is 'Customer accounts imported from the legacy CRM.';
comment on column ext_customers.account_ref is 'Client-side account reference, unique per customer.';
```

Then `npm run db:sync` and `supabase db push`, exactly as `DATA-SPINE.md` §6 already
describes. Pulse Core is not modified, no new migration machinery exists, and the generated
schema is reviewable as a diff in the client's own app before it is applied.

The `comment on` lines are load-bearing. `pg_graphql` turns them into GraphQL field
descriptions, so the ontology documents itself to the agents from one source.

### Staging is text, deliberately

A loader that infers types destroys data before anyone can inspect it. `01234` becomes
`1234`. `D02 X285` survives, `03/04/2026` silently picks a hemisphere. Every staging column
is `text`, plus two bookkeeping columns:

```sql
create table staging.stg_crm_accounts (
  _batch_id  uuid not null references ingest.batches (id),
  _row_no    bigint not null,
  account_no text,
  name       text,
  ...
  primary key (_batch_id, _row_no)
);
```

Type inference happens in stage 2 with the evidence recorded, and the parse expression ends
up written down in the mapping file where a human can see it.

### Everything the pipeline needs is already in the box

Verified against a Supabase project created 2026-09-06, Postgres 17.6, so this is what a
new Pulse client project starts with rather than a wish list.

| Extension | Version | Used for |
|---|---|---|
| `pg_graphql` | 1.6.1 | The agent read surface, called server-side as `graphql.resolve()` |
| `pg_trgm` | 1.6 | Resolution blocking, trigram similarity, fuzzy column-name matching |
| `fuzzystrmatch` | 1.2 | `levenshtein` and `dmetaphone` in the resolution score |
| `unaccent`, `citext` | 1.1, 1.6 | Name normalisation before comparison |
| `vector` | 0.8.2 | Cached column embeddings for the layer 4 shortlist |
| `pg_jsonschema` | 0.3.3 | Validating `mapping_proposals.payload` at write time |
| `postgres_fdw`, `dblink` | 1.1, 1.2 | Reading a client's live Postgres directly, schema and all |
| `wrappers` | 0.6.2 | Reading CSV, Parquet and JSONL out of S3 or Supabase Storage |
| `tsm_system_rows` | 1.0 | First-pass profiling of a very large staging table |
| `pg_partman` | 5.3.1 | Partitioning staging by batch, if a source ever needs it |
| `pgtap` | 1.3.3 | Testing the SQL under `sql/` as SQL |
| `btree_gin`, `intarray`, `hstore` | | Index and set support for sketches and profiles |

Two absences that shaped the design:

- **No `hll`.** Approximate distinct counting uses the k-min sketch in `MAPPING.md` §2,
  which is one statement of plain SQL and needs no extension.
- **No in-database Python.** Which is the correct constraint to design against anyway,
  because it keeps every algorithm expressible as SQL a reviewer can read.

Two present and deliberately unused:

- **`pg_cron` and `pgmq`.** Pulse already has one scheduler, and CLAUDE.md is explicit that
  background work registers a job rather than adding a second cron or a second runner.
  Ingest jobs register with `packages/core/src/domain/scheduler`, exactly as
  `core.knowledge.ingest` already does.
- **`http` and `pg_net`.** Calling a model from inside a Postgres function would put a model
  in the publish path, which §1 forbids.

---

## 3. Connectors

A connector's whole job is getting bytes or rows into the landing zone and registering a
batch. No parsing, no business logic, no per-client behaviour.

```typescript
// packages/modules/ingest/src/connectors/types.ts
export interface Connector {
  readonly kind: 'file' | 'sftp' | 'sql' | 'http' | 'imap';
  fetch(config: ConnectorConfig, dest: string): Promise<Manifest>;
}
```

The `sql` connector is worth calling out. With `postgres_fdw` or `dblink`, a client's live
Postgres needs no export at all: read `information_schema` and `pg_constraint` for the
hints, then pull rows straight into staging. `wrappers` covers the same move for S3,
BigQuery and a handful of SaaS sources.

`Manifest` lists the files or result sets landed, their content hashes, and any structure
the source happened to declare. That last part is the important one, see §5.

Adding a source is a small file. If a connector grows past about a hundred lines, the logic
that made it grow belongs in a shredder or in the mapping.

---

## 4. Shredders

One shredder per **format**. Sources share them. Eight cover everything a client has sent.

| Shredder | Produces | Hints it donates |
|---|---|---|
| `csv` | one staging table | header row position, delimiter, encoding, quoting, column order |
| `xlsx` | one table per detected region | number formats, formulas, named ranges, sheet names, cell comments, **data validation lists** |
| `json` | one table per nesting level, child carrying a parent key | nesting as parent-child edges, JSON path as a name hint, native types |
| `parquet` | one staging table | full column types, nullability, row-group statistics |
| `sqldump` | one table per source table | schema, foreign keys, unique constraints, checks, table and column comments |
| `mailbox` | messages, participants, attachments | thread ids as edges, addresses as entity mentions, dates |
| `pdf` | extracted field rows | page and region provenance per value |
| `xml` | one table per repeated element | element nesting, attribute versus element distinction |

Two shredders earn special mention.

**xlsx.** Spreadsheets carry more structure than their values. A cell formatted as currency
is a type declaration the text loses. A formula (`=B2*C2`) declares that a column is derived
and names its inputs. A **data validation dropdown gives the complete enumeration for a
status column, including values that appear nowhere in the data**, which no statistical
method can recover. `exceljs` exposes all of it: number formats, formulas, data validation
lists and named ranges.

**json.** Nested objects and arrays are parent-child relationships stated outright. Shred
them into separate tables with a generated parent key and emit a `nesting` hint. Those
become foreign keys at publish with no discovery work at all.

Shredders are allowed to donate nothing. A source that knows nothing costs nothing.

A shredder parses, then streams rows into staging with `COPY ... FROM STDIN`, which is the
fastest loader Postgres has and the only one worth using. Nothing is held in memory beyond
one chunk.

```
# ponytail: parse in the driver, COPY into staging, compute in SQL. A shredder that starts
# doing arithmetic has taken work that belongs in sql/. For a file too large to stream from
# the developer's machine, land it in Supabase Storage and read it with the S3 wrapper
# instead; that is a file-size problem rather than a row-count one.
```

---

## 5. Source hints

Any connector or shredder may donate structure it happens to know. The pipeline treats a
hint as a high-prior candidate that is still confirmed against the data, never as truth.

```sql
create table ingest.source_hints (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references ingest.batches (id) on delete cascade,
  kind       text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),

  constraint source_hints_kind check (kind in
    ('foreign_key','column_type','nesting','unique','label','enumeration','derived','lineage'))
);
```

This is how a SQL dump with declared foreign keys skips most of stage 4, and how a folder of
CSVs with no metadata runs the same code path without a special case.

---

## 6. Profiling

One SQL pass over staging produces, per column:

| Group | Fields |
|---|---|
| Shape | row count, null count, blank count, distinct count, cardinality ratio |
| Values | top 20 values with frequencies, min, max, length histogram |
| Type evidence | parse success rate against integer, decimal, date (per format), boolean, uuid |
| Format hits | which recognisers fired and at what rate |
| Keys | is unique, is candidate key, functional dependencies where this column is the determinant |

Profiling is the input to everything after it, and it is the only stage that reads every
row. Budget accordingly: this is the wall-clock cost of the pipeline.

Two derived classifications come out of the profile with no model involved, and they carry
straight into stage 6 quantification:

- **measure**: numeric, high cardinality, non-key, additive
- **dimension**: low cardinality, stable value set
- **identifier**: unique or near-unique, high cardinality
- **grain**: parses as a timestamp

The legitimate metric set is then the product of those: count of entity, sum and average of
each measure, grouped by each dimension, over each grain. Generated mechanically, so every
published dataset arrives with a quantitative surface on day one with nobody authoring it.

---

## 7. Bookkeeping schema

Nine tables. This is the whole of it.

```sql
create table ingest.sources (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  name       text not null,
  config     jsonb not null default '{}'::jsonb,
  precedence int  not null default 100,      -- lower wins a field conflict
  created_at timestamptz not null default now(),

  constraint sources_config_object check (jsonb_typeof(config) = 'object')
);

create table ingest.batches (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid not null references ingest.sources (id) on delete restrict,
  content_hash text not null,                 -- re-landing identical bytes is a no-op
  status       text not null default 'landed',
  row_counts   jsonb not null default '{}'::jsonb,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,

  constraint batches_status check (status in
    ('landed','shredded','profiled','mapped','reviewed','published','failed')),
  constraint batches_hash_unique unique (source_id, content_hash)
);

create table ingest.column_profiles (
  batch_id      uuid not null references ingest.batches (id) on delete cascade,
  table_name    text not null,
  column_name   text not null,
  ordinal       int  not null,
  stats         jsonb not null,
  semantic_type text,
  confidence    numeric(4,3),
  disposition   text,                          -- null until stage 6 decides
  primary key (batch_id, table_name, column_name),

  constraint column_profiles_disposition check (disposition is null or disposition in
    ('mapped','carried','deferred','rejected'))
);

create table ingest.link_candidates (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references ingest.batches (id) on delete cascade,
  from_table  text not null, from_column text not null,
  to_table    text not null, to_column   text not null,
  method      text not null,                   -- 'hint' | 'inclusion' | 'nesting' | 'name'
  evidence    jsonb not null,
  score       numeric(4,3) not null,
  status      text not null default 'proposed',

  constraint link_candidates_status check (status in ('proposed','accepted','rejected'))
);

create table ingest.mapping_proposals (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references ingest.batches (id) on delete cascade,
  kind        text not null,                   -- 'entity' | 'field' | 'predicate' | 'metric'
  payload     jsonb not null,
  origin      text not null,                   -- 'auto' | 'model' | 'human'
  score       numeric(4,3),
  status      text not null default 'proposed',
  decided_by  uuid references records (id),
  decided_at  timestamptz,

  constraint mapping_proposals_status check (status in ('proposed','approved','edited','rejected'))
);

create table ingest.entity_candidates (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references ingest.batches (id) on delete cascade,
  cluster_id  uuid not null,
  staging_ref jsonb not null,                  -- {table, batch_id, row_no}
  score       numeric(4,3),
  status      text not null default 'proposed',

  constraint entity_candidates_status check (status in ('proposed','accepted','rejected'))
);

create table ingest.record_aliases (
  record_id   uuid not null references records (id) on delete cascade,
  source_id   uuid not null references ingest.sources (id) on delete restrict,
  staging_ref jsonb not null,
  raw_title   text not null,
  primary key (record_id, source_id, staging_ref)
);

create table ingest.field_provenance (
  id            uuid primary key default gen_random_uuid(),
  record_id     uuid not null references records (id) on delete cascade,
  field         text not null,
  value         text,
  source_id     uuid not null references ingest.sources (id) on delete restrict,
  batch_id      uuid not null references ingest.batches (id) on delete restrict,
  confidence    numeric(4,3) not null default 1.0,
  observed_at   timestamptz not null,
  superseded_by uuid references ingest.field_provenance (id)
);

create index field_provenance_current_idx
  on ingest.field_provenance (record_id, field) where superseded_by is null;

create table ingest.verify_results (
  batch_id   uuid not null references ingest.batches (id) on delete cascade,
  check_name text not null,
  passed     boolean not null,
  detail     jsonb not null default '{}'::jsonb,
  ran_at     timestamptz not null default now(),
  primary key (batch_id, check_name, ran_at)
);
```

Notes on three of them.

`ingest.batches.content_hash` is unique per source, so re-landing the same export is a
no-op. This is the same idempotency posture core already uses for `file_ingestions`.

`ingest.field_provenance` answers "why does this record say that". When two sources
disagree, `sources.precedence` plus `observed_at` picks the winner and the loser is kept
with `superseded_by` set. An agent that asserts a fact writes here too, at its own
confidence, so machine-asserted and imported values stay distinguishable at query time.

`ingest.record_aliases` is what makes a merge reversible. The canonical record is derived
from cluster membership; no source row is ever destroyed.

---

## 8. Publishing

Deterministic, in one transaction per entity type.

1. Read the approved `mapping.yaml` and validate it (see `MAPPING.md` §6).
2. Generate the `ext_*` migration and write it to `apps/<client>/extensions/migrations/`.
3. `npm run db:sync`, then apply.
4. For each entity: read staging, apply the declared parse expressions, resolve to a
   cluster id, and write through `createRecordWriter(db)`. That writes the spine row, the
   typed row, the audit entry and the outbox event in one transaction, which is what makes
   audit impossible to forget.
5. Write `record_aliases` and `field_provenance` for every value landed.
6. Write `relationships` rows for every approved predicate. Intrinsic one-to-many ownership
   gets **both** a typed foreign key and an edge, as `ARCHITECTURE.md` §6 requires.
7. Regenerate the `graph.*` views.
8. Run stage 8 and record the results.

Inferred edges carry their evidence in the existing `attributes` column, so core needs no
change:

```json
{"source":"inferred","method":"inclusion_dependency","confidence":0.98,
 "batch":"...","evidence":{"containment":1.0,"coverage":0.994,"distinct_from":8412}}
```

```
# ponytail: confidence and method live in relationships.attributes. Promote them to real
# columns with a gin index the first time a query filters on them and the plan goes
# sequential. That is a module migration, so it does not touch core either way.
```

---

## 9. Verification

Runs on every publish, including every later batch. A failure blocks the publish and raises
into the action inbox.

| Check | Fails when |
|---|---|
| `disposition_complete` | any profiled column has a null disposition |
| `row_conservation` | source rows does not equal published records plus explicitly rejected rows |
| `value_conservation` | `sum()` of any declared measure differs between staging and the published table |
| `cardinality` | a declared one-to-many is violated in the data |
| `referential_closure` | an edge points at a record that does not exist |
| `round_trip` | fewer than the target percentage of sampled source cells can be reconstructed from the graph |
| `scope_agreement` | a `graph.*` view returns a different row set than `visibleRecordFilter` for the same actor |
| `merge_rate` | the resolution merge rate moved more than the configured delta from the previous batch |

`round_trip` is the one that directly measures context loss. Sample 200 source rows,
reconstruct each from the published graph, diff against the original, report the percentage
of cells recovered. Any field that cannot be reconstructed is loss, expressed as a number
that is watched rather than a discovery made a year later.

`scope_agreement` is the test that makes the generated `graph.*` views defensible. If the
views and the policy kernel ever disagree about which rows an actor may see, the build
stops.

---

## 10. Coverage reporting

Printed at the end of every batch, stored in `ingest.verify_results`, diffed against the
previous batch.

```
batch  ing_2026_09_07_a   source: acme-crm-export

columns              214 profiled
  mapped             138  (64%)
  carried             51  (24%)
  deferred            19   (9%)
  rejected             6   (3%)
  undisposed           0        <- must be zero to publish

rows                 1,284,331 staged -> 1,284,331 accounted
cells reconstructable     97.4%   (previous batch 97.6%,  -0.2)
entities                  6 types, 41,882 records
edges                     9 predicates, 128,004 rows  (3 inferred, all above 0.95)
merges                    1,204  (2.9% of records,  previous 3.1%)
```

A new export that quietly adds twelve columns shows up here as coverage falling, before it
reaches a client.

---

## 11. Continuous batches

After the first publish, a new batch from the same source runs stages 0, 1, 2, 7 and 8
automatically against the approved mapping. Stages 3 to 6 run again only when the profile
diff shows something new: a column that was not there, a column whose value distribution
moved beyond threshold, or an enumeration that gained a member.

That change is a proposal, and it lands in the action inbox rather than being applied.
A schema that changes itself in production is how the graph stops meaning what the client
was told it means.
