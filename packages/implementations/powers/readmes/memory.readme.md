# Memory

MemoryPower owns User/Agent Core Memory and searchable knowledge. One platform data root has one local user (`local`), independent of Downtown login accounts. City UserRepository owns user/user.json. MemoryPower handles requests, scope checks and durable commits; dedicated work/memory Sessions perform extraction, revision and Profile consolidation.

## Flow

Core Profiles are captured in the Session system snapshot. On each turn, MemoryPower compares the frozen versions with current Profiles and supplies bounded reference updates when they differ. New Sessions and syncshot load the full current Profiles. Updates never rewrite canonical messages or grant permissions.

Ordinary Sessions call the public actions. Semantic operations create persisted Memory Jobs and dedicated Sessions with a fixed model, memory-only tools, bounded sources and a processing budget. These Sessions do not inherit the Agent's business instructions, Skills, Workspace tools or ordinary completion delivery. Their output is staged; only the host's validated commit establishes success. There is no automatic per-turn capture or Profile optimization. Background knowledge consolidation is explicitly enabled per scope and disabled by default.

## remember

- content: required non-empty text.
- target: user, agent or current_workspace.
- mode: profile or knowledge; default knowledge.
- topic, memory_type, source: optional knowledge organization, type and evidence label.

Profile supports user and agent. User Profile applies across local Agents; Agent Profile applies only to that Agent. Workspace Profile is rejected. Appending is immediate and returns profile_id. Knowledge mode creates a separate versioned record with request provenance, returning memory_id and version. Topic is an organization hint, not an overwrite address.

```json
{"target":"user","mode":"profile","content":"Before the main answer, remind me to speak English and briefly correct my expressions."}
```

Use `target`, never `scope`, in remember payloads. Persistent behavior changes should explicitly choose mode profile; omitting mode still defaults to searchable knowledge. Only successful tool results establish that saving completed.

Committed writes return target, mode, status, activation and location, plus profile_id or memory_id. Profile returns status=saved and activation=next_turn_or_new_session; knowledge returns status=created and activation=on_recall. Ordinary knowledge read/revise/forget do not accept profile_id. User/Agent knowledge management does not require a Workspace; project writes do.

## Profile maintenance

Request Profile consolidation with `optimize {target: "user" | "agent"}`. The dedicated Memory Session stages exact nonoverlapping edits against a read version, preserving applicable agreements and source markers. The Profile service validates and applies them under a scope lock with a recoverable receipt. Within the same request scope, repeated optimization of the same Profile version uses a stable source identity and reuses the Job. Profile files and knowledge manifests are separate transactions.

`digest` requires session_id, category (chat/work), and target; max_messages defaults to 30 and is limited to 100. It extracts supported durable knowledge from bounded canonical text. Within the same request scope, the captured sources and extraction policy determine deduplication; unrelated knowledge changes do not create another digest request. `revise` requires memory_id and instruction, with optional evidence. Digest, revise and optimize return a Job view rather than immediate saving confirmation.

Use `jobs` to list processing records, `job_status {job_id}` to read state, and `retry {job_id}` to retry a failed explicit request. Retry automatic batches from background management, where scope quotas and cooldown still apply. Lists and status return `MemoryJobView` without source text. Only succeeded confirms a commit; skipped means no change. Pending or failed changes do not establish that memory took effect. Failed processing never silently archives source text as knowledge.

Call `job_detail {job_id}` to inspect `{job: MemoryJobView, changes: MemoryJobChangeDetail[]}`. This separate read endpoint checks the current Job's Agent/Workspace scope, using the same scope checks as job_status. It returns the authorized source excerpts persisted for that request; lists and status contain no source text. Changes include operation, topic, optional memory ID, the actual read version for existing content, fixed before/after snapshots, capture time and exact source excerpts from the authorized input. Source roles and available Session/message identifiers are retained, and partial excerpts are marked. Creates have `before: null`; invalidation preserves text and marks it invalidated. Profile snapshots cover the exact edited regions and refer to the full Profile's read version. Details describe this operation even if current content later changes. Records without captured snapshots return `changes: []`; current content is never used to reconstruct a missing historical snapshot.

Session calls to digest, revise and optimize subscribe the original calling Session and Turn to the eventual succeeded, skipped or failed result. Digest's source Session is not used as the feedback recipient. A separate durable outbox persists completion summaries without source text and handles them idempotently. The result is injected only while the original Turn can receive it. If that Turn has ended, the result remains available in processing records; no new Turn starts automatically. `delivery_status=delivered` records injection; `delivery_status=saved` records retention without injection. Both finish delivery, so saved results are not retried for injection. Delivery failures retry with backoff without changing the memory commit status. Management-page requests have no chat recipient. Use processing records to check the result when needed, avoid repeated polling, and avoid duplicating a saving confirmation already delivered for the Job.

