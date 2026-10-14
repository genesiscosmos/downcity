# Memory

MemoryPower provides scoped long-term knowledge and explicit search, read, remember, revise, digest, and forget actions.

## Automatic flow

Automatic memory is explicitly enabled through `MemoryPowerOptions.automatic` or Power configuration. Before model processing, the host calls Jev with two questions:

- `save_scope`: choice of `none`, `user`, `workspace`, `agent`, or `mixed`.
- `should_recall`: boolean controlling immediate recall.

Non-`none` results create durable source markers. Every 30 minutes, the City worker reads incremental completed Session turns, extracts short memories with a configured text model, validates sources and scope, and persists an idempotent write plan. It advances the cursor only after writes succeed. Agent replies do not trigger another model decision.

Failures retain pending work with retry backoff. City must be running for background formation. Recalled content is historical reference and never becomes canonical user input or system instruction. Unconditional Core Memory injection and automatic per-reply capture are disabled.

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
