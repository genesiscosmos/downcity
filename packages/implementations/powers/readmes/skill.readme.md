# Skills

Manages Skills and MCP servers in one Power. Discovers an Agent's assigned skills, reads their instructions, and exposes tools from the Agent's assigned MCP servers.

## What it provides

- Lists and reads the skills in the calling Agent's own skill directory.
- Reads project and home skill directories on demand through an explicit scope.
- Lists assigned MCP servers, discovers their tools, and calls those tools through `servers`, `tools`, and `call`.
- Keeps global resource management separate from each Agent's capability assignments.

## Storage

Each Agent owns `~/.downcity/agents/<agent-id>/skills`. A skill is a directory containing `SKILL.md`, either copied in or linked from another source. The Agent's shell is granted write access to this path, so the Agent can install and link skills itself.

## Desktop

The Skill Power Sidebar lists individual resources in Skills and MCP groups. Select a resource to inspect its contents or connection status. MCP server files are managed through the Power's configuration page.

The Skills tab in Agent Profile manages that Agent's skills and MCP server assignments. Link a skill from the user catalog, remove an assigned skill, or enable an MCP server for that Agent. MCP tools require an explicit Agent assignment.

Global MCP definitions and OAuth credentials remain in the MCP storage directory. Per-Agent MCP assignments live in `~/.downcity/agents/<agent-id>/mcp-servers.json`.
