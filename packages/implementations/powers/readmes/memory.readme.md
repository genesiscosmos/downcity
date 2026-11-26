# Memory

MemoryPower owns persistent Agreements and searchable Knowledge. One platform data root has one local user (`local`), independent of Downtown login accounts. City owns base user information; Memory owns record semantics, sources, processing and durable commits.

## Flow

Agreement and Knowledge share one canonical record store. Agreement has a complete content field and no title; Knowledge requires an independent title and content. User and Agent Agreements generate the Profile context. Knowledge is searched and read when needed. Profile is a derived view, not a separate writable document.

New Sessions and syncshot load the complete current Agreement projection. Each turn compares its frozen baseline with current records and explicitly replaces outdated bindings. Required-memory loading failures must stop the model call; they must not silently omit agreements. Saving and loading into a Session are separate outcomes.

Ordinary actions use deterministic commits. Semantic actions create a bounded Memory Job, then a dedicated work/memory Session reviews fixed sources and stages changes. The host validates and commits; the model's final text is not a commit receipt. Background consolidation is disabled by default.

## Memory selection and evidence

Select memory for expected future usefulness: enduring goals and stable constraints, decision reasons, strategies and verified lessons that can change future choices or avoid repeated investigation. Skip routine logs, temporary progress and state readily available from the environment; short-term next steps belong in Task or Session context. Keep Agreements concise; put detailed experience and project information in searchable Knowledge.

When learning from success or failure, distinguish observations, explanations and verified rules. The business Agent should test explanations when authorized and practical, then retain the rule, verification evidence, applicable conditions and limitations. A successful retry, human acceptance or an exact quote alone does not establish causation. Repeated references are not new evidence. An untested explanation must not become a verified lesson; retain labeled observations or unresolved questions only when clearly useful, without accumulating speculation. Explicit user preferences and agreements require no experimental verification.

Explicit source selection currently accepts canonical text Parts and already-disclosed plain-text tool model_output. Structured folded results, undisclosed complete tool output, attachments and binary content are rejected rather than treated as observed evidence.

The dedicated Memory Session reviews only the support in provided sources, including claimed verification; it does not perform business experiments. Narrow or skip unsupported conclusions, preserve counterevidence and uncertainty, and do not treat existing memories as independent corroboration. Explicit credential patterns are rejected in record text and captured source text, including automatically captured user input. This guard does not classify all sensitive information; keep unrelated private material out of selected evidence. Source and commit checks establish traceability and storage consistency, not semantic truth. Explicit remember directly saves submitted content; the calling Agent is responsible for its selection and wording.

Use the canonical `memory_id` returned by tools: `agent/<agent_id>/wiki/<opaque_id>`, `user/<hex_user_id>/wiki/<opaque_id>` or `workspace/<hex_workspace_id>/wiki/<opaque_id>`. Preserve the complete ID without URI prefixes, leading slashes or whitespace. A returned `memory:...@version#L...` citation is a body reference, not a record ID. Reads, updates, forgetting, revisions and management history share the same validation.

## remember

Create an Agreement:

```json
{"scope":"agent","kind":"agreement","content":"Ask for confirmation before changing multiple modules."}
```

Create Knowledge:

```json
{"scope":"workspace","kind":"knowledge","title":"Configuration snapshot boundary","content":"A turn uses one fixed configuration snapshot. Check the current implementation before relying on a specific reload path."}
```

`scope`, `kind` and `content` are required. Knowledge also requires `title`; Agreement forbids it. Scope is user, agent or workspace. Workspace supports Knowledge only. Optional `source_refs` select authorized canonical message Parts; the host captures roles, locations and excerpts. Optional `request_id` binds a replayable request. Titles are not unique keys and never select records for overwrite.

The host supplies memory_id, resolved scope, version, state, sources, created_at and updated_at. An Agreement requires traceable user input or authenticated management input. Request provenance alone is not a user agreement. Content format and budgets are shared across ordinary actions, management and Memory Session staging.

A successful write returns status=committed or unchanged, operation, request_id, commit_id, committed_at and record. Record state is active, invalidated or deleted and does not express verification. Agreement activation is next_turn_or_new_session; Knowledge activation is on_recall. A delete receipt omits the removed body.

## Profile maintenance

Use read to obtain the full record and version. update requires memory_id, expected_version and complete replacement content; Knowledge also requires the complete title. Scope and kind cannot change through update. forget requires memory_id and expected_version; state may be invalidated or deleted, defaulting to deleted. Neither state remains in ordinary read/list/search or the Agreement projection.

