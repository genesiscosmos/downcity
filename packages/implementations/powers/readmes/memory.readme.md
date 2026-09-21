# Memory

Provides long-term memory through one `MemoryPower`.

- Agent Memory stores private Agent knowledge.
- City User Memory is shared across Agents for the same authenticated user.
- City Workspace Memory is shared across Agents using the same Workspace.
- Core Memory is added as named system context; dynamic recall is added only to the current user-message copy.

City only supplies the shared Memory root. Storage, recall, capture, and access isolation remain inside `MemoryPower`.

## Desktop workspace

Memory declares no Config. It contributes a first-class entry to the Desktop navigation rail with a Sidebar and Mainview:

- **Agents** lists every registered Agent; selecting one binds the workspace to that Agent and its first Workspace.
- **Scopes** lists all readable memories plus per-subject counts (`Agent`, `User`, `Workspace`, `City`). Selecting a scope filters the list and decides the write target of new memories.
- **Mainview** filters by keyword and memory type, recalls by query, and opens any memory as a Markdown detail page with `memory_id`, type, subject, observed time, citation, and evidence references. New, revise, and delete are available in place.

Every read and write goes through the host action on the selected Agent and Workspace, so what the workspace shows is exactly what the Agent can read.
