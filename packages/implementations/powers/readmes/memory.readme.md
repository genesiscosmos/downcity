# Memory

Provides long-term memory through one `MemoryPower`.

- Agent Memory is private to one Agent and lives in its own store.
- City Memory is shared across every Agent in the same City.
- Workspace is not a memory scope; the current `workspace_id` is stored as record metadata when available.
- Agent memory, recall, and turn capture also work in conversations without a Workspace, including Feishu chats.
- Core Memory is added as named system context; dynamic recall is added only to the current user-message copy.

City supplies the shared Memory root. Agent private roots are derived from the platform root, and storage, recall, capture, and access isolation all remain inside `MemoryPower`.

## Storage layout

Agent private memory and shared memory are physically separated:

```text
<platform-root>/agents/<agent_id>/memory/   Agent private
<platform-root>/powers/memory/              Shared across Agents
```

Both roots use the same three namespaces: `wiki/` for long-term memories, `evidence/` for raw evidence, and `capture-jobs/` for pending automatic captures.

`memory_id` stays a logical reference such as `agent/<agent_id>/wiki/<topic>` or `city/wiki/<topic>`. It is not a physical path; `read`, `revise`, and `forget` should reuse it as returned.

## Desktop workspace

Memory contributes a first-class entry to the Desktop navigation rail with a Sidebar and Mainview:

- **Sidebar** does one thing: it lists the memory scopes flat, `Shared` first and then one row per Agent, each showing only its memory count. Selecting a scope decides both what the Mainview lists and where new memories are written.
- **Mainview** has three in-place views. The list shows the memories of the selected scope; opening one shows a Markdown detail page with `memory_id`, type, subject, observed time, citation, and evidence count; the `Settings` button switches to a read-only view of the Provider, its capabilities, and the storage counts. New, revise, and delete are available in place.

Settings stay inside the workspace. Opening them never leaves the Memory workspace for the global Powers catalog.

A scope and the Agent that executes it are separate. Selecting `Shared` still runs through a real Agent, because every memory action is bound to an Agent; the workspace falls back to the first registered Agent.

Every read and write goes through the host action on the selected Agent and Workspace, so what the workspace shows is exactly what the Agent can read.
