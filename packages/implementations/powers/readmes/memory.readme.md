# Memory

MemoryPower provides scoped long-term knowledge and explicit search, read, remember, revise, digest, and forget actions.

## Automatic flow

Automatic memory is explicitly enabled through `MemoryPowerOptions.automatic` or Power configuration. Before model processing, the host calls Jev with two questions:

- `save_scope`: choice of `none`, `user`, `workspace`, `agent`, or `mixed`.
- `should_recall`: boolean controlling immediate recall.

Non-`none` results create durable source markers. Every 30 minutes, the City worker reads incremental completed Session turns, extracts short memories with a configured text model, validates sources and scope, and persists an idempotent write plan. It advances the cursor only after writes succeed. Agent replies do not trigger another model decision.

Failures retain pending work with retry backoff. City must be running for background formation. Recalled content is historical reference and never becomes canonical user input or system instruction. Legacy fixed-wiki Core injection and automatic per-reply capture are disabled. Core now comes from Agent PROFILE.md.

## Agent Core Memory

`agents/<agent_id>/PROFILE.md` is managed by MemoryPower alongside, but independently of, SOUL.md. It contains explicitly Agent-wide persistent agreements and is loaded into every turn's reference context without Jev or keyword search, including new Sessions. Current requests and system permissions take precedence.

Use `remember` with `target: "agent"`, `mode: "profile"`, and `content` to append immediately. Omitting mode defaults to `knowledge`, which stores searchable records. Successful Profile writes return `profile_id`; this is not a wiki ID accepted by read/revise/forget. Host actions `memory.profile_read`, `memory.profile_edit`, and `memory.profile_status` provide document access, exact editing, and state. Editing requires the version returned by read.

Appends have no size cap and are idempotent by source. A daily check calls the configured formation model only when the visible document exceeds 2,000 Unicode characters. The model proposes unique, non-overlapping exact replacements; code checks the document version, preserves source markers, backs up the original, and writes atomically. Optimization aims for 2,000 characters without deleting valid agreements; documents can remain longer. Daily checks run only while City is running.

Agent Profile is shared by all users of that Agent. Private User preferences do not automatically fall back to Profile. Existing wiki preferences are not automatically migrated. Automatic formation can append clearly Agent-scoped Core agreements; User identity integration remains separate.

## Scopes

- User records are shared by authorized Agents for the same trusted user. A host `resolve_user` callback is required; external chat IDs and model billing accounts are not user identity.
- Workspace records are isolated by project and shared across Agents in that Workspace.
- Agent records are private.
- Legacy City records remain accessible through explicit actions and are excluded from automatic recall.

`mixed` means multiple candidate scopes and is split during formation. A user preference targeting one Agent remains User memory with an applicability restriction.

## Configuration

```ts
const memory_power = new MemoryPower({
  platform_root_path: "/absolute/platform-root",
  automatic: {
    enabled: true,
    decision_model_id: "jev-latest",
    formation_model_id: "configured-text-model",
    resolve_user: resolve_trusted_message_user,
  },
});
```

The callback is application-provided. Without it, User reads and writes are unavailable. Automatic processing defaults to disabled. Power configuration supports `enabled`, `decision_model_id`, and `formation_model_id`, applied after restart. Jev can be discovered; a formation model must be selected explicitly.

The host action `memory.automatic_status` exposes pending counts, model selection, errors, and retry timing without conversation text.

## Storage

Agent records use `agents/<agent_id>/memory/wiki`. User and Workspace records use `users/<encoded-id>/wiki` and `workspaces/<encoded-id>/wiki` under the shared Memory root. `runtime/sessions` holds source markers, cursors, and plans; original conversations stay in Session storage.

Public `memory_id` values are logical references. Reuse returned IDs unchanged in read, revise, and forget actions. Explicit digest remains transcript archival and is separate from automatic short-record formation.

The Desktop management view still has legacy City and Agent navigation; dedicated User and Workspace navigation is pending. New project records are accessible through domain actions.
