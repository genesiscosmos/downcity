# Memory

MemoryPower owns User/Agent Core Memory and searchable knowledge. One platform data root has one local user (`local`), independent of Federation login accounts. City UserRepository owns user/user.json. MemoryPower handles requests, scope checks and durable commits; dedicated work/memory Sessions perform extraction, revision and Profile consolidation.

## Flow

Core Profiles are captured in the Session system snapshot. On each turn, MemoryPower compares the frozen versions with current Profiles and supplies bounded reference updates when they differ. New Sessions and syncshot load the full current Profiles. Updates never rewrite canonical messages or grant permissions.

Ordinary Sessions call the public actions. Semantic operations create persisted Memory Jobs and dedicated Sessions with a fixed model, memory-only tools, bounded sources and a processing budget. These Sessions do not inherit the Agent's business instructions, Skills, Workspace tools or ordinary completion delivery. Their output is staged; only the host's validated commit establishes success. There is no automatic per-turn capture, daily optimization or Dreaming.

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

Request Profile consolidation with `optimize {target: "user" | "agent"}`. The dedicated Memory Session stages exact nonoverlapping edits against a read version, preserving applicable agreements and source markers. The Profile service validates and applies them under a scope lock with a recoverable receipt. Profile files and knowledge manifests are separate transactions.

`digest` requires session_id, category (chat/work), and target; max_messages defaults to 30 and is limited to 100. It extracts supported durable knowledge from bounded canonical text. `revise` requires memory_id and instruction, with optional evidence. Both return a Job view rather than immediate saving confirmation.

Use `jobs` to list processing records, `job_status {job_id}` to read state, and `retry {job_id}` to retry a failed request. Only succeeded means committed; skipped means no change. Failed processing never silently archives source text as knowledge.

Host actions: memory.user_read/user_update delegate base information to City. memory.profile_read/profile_edit/profile_delete/profile_status accept target=user or target=agent plus agent_id. Edit/delete require the read version. Dedicated Desktop management UI is pending.

## Storage and configuration

```text
<platform-root>/user/user.json
<platform-root>/user/PROFILE.md
<platform-root>/user/memory/runtime/knowledge/current.json
<platform-root>/agents/<agent_id>/PROFILE.md
<platform-root>/agents/<agent_id>/memory/runtime/knowledge/current.json
<shared-memory-root>/workspaces/<encoded-id>/runtime/knowledge/current.json
```

User knowledge is stored once and read by local Agents. Agent knowledge remains private; Workspace knowledge stays project-isolated. Memory IDs are logical references. Old per-user directories and Agent wiki preferences are not automatically migrated.

```ts
const memory_power = new MemoryPower({
  platform_root_path: "/absolute/platform-root",
  model_id: "configured-text-model",
});
```

Power configuration accepts model_id for new Memory Sessions; otherwise the owning Agent's default model is selected and fixed for that Session. Channel authorization remains the host's responsibility. Switching Federation accounts does not switch User memory.

Knowledge commits publish records, validity and receipts in a single scope manifest. Deleted content leaves normal read/list/search; an exact normalized-content fingerprint prevents identical reconstruction. Semantic paraphrases are not guaranteed to be suppressed. Original Sessions, Job source copies and retained history are not erased by forget. Existing Markdown is retained but requires explicit SDK import with create_memory_import_changeset before it enters the active store.
