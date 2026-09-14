# Pulse Ingest

Turning an arbitrary pile of client data into a typed, related, queryable graph that
Pulse agents can traverse.

Status: **design agreed. Nothing built yet.** These documents are the build order.

| Doc | For |
|---|---|
| `PIPELINE.md` | The stages, the storage layout, the bookkeeping schema, where code lives |
| `MAPPING.md` | The mapping algorithm: layers, scoring, the mapping file, relationships, resolution |
| `EVALUATION.md` | How we test it and drive it to the version we ship |
| `SOP.md` | The runbook an ACMR developer follows on a client project |

---

## The problem in one paragraph

A client hands over exports: spreadsheets, a CRM dump, an accounting extract, a folder of
PDFs, sometimes a live database. None of it is related to any of the rest of it. Pulse
needs it as typed records in the spine, joined by declared predicates, with metrics over
it, so that agents can be pointed at a real graph instead of a pile of files. That has to
work for a wholesaler, a fabricator, an accountancy practice and a facilities contractor,
without Pulse Core learning anything about any of them.

## The six decisions this design rests on

**1. Raw is permanent. The graph is a projection.**
Staging is immutable and never deleted. Every published record points back at the staging
rows it came from. A mapping mistake costs a re-projection. This is what makes every other
decision safe to get wrong once.

**2. One narrow waist.**
Every source and every format collapses to staging tables of text before anything
intelligent runs. Connectors move bytes. Shredders parse formats. Nothing downstream knows
where the data came from. N sources times M formats becomes N small connectors plus M
shredders plus one pipeline.

**3. The model writes declarations. It never writes rows.**
Everything at volume is SQL. The model sees profile digests measured in kilobytes, emits a
declaration, a human approves it, and a deterministic publisher executes it. There is no
path from a hallucination to a row. Enforced by a test: the publish path has no model
client reachable from it, in the same way core proves Helios has no SQL tool.

**4. Published tables are client extension tables.**
The publisher generates `ext_*` tables into `apps/<client>/extensions/migrations/`, bound
to the spine with `pulse_bind_typed_table()` and secured with `pulse_secure_table()`. Pulse
Core is not touched. Ingest ships as a module (`packages/modules/ingest`) owning
`mod_ingest_*` bookkeeping tables. The freeze holds.

**5. The target ontology is fixed and extensible.**
A core upper ontology plus industry packs. New entity types are created through review.
Mapping onto a known target is a tractable problem with good deterministic methods.
Inferring an ontology from nothing is neither, and produces something no second client can
reuse.

**6. Deterministic layers carry the load; the model handles the residue.**
The model is the same model for client 1 and client 40. The recogniser library and the
reference corpus of previously mapped columns get better with every client. Put the
compounding asset in the deterministic layers and spend model calls on what is left.

## Stated assumptions

These are working assumptions rather than settled decisions. Each is cheap to revisit now and
expensive to revisit after the first client.

| # | Assumption | Revisit when |
|---|---|---|
| A1 | Bulk data lands in the client's Supabase Postgres | A dataset exceeds roughly 50M rows, or a client's data may not leave their own tenancy |
| A2 | Everything is TypeScript in the Pulse monorepo. All compute is SQL in the client's Supabase Postgres. No second toolchain | The team wants Splink's EM-estimated match weights badly enough to add Python |
| A3 | An ACMR developer approves every mapping before publish. Zero-touch is out of scope for v1 | Clients self-onboard |
| A4 | Agents read the published graph through `graphql.resolve()` called server-side, gated by the policy kernel | See the open question below |
| A5 | Model calls default to `claude-opus-5` through the Batch API with prompt caching on the shared prefix | Measured cost becomes material, which on current volumes it will not |

## Open questions

Recorded here rather than guessed at.

1. **Scope filtering in the GraphQL surface.** Entity-level permission is easy: parse the
   document, collect the types, `policy.assert` each one before resolving. Row-level scope
   is the problem. The proposal in `PIPELINE.md` is generated `graph.*` views carrying the
   scope predicate, with a reconciliation test proving they agree with
   `visibleRecordFilter`. That is a second filter path and CLAUDE.md is right to be
   suspicious of it. The alternative is generating resolvers over the repository layer,
   which is one authz path and more codegen. Decide before the GraphQL surface is built.

2. **Where bulk data lives.** A1 assumes it lands in Supabase. If a client's volume or
   contract says otherwise, Postgres holds the entities, edges and metrics while detail
   rows stay at source, and the publisher emits foreign tables rather than real ones.
   This changes the publisher and nothing else, so it can wait, but not past client two.

3. **Gold corpus provenance.** `EVALUATION.md` needs three datasets with known-correct
   mappings before any accuracy number means anything. The Azure set is the first. Whether
   it arrives with a correct schema or has to be hand-mapped once determines whether Phase
   0 is one day or three.

4. **Cheaper model tier for the resolution middle band.** Pair adjudication is high volume
   and small input. A cheaper tier is defensible there and is a cost decision rather than
   an architectural one. Nothing depends on it; raise it when the volume is known.

## Where the code goes

```
packages/modules/ingest/          the Pulse-side module: bookkeeping tables, review UI,
                                  publish action, the mod_ingest_* migrations
packages/modules/ingest/sql/      the compute: profiling, sketches, IND, FD, resolution.
                                  Plain SQL files, versioned, run by the driver
packages/modules/ingest/src/      the driver: connectors, shredders, cascade, publisher
packages/modules/ingest/ontology/ the target ontology: core pack + industry packs
packages/modules/ingest/recognisers/  the semantic type library, versioned
packages/modules/ingest/eval/gold/    the gold corpus
apps/<client>/extensions/         generated ext_* migrations, and the client's mapping.yaml
```

The driver parses files, runs SQL and calls the model. It holds no algorithm of its own.
Every operation that touches more than one row is a SQL file under `sql/`, which is what
makes the pipeline reviewable, testable with `pgtap`, and portable to the next client.
