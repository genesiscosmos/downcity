# Downcity

[![npm version](https://img.shields.io/npm/v/downcity.svg)](https://www.npmjs.com/package/downcity)

[![License](https://img.shields.io/github/license/genesiscosmos/downcity.svg)](./LICENSE)

[English](./README.md) | [简体中文](./README.zh-CN.md)

> Agent infrastructure for building and running agent-powered products and workflows.

Downcity provides a reusable runtime for Agents, models, tools, tasks, memory, and permissions. Run multiple Agents in a City, give each Session a project Workspace, and connect models and services through Downtown.

## Why Downcity

- Reuse one runtime across multiple Agents, products, and workflows.
- Keep Agent identities independent of project Workspaces and Session history.
- Connect models and services with explicit source identities and per-connection sign-in.
- Host Agents in a managed City and interact through the CLI, SDK, or your own interface.
- Extend applications with Powers, services, Workspace implementations, and reusable UI components.

## Packages

| Package | Purpose |
| --- | --- |
| `downcity` | CLI bundle: `downcity` / `city` manages local Agents, Workspaces, and the City host; `downtown` manages Downtown servers. |
| `@downcity/city` | City composition, Agent registry, Town connections, Workspace/Shell resources, Powers, storage, RemoteAgent, and HTTP/RPC transport. |
| `@downcity/agent` | Agent and Group execution, Sessions, model/tool loops, and host extension interfaces. |
| `@downcity/downtown` | Downtown server and SDK for models, services, authentication, and user/admin access. Source: `packages/downtown`. |
| `@downcity/type` | Shared protocols for models, Workspaces, Shell, Sessions, and host integrations. |
| `@downcity/powers` | Reusable capabilities including tasks, memory, skills, web, messaging, and presentation. |
| `@downcity/services` | Services for accounts, credits, usage, organizations, feedback, and payments. |
| `@downcity/sandbox-native` | Native OS sandbox implementation for Workspace Shell execution. |
| `@downcity/ui` | React + Tailwind components for Console and host applications. |
| `templates/*` | Agent, local/edge Downtown, and React UI starter applications. |

## Core Capabilities

- Manage Agent identities and registered Workspaces independently in the user-level Downcity data directory.
- Use `downcity on`, `downcity status`, and `downcity off` to manage the CLI City host. Agents share the host lifecycle.
- Create Sessions, send messages, and inspect history through the CLI or SDK.
- Use `downcity towns` to manage independent Downtown connections and discover models and services.
- Combine Workspace file/Shell tools with built-in and application-defined Powers.

## Platform Support

The CLI uses `NativeSandboxProvider` for local Workspace Shell commands.

| Platform | Default local Shell sandbox |
| --- | --- |
| macOS | Seatbelt via `/usr/bin/sandbox-exec` |
| Linux | Bubblewrap via `/usr/bin/bwrap`; install bubblewrap and enable user namespaces |
| Windows | Not supported by the native provider |

The native sandbox uses the project's real absolute path. Filesystem access follows the Workspace, runtime, and toolchain policy; network access is allowed by default. Shell execution checks sandbox availability and fails if isolation is unavailable. Host execution requires explicit approval.

## Quick Start

### 1. Install the CLI

```bash
npm install -g downcity
# or
pnpm add -g downcity
```

Install Node.js and npm (or pnpm) first. The package exposes `downcity` (alias `city`) and the Downtown server manager, `downtown` (alias `town`). `town` and `downtown` share the same entry point; `town deploy` is equivalent to `downtown deploy`:

```bash
downcity --version
```

Upgrade with `npm install -g downcity@latest`. Use `downtown --help` for server management and `downcity --help` for local City commands.

### 2. Connect models and services

You need an accessible Downtown server with a model available to your account. Replace the example URL with your server address:

```bash
downcity towns add https://your-downtown.example.com --name primary
downcity towns list
```

Use the same server URL to sign in. Sign-in is interactive and applies to that connection:

```bash
downcity towns login https://your-downtown.example.com
downcity towns models
downcity towns services
```

### 3. Register a Workspace and create an Agent

Run this inside your project. Replace `MODEL_ID` with the exact `model_id` from `downcity towns models`:

```bash
downcity workspace register .
downcity agent create --id repo-helper --name "Repo Helper" --model MODEL_ID
downcity agent list
```

Workspace registration records the project path. Agent creation stores an independent identity and model selection in the user-level Downcity data directory (default: `~/.downcity`). To change the model, use `downcity agent update repo-helper --model MODEL_ID`.

### 4. Start the City and send a message

```bash
downcity on
downcity status
downcity agent chat repo-helper --workspace-path . --message "Summarize the repository structure"
```

Omit `--message` for an interactive conversation. Chat and Session execution require a running CLI or Desktop City host. With no host running, configuration and history commands remain available.

Use `downcity on --foreground` to run in the current terminal, or `downcity off` to stop the CLI host.

### 5. Authorize SDK access (optional)

```bash
downcity token create --name local-sdk --agents repo-helper
```

The command prompts for the remaining settings, including expiry. Save the Bearer Token when issued; its plaintext is shown once. The default HTTP Agent URL is `http://127.0.0.1:5314/agents/repo-helper`. Use your configured HTTP host and port if different; port `15314` is the separate local RPC endpoint.

## SDK Example

### Local agent

In a Node.js ESM/TypeScript application, install `@downcity/city`, `@downcity/downtown`, and `@downcity/sandbox-native`. Set `OPENAI_API_KEY`, choose a model your provider supports, and replace both absolute paths below with your project and a writable runtime directory. This standalone SDK example supplies its own model and does not require a CLI City host.

```ts
import { Agent, Shell, Workspace } from "@downcity/city";
import { create_openai_compatible_model } from "@downcity/downtown";
import { NativeSandboxProvider } from "@downcity/sandbox-native";

const api_key = process.env.OPENAI_API_KEY;
if (!api_key) throw new Error("Set OPENAI_API_KEY before running this example");

const model = create_openai_compatible_model({
  id: "gpt-5",
  upstream_model: "gpt-5",
  base_url: "https://api.openai.com/v1",
  api_key,
});

const workspace = new Workspace({
  id: "project",
  path: "/path/to/project",
  shell: new Shell({
    sandbox_provider: new NativeSandboxProvider(),
  }),
  runtime_path: "/path/to/downcity-runtime/project",
});
const agent = new Agent({ id: "sdk-repo-helper", model, workspace });

try {
  const session = await agent.sessions.create();
  const turn = await session.prompt({
    query: "Summarize the repository structure",
  });
  const result = await turn.finished;
  if (!result.success) throw new Error(result.error || "Agent turn failed");
  console.log(result.text);
} finally {
  try {
    await agent.dispose();
  } finally {
    await workspace.dispose();
  }
}
```

`@downcity/agent` does not resolve provider or model IDs for you. In SDK mode, the host application creates the model and supplies it as an Agent default or Session override.

### Remote agent

Install `@downcity/city`. Set `DOWNCITY_AGENT_URL` to the full HTTP Agent URL from the quick start and `DOWNCITY_TOKEN` to a City Token authorized for that Agent. The City must be running and the Agent must have an available model. This example creates a Session without project context.

```ts
import { RemoteAgent } from "@downcity/city";

const agent_url = process.env.DOWNCITY_AGENT_URL;
const city_token = process.env.DOWNCITY_TOKEN;
if (!agent_url || !city_token) {
  throw new Error("Set DOWNCITY_AGENT_URL and DOWNCITY_TOKEN");
}

const agent = new RemoteAgent({ url: agent_url, token: city_token });

try {
  const session = await agent.sessions.create();
  const turn = await session.prompt({ query: "Hello, what can you help with?" });
  const result = await turn.finished;
  if (!result.success) throw new Error(result.error || "Agent turn failed");
  console.log(result.text);
} finally {
  await agent.close();
}
```

## Repository Layout

```text
downcity/
├── packages/
│   ├── agent/
│   ├── city/
│   ├── cli/
│   ├── downtown/             # @downcity/downtown
│   ├── implementations/
│   │   ├── databases/
│   │   ├── powers/
│   │   ├── sandboxes/
│   │   ├── services/
│   │   └── workspaces/
│   ├── type/
│   └── ui/
├── templates/
│   ├── agent/
│   ├── edgefed/
│   ├── localfed/
│   └── ui/
├── scripts/
├── package.json
└── pnpm-workspace.yaml
```

The `templates/*` projects are convenient developer starters and showcases. The `ui` template is a standalone React + Vite application for previewing the public `@downcity/ui` components.

## Documentation

- Docs: [downcity.ai/docs](https://downcity.ai/docs)
- City SDK docs: [downcity.ai/city-sdk-docs](https://downcity.ai/city-sdk-docs)
- Agent SDK docs: [downcity.ai/agent-sdk-docs](https://downcity.ai/agent-sdk-docs)
- UI SDK docs: [downcity.ai/ui-sdk-docs](https://downcity.ai/ui-sdk-docs)
- Chinese overview: [README.zh-CN.md](./README.zh-CN.md)
- Package docs: [Agent](./packages/agent/README.md), [City](./packages/city/README.md), [Downtown](./packages/downtown/README.md), [Types](./packages/type/README.md), [Services](./packages/implementations/services/README.md), [CLI](./packages/cli/README.md), [UI](./packages/ui/README.md)

## Local Development

For a standalone clone of this public repository, use Node.js and pnpm `10.22.0` (declared in `package.json`). Install dependencies at the repository root:

```bash
pnpm install
```

If this repository is the `public/` directory of a larger Downcity workspace, install dependencies at the parent workspace root. Run the following public scripts from `public/`.

Build all packages without changing versions or installing the CLI globally:

```bash
pnpm build -- --no-global-install
```

Build individual SDK packages:

```bash
pnpm build:agent
pnpm build:city
```

Typecheck:

```bash
pnpm typecheck
pnpm -C packages/ui typecheck
```

Development entry points (choose the one you need):

```bash
pnpm dev:cli
pnpm dev:agent
pnpm dev:powers
pnpm dev:ui-sdk
pnpm dev:ui-template
```

## Security and Runtime Notes

- Downcity can execute shell commands, read and write project files, start local daemons, and receive external messages through chat channels.
- Local Workspace shell and script commands use the native sandbox by default. Project files are writable; commands can modify real files. Inspect the active sandbox policy before granting additional paths.
- Use a clean Git branch and audit changes with `git status` and `git diff`.
- Keep secrets out of the repository; prefer local environment variables or `downcity env`.
- Use tokens and auth boundaries for Console, HTTP access, and chat channel integrations.
- Host-level installation and system configuration require an explicitly approved host operation.
