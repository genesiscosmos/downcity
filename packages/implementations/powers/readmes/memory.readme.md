# Memory

MemoryPower owns User/Agent Core Memory and searchable knowledge. One platform data root has one local user (`local`), independent of Federation login accounts. City UserRepository owns user/user.json; MemoryPower owns the user's memories. No identity callback, Jev gate or periodic Session formation worker is required.

## Flow

Each turn loads user/PROFILE.md, then agents/<agent_id>/PROFILE.md as reference context before the original user content. The Agent decides whether to call remember/search/read from the request and conversation. Current instructions and permissions take precedence. Injection never modifies canonical Session messages.

## remember

- content: required non-empty text.
- target: user, agent or current_workspace.
- mode: profile or knowledge; default knowledge.
- topic, memory_type, source: optional knowledge organization, type and evidence label.

Profile supports user and agent. User Profile applies across local Agents; Agent Profile applies only to that Agent. Workspace Profile is rejected. Appending is immediate and returns profile_id, not a wiki memory_id. Knowledge mode saves evidence and creates or appends a wiki topic, returning memory_id and evidence_id.

```json
{"target":"user","mode":"profile","content":"Before the main answer, remind me to speak English and briefly correct my expressions."}
```

Use `target`, never `scope`, in remember payloads. Persistent behavior changes should explicitly choose mode profile; omitting mode still defaults to searchable knowledge. Only successful tool results establish that saving completed.

Results consistently return target, mode, status, activation and location, plus profile_id or memory_id/evidence_id. Profile returns status=saved, activation=every_turn and location=PROFILE.md. Knowledge returns status=created/updated, activation=on_recall and location=wiki. Ordinary knowledge read/revise/forget do not accept profile_id. User/Agent knowledge management does not require a Workspace; project writes do.

## Profile maintenance

Both scopes use the same service. Appends have no size cap and are idempotent by source. Each Profile is checked once per local calendar day; documents above 2,000 visible Unicode characters are optimized using profile_model_id. Exact-edit validation checks unique matches, non-overlap, an unchanged version and source-marker retention. The original is backed up. The target is not truncation; valid agreements take precedence.

Profile changes load on the next turn, including new Sessions. A read failure in one scope does not suppress the other. Without an optimization model, reads, appends and tools still work; optimization records an error and retains the file.

Host actions: memory.user_read/user_update delegate base information to City. memory.profile_read/profile_edit/profile_delete/profile_status accept target=user or target=agent plus agent_id. Edit/delete require the read version. Dedicated Desktop management UI is pending.

## Storage and configuration

```text
<platform-root>/user/user.json
<platform-root>/user/PROFILE.md
<platform-root>/user/memory/wiki/ and evidence/
<platform-root>/agents/<agent_id>/PROFILE.md
<platform-root>/agents/<agent_id>/memory/wiki/ and evidence/
<shared-memory-root>/workspaces/<encoded-id>/wiki/ and evidence/
```

User knowledge is stored once and read by local Agents. Agent knowledge remains private; Workspace knowledge stays project-isolated. Memory IDs are logical references. Old per-user directories and Agent wiki preferences are not automatically migrated.

```ts
const memory_power = new MemoryPower({
  platform_root_path: "/absolute/platform-root",
  profile_model_id: "configured-text-model",
});
```

Power configuration accepts profile_model_id after restart. Previous resolve_user and automatic options are removed. Channel authorization remains the host's responsibility; this is a single-owner local system, not a multi-tenant memory service. Switching Federation accounts does not switch User memory.
