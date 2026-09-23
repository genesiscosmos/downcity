# Skills

Discovers the skills assigned to an Agent, reads their instructions, and injects the Agent skill inventory into the system prompt.

## What it provides

- Lists and reads the skills in the calling Agent's own skill directory.
- Reads project and home skill directories on demand through an explicit scope.
- Keeps skill discovery separate from the Agent definition.

## Storage

Each Agent owns `~/.downcity/agents/<agent-id>/skills`. A skill is a directory containing `SKILL.md`, either copied in or linked from another source. The Agent's shell is granted write access to this path, so the Agent can install and link skills itself.

## Desktop

The Power page works without a Profile. Its Sidebar lists every Agent, and each Agent shows its own skills. The Agent Mainview has three views: Bound skills, the global catalog from the user directory and each Workspace with link state, and Discover for searching and installing through the `skills` CLI.
