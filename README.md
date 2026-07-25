# Downcity

[![Publish packages](https://github.com/wangenius/downcity/actions/workflows/publish-packages.yml/badge.svg)](https://github.com/wangenius/downcity/actions/workflows/publish-packages.yml)
[![Publish CLI](https://github.com/wangenius/downcity/actions/workflows/publish-downcity.yml/badge.svg)](https://github.com/wangenius/downcity/actions/workflows/publish-downcity.yml)
[![npm version](https://img.shields.io/npm/v/downcity.svg)](https://www.npmjs.com/package/downcity)
[![License](https://img.shields.io/github/license/wangenius/downcity.svg)](./LICENSE)

[English](./README.md) | [简体中文](./README.zh-CN.md)

> Agent infrastructure for AI builders shipping many agent-powered products and workflows.

Downcity gives creators, indie builders, and teams one reusable runtime layer for agents, models, tools, tasks, memory, plugins, City, permissions, usage, billing, and control surfaces. Instead of rebuilding the same agent backend for every new AI product, you can run many agents, products, and workflows on one infrastructure stack.

## Why Downcity

- Built for AI builders: create the next agent product without rebuilding model routing, tools, memory, tasks, auth, usage, billing, and operations again.
- Reusable runtime layer: a repo or folder can become an agent boundary, while Downcity owns the broader infrastructure for long-running agents.
- City: centralize model catalogs, runtime env, service routing, accounts, balance, usage, payment, and HTTP access.
- Operable agents: run agents as managed daemons, inspect status, review history, and interact through CLI or SDK.
- Extensible architecture: plugins, services, SDK APIs, and UI components are explicit integration surfaces for products and teams.

## Packages

| Package | Purpose |
| --- | --- |
| `downcity` | Public CLI bundle with `city`/`downcity` for global Agent hosting and `fed`/`downfed` for project-associated Federation administration. |
| `@downcity/agent` | Single-agent runtime and SDK for sessions, tool loops, services, plugins, HTTP/RPC, sandboxing, and host integration. |
| `@downcity/city` | City runtime and access SDK for Service registration, Actions, auth, env, city-scoped access, and HTTP calling. |
| `@downcity/type` | Shared protocol types used across packages, including City model descriptors returned by City. |
| `@downcity/services` | Public services for accounts, balance, usage, payment, and Stripe payment flows. |
| `@downcity/ui` | React + Tailwind UI SDK for reusable Console and host-application components. |
| `templates/*` | Developer-friendly City starter compositions for Node or edge runtimes; official private deployments live outside this repository. |
| `homepage` | Official website and end-user documentation site. |

## Core Capabilities

- Global Agent management: store Agent identity and config in `~/.downcity/downcity.db`, while binding each Agent to any Workspace path.
- Local agent operations: run `downcity agent start`, `downcity agent status`, and `downcity agent list` to host and inspect local agents.
- Agent lifecycle: create, start, stop, restart, inspect, chat with, diagnose, and observe project agents.
- City connection: use `downcity federation` to connect local Agents to the active City server; manage City models and Service resources with `city`.
- City backend capabilities: reuse accounts, balance, usage, payment, env, auth, and Service routing across agents and products.
- Built-in agent capabilities: `chat`, `task`, `memory`, `shell`, `contact`, `skill`, `web`, `sound`, and `workboard`.
- Product surfaces: Downcity CLI, Agent SDK, City SDK, and UI SDK.

## Platform Support

| Platform | Local Agent and Safe Sandbox |
| --- | --- |
| macOS | Supported with Seatbelt |
| Linux | Supported with Bubblewrap |
| Windows 11 24H2+ | Development / unstable with Microsoft MXC and native `cmd.exe` execution |

Native Windows uses `cmd.exe /d /s /c` inside the Microsoft MXC `processcontainer` backend. Preflight requires Windows build 26100 or newer and a successful MXC isolation-tier probe; failures never fall back to unrestricted execution. MXC is currently Public Preview and is not presented as a production security boundary. See the Agent SDK Shell documentation for current limitations.

## Quick Start

### 1. Install the CLI

```bash
npm install -g downcity
# or
pnpm add -g downcity
```

The package exposes the `downcity` command (alias `city`):

```bash
downcity --version
```

`downcity` hosts and manages local Agents and administers the City. Use `downcity update` to upgrade the global CLI.

### 2. Initialize the platform

```bash
downcity init
```

This sets up the global Downcity storage and configuration, by default under `~/.downcity/`.

### 3. Connect to City

```bash
downcity federation use
downcity federation status
```

`downcity` manages City models and Service resources. `downcity federation` imports the active City connection for local Agent runtime use.

### 4. Create an agent project

Run this inside the target repository:

```bash
downcity agent create .
```

This creates Workspace assets without an Agent declaration file; Agent identity and config stay in the global database:

```text
your-project/
├── .agents/
│   └── skills/
└── .downcity/
    ├── agents/
    ├── chat/
    ├── memory/
    └── task/
```

### 5. Start the agent and talk to it

```bash
downcity agent list
downcity agent start
downcity agent status
downcity agent chat -m "Summarize this repository"
downcity agent chat --new-session
```

Interactive chat can also pick an existing session or create a new one before the TUI opens.

To run in the foreground:

```bash
downcity agent start --foreground
```

### 6. Inspect running agents

```bash
downcity agent list
```

Useful status commands:

```bash
downcity agent list
downcity agent status
```

## SDK Example

### Local agent

```ts
import { Agent, Workspace } from "@downcity/agent";
import { Shell } from "@downcity/shell";
import { MacOsSeatbeltSandbox } from "@downcity/sandbox-macos";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const agent = new Agent({
  id: "repo-helper",
  workspace: new Workspace({
    path: "/path/to/project",
    shell: new Shell({ sandbox: new MacOsSeatbeltSandbox() }),
  }),
  tools: {},
});

const session = await agent.session();
await session.set({
  model: openai.responses("gpt-5"),
});

const turn = await session.prompt({
  query: "Summarize the repository structure",
});
const result = await turn.finished;

console.log(result.text);
```

`@downcity/agent` does not resolve provider or model IDs for you. In SDK mode, the host application creates the model and injects it into the session.

### Remote agent

```ts
import { RemoteAgent } from "@downcity/agent";

const agent = new RemoteAgent({
  baseUrl: "http://127.0.0.1:15314",
});

const session = await agent.session();
const turn = await session.prompt({
  query: "Check the latest task execution status",
});
const result = await turn.finished;

console.log(result.text);
```

## Repository Layout

```text
downcity/
├── packages/
│   ├── agent/
│   ├── city/
│   ├── cli/
│   ├── services/
│   ├── type/
│   └── ui/
├── templates/
│   ├── edge/
│   └── node/
├── homepage/
├── scripts/
├── package.json
└── pnpm-workspace.yaml
```

The `templates/*` projects are kept as convenient developer starters. They are not the private official production deployments.

## Documentation

- Docs: [downcity.ai/docs](https://downcity.ai/docs)
- City SDK docs: [downcity.ai/city-sdk-docs](https://downcity.ai/city-sdk-docs)
- Agent SDK docs: [downcity.ai/agent-sdk-docs](https://downcity.ai/agent-sdk-docs)
- UI SDK docs: [downcity.ai/ui-sdk-docs](https://downcity.ai/ui-sdk-docs)
- Chinese overview: [README.zh-CN.md](./README.zh-CN.md)
- Package docs: [packages/agent/README.md](./packages/agent/README.md), [packages/city/README.md](./packages/city/README.md), [packages/type/README.md](./packages/type/README.md), [packages/services/README.md](./packages/services/README.md), [packages/cli/README.md](./packages/cli/README.md), [packages/ui/README.md](./packages/ui/README.md)

## Local Development

Install dependencies:

```bash
pnpm install
```

Build:

```bash
pnpm build
pnpm build:agent
pnpm build:city
pnpm build:homepage
```

Typecheck:

```bash
pnpm typecheck
pnpm -C packages/ui typecheck
pnpm -C homepage typecheck
```

Run in development mode:

```bash
pnpm dev:city
pnpm dev:agent
pnpm dev:ui-sdk
pnpm dev:homepage
```

## Security and Runtime Notes

- Downcity can execute shell commands, read and write project files, start local daemons, and receive external messages through chat channels.
- Local shell and script commands run through the agent sandbox by default. The project is writable, network is open, and sandbox HOME/cache lives at `.downcity/sandbox`.
- Use a clean Git branch and audit changes with `git status` and `git diff`.
- Keep secrets out of the repository; prefer local environment variables or `downcity env`.
- Use tokens and auth boundaries for Console, HTTP access, and chat channel integrations.
- Host-level installs such as `sudo`, `brew install`, Xcode tools, and writes to system directories are outside the sandbox boundary.
