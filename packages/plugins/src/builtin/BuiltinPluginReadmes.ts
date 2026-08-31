/** Downcity 官方 Plugin 的用户说明内容。 */

/** 官方 Plugin 在宿主 Overview 中展示的 Markdown 说明。 */
export const BUILTIN_PLUGIN_READMES = {
  skill: `# Skill Catalog And Loader

Discovers skills available to the Agent, reads their instructions, and adds guidance for selecting the right skill during a task.

## What it provides

- Lists and inspects installed skills.
- Loads skill instructions only when they are relevant.
- Keeps skill discovery separate from the Agent definition.`,
  workboard: `# Workboard Snapshot

Collects structured snapshots of Agent runtime activity so work can be inspected and presented consistently.

The Plugin owns snapshot collection and normalization; it does not change how an Agent executes a task.`,
  contact: `# Contact

Manages trusted relationships with remote Agents and provides the actions required to exchange messages and shared information.

Contact state is stored in the current Agent's private Plugin data directory.`,
  task: `# Task

Creates and manages reusable Agent tasks, trigger definitions, and execution records.

Tasks remain Agent-owned runtime resources and can be scheduled or invoked through the Plugin's actions.`,
  chat: `# Chat

Connects an Agent to external conversations through Telegram, Feishu / Lark, and QQ.

## Profiles and Channels

- Each Profile contains one complete Chat configuration.
- A Channel type can appear once in the same Profile.
- Credentials stay in Plugin configuration and are not copied into \`agent.json\`.`,
  memory: `# Memory

Provides provider-neutral long-term memory with recall, revision, and deletion capabilities.

Memory data belongs to the current Agent and is stored in that Agent's private Plugin runtime directory.`,
  web: `# Web

Provides web search, document reading, and optional browser sessions to an Agent.

Use Profiles to isolate provider endpoints, credentials, and browser settings for different environments.`,
  image: `# Image

Discovers available image models, generates images, and returns structured result metadata.

Use Profiles to keep image service endpoints and credentials separate between environments.`,
  sound: `# Sound

Discovers speech models and provides automatic speech recognition and text-to-speech actions.

Use Profiles to isolate speech service endpoints, models, and credentials.`,
} as const;
