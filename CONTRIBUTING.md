# Contributing to Downcity

Thanks for helping improve Downcity. This repository is a TypeScript monorepo for the Downcity agent runtime, City runtime, services, CLI tools, UI SDK, product surfaces, and documentation site.

## Project Shape

- `packages/agent`: single-agent runtime and SDK.
- `packages/agent`: City runtime and access SDK.
- `packages/services`: accounts, balance, usage, billing, and payment services.
- `packages/type`: shared protocol types.
- `packages/ui`: React UI SDK.
- `packages/cli`: public command-line packages.
- `templates/*`: deployable City compositions.
- `homepage`: public website and user-facing docs.

## Before You Start

1. Open an issue for larger changes so the API shape, package boundary, and documentation impact can be discussed first.
2. Keep changes small and scoped. Prefer existing package patterns over new abstractions.
3. Do not mix unrelated formatting, refactors, or generated output into the same pull request.

## Local Setup

```bash
pnpm install
pnpm typecheck
```

Common build targets:

```bash
pnpm build
pnpm build:agent
pnpm build:city
pnpm build:services
pnpm build:cli
pnpm build:homepage
```

## Code Guidelines

- Keep modules focused and split files before they become hard to review.
- Put shared TypeScript types under the package-level `types/` directory when creating new type modules.
- Add clear module documentation to new modules.
- Use concise comments for important logic and write key implementation comments in Chinese.
- Prefer explicit imports and stable package boundaries.
- Avoid dynamic imports unless there is a concrete runtime reason.

## User-Facing Changes

When a package change affects public SDK APIs, CLI behavior, service behavior, or user-visible documentation, update the relevant docs in `homepage`.

Before submitting a package change that is intended for release, run the matching patch build script:

```bash
pnpm agent:patch:build
pnpm services:patch:build
pnpm cli:patch:build
pnpm all:patch:build
```

Use `pnpm patch:build -- --no-bump ...` only for validation when no version bump is needed.

## Pull Request Checklist

- The change is scoped to one clear purpose.
- Public behavior changes are documented.
- Relevant typecheck, build, or test commands pass.
- Generated files and version bumps are included only when required.
- The pull request explains what changed, why it changed, and how it was verified.