list and search accept optional scope and kind. Search indexes Knowledge title and body separately; body citations preserve their original lines and record version. Agreement labels are deterministic summaries of content. Knowledge labels always use title.

digest requires session_id, type (chat/work), scope and kind, with an optional bounded max_messages. revise requires memory_id, expected_version and instruction, with optional evidence/source_refs. optimize explicitly consolidates one scope and kind. These actions return asynchronous Jobs. Only succeeded with a durable receipt confirms committed changes; skipped means no changes. Pending or failed changes are not saved records.

The dedicated Session has one memory_stage tool for both kinds. It reads sources, searches before creating, and reads exact records and versions before updating or invalidating. Every staged change cites authorized original material. Consolidation preserves applicable agreements, conditions and evidence; it does not move records across scopes or turn Knowledge into Agreements.

jobs and job_status omit source text. job_detail shows captured before/after, labels, actual read versions and source excerpts, rather than reconstructing history from current data. retry keeps the original sources, scope, model and authorization binding. Automatic batches are retried through their scope management.

The original calling Session/Turn receives a completion summary only while it can accept one. Otherwise the result remains in processing records, without starting another turn. delivery_status describes result delivery, not memory commit status. Delivery retries never repeat the memory commit.

## Background consolidation

Trusted host APIs explicitly enable one Agent, Workspace context and scope combination. Automatic batches write only private Agent Knowledge or explicitly shareable Workspace Knowledge. They never write Agreements or User Knowledge and do not scan private Session history.

Inputs are explicit corrections and persisted Task acceptance/revision facts with explicit feedback. Execution success, opening a result and ending a turn are not human acceptance. Generated memories and processing feedback are not fresh original evidence.

Maintenance checks run every five minutes. A batch has at most four facts, sixteen sources and 32,000 characters. Each scope reserves at most two computations per UTC day, including retries, at least ten minutes apart. Attempts have a 120-second bound and a Job permits at most three attempts. Empty queues make no model calls. Explicit requests take priority at Job boundaries.

Host management actions are memory.dream.status, memory.dream.configure, memory.dream.correction and memory.dream.retry. They bind the actual Agent/Workspace identity and scope; ordinary model tools do not configure background permissions. Failed or deferred inputs remain pending. Automatic work has no chat recipient.

## Storage and configuration

Each scope has one canonical records manifest, immutable record versions, source snapshots, history, suppression information and durable commit receipts. Agreement and Knowledge use the same transaction boundary. Profile, list labels and search chunks are rebuildable projections. Logical memory IDs do not describe physical paths.

Mutations check the read version and use a scope lock. Same-request replay returns its fixed receipt; reusing a request key with different content fails. Exact duplicates can return unchanged. Similar wording is not sufficient for semantic deduplication.

Forgetting removes a record from active use but does not erase original Sessions, Job inputs, retained history or backups. Exact-content suppression cannot guarantee suppression of semantic paraphrases. Recreating forgotten content requires explicit current user authorization.

```ts
const memory_power = new MemoryPower({
  platform_root_path: "/absolute/platform-root",
  model: selected.model,
  binding_id: selected.binding_id,
});
```

New Jobs bind their model and service authorization when submitted. Account switches do not rewrite an existing Job's binding or silently change retry billing. The host controls channel access; switching Downtown accounts does not change the single local User.

On first use, the builtin provider prepares each scope resolved from the trusted access context. If its manifest is absent, it rechecks the scope under the same cross-process lock used for record commits. Only a scope with no stored or legacy material receives a `confirmed_empty` manifest at scope version `0`. This applies to User, new Agents, ordinary Workspaces and internal main Workspaces. Existing manifests are read without replacement; each required scope is checked independently.

The empty check uses metadata, including external User/Agent Profile files, Profile ledgers and backups, scope history, suppression data, unfinished publications and known legacy Memory directories. It does not scan private Session history or load document bodies. Symlinks, corrupt manifests and access failures fail explicitly. Storage adapters must implement `has_entries` without filtering temporary or unknown files. A host storing legacy material outside the adapter must supply `BuiltinMemoryProviderOptions.legacy_scope_probe`.

A scope with legacy material and no manifest fails with `MEMORY_MIGRATION_REQUIRED`. The SDK exports preview_memory_migration, memory_migration_preview_hash and publish_memory_migration accept explicitly supplied materials and reviewed mappings, require complete history/suppression preservation and a trusted write barrier, and do not collect a live data root automatically. Preview and review all existing records before activation; preserve original text, missing-source information, stable IDs and forgotten states. Unresolved agreement coverage or titles block activation. Running a migration, restarting a service and deploying require their own authorization.
