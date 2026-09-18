# Memory

Provides long-term memory through one `MemoryPower`.

- Agent Memory stores private Agent knowledge.
- City User Memory is shared across Agents for the same authenticated user.
- City Workspace Memory is shared across Agents using the same Workspace.
- Core Memory is added as named system context; dynamic recall is added only to the current user-message copy.

City only supplies the shared Memory root. Storage, recall, capture, and access isolation remain inside `MemoryPower`.