Host actions: memory.user_read/user_update delegate base information to City. memory.profile_read/profile_edit/profile_delete/profile_status accept target=user or target=agent plus agent_id. Edit/delete require the read version. The Memory management page includes processing records, status, results and failed-job retries. Selecting a record loads job_detail with the selected Agent and Workspace. It shows one change at a time, divides long text into sections with differences highlighted, paginates source excerpts, and distinguishes committed changes from unconfirmed plans.

## Background consolidation

Open Memory's background consolidation page, select an Agent, Workspace and knowledge target, then explicitly enable that exact scope. Default switches are off. Automatic commits support Agent private knowledge and explicitly shareable Workspace knowledge only; neither Profile nor User knowledge is changed automatically. Explicit actions remain independent of these switches.

Trusted sources are corrections typed directly on the page and, in the official Power assembly, Task accept facts and revise facts with explicit feedback. Task publishes facts atomically with work state, capturing output text, roles, fingerprint and read range. Execution success and Turn completion are not human acceptance. Task facts default to the original Agent's private knowledge. Project-shared corrections require an explicit sharing submission. No private Session-history scan occurs. Memory Sessions, generated changes and completion feedback are excluded as new original sources.

Maintenance checks run every five minutes, including durable intake and commit-receipt reconciliation while automatic computation is disabled. Empty queues make no model calls. A batch fixes one Agent, target and knowledge mode: at most 4 facts, 16 sources and 32,000 characters. Each scope reserves at most 2 computations per UTC day, including retries, at least 10 minutes apart. Normal attempts retain a 120-second bound and a Job allows at most 3 attempts. Quotas count computations, not monetary costs. Explicit requests take priority at Job boundaries; active computations and atomic commits are not preempted. Disabling stops new computation while preserving queued input.

The page shows scope state, accepted sequence, continuous processed watermark, backlog, quota/cooldown deferrals, errors, source boundaries, batches and corresponding Job states. Only succeeded with a commit receipt or an explicit skipped outcome marks input processed. Failures, unreadable sources and deferrals remain pending; earlier unfinished facts block the continuous watermark. Failed batches require explicit retry under the same switch, cooldown and quotas. Automatic work has no chat recipient: committed does not establish delivery.

Host actions, not ordinary model tools:

- `memory.dream.status`: agent_id, optional workspace_id, target=agent/current_workspace.
- `memory.dream.configure`: the same scope plus enabled.
- `memory.dream.correction`: the same scope plus a client UUID event_id, ISO occurred_at, content and workspace_share_allowed. Preserve all parameters when retrying. Returns received, not processed or committed.
- `memory.dream.retry`: the same scope plus batch_id.

The official Power assembly connects the reliable Task source. Standalone MemoryPower construction may supply `dreaming.read_signals`, a trusted replayable reader returning `MemorySignalInput[]`; management-page corrections remain available without that callback. Shared platform ledgers deduplicate events and batches across local Cities. Each batch stays bound to its original City's private Job; another City does not take it over. Preserve that City's processing data for recovery. Task deletion archives command facts before deleting the Task aggregate. Task deletion and forgetting do not erase every source copy. Automatic commits never receive allow_recreation authorization; exact-content suppression does not guarantee semantic suppression.

## Storage and configuration

```text
<platform-root>/user/user.json
<platform-root>/user/PROFILE.md
<platform-root>/user/memory/runtime/knowledge/current.json
<platform-root>/agents/<agent_id>/PROFILE.md
<platform-root>/agents/<agent_id>/memory/runtime/knowledge/current.json
<shared-memory-root>/workspaces/<encoded-id>/runtime/knowledge/current.json
<platform-root>/memory/dreaming/scopes/<scope-hash>.json
```

User knowledge is stored once and read by local Agents. Agent knowledge remains private; Workspace knowledge stays project-isolated. Memory IDs are logical references. Old per-user directories and Agent wiki preferences are not automatically migrated.

```ts
const memory_power = new MemoryPower({
  platform_root_path: "/absolute/platform-root",
  model_id: "configured-text-model",
});
```

Power configuration accepts model_id for new Memory Sessions; otherwise the owning Agent's default model is selected and fixed for that Session. Channel authorization remains the host's responsibility. Switching Downtown accounts does not switch User memory.

Knowledge commits publish records, validity and receipts in a single scope manifest. Deleted content leaves normal read/list/search; an exact normalized-content fingerprint prevents identical reconstruction. Semantic paraphrases are not guaranteed to be suppressed. Original Sessions, Job source copies and retained history are not erased by forget. Existing Markdown is retained but requires explicit SDK import with create_memory_import_changeset before it enters the active store.
