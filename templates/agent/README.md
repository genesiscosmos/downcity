# Agent product example

This local single-user application combines the official Downcity backend, `@downcity/city/browser`, and `@downcity/ui`.

From the repository root:

```bash
pnpm install
cp public/templates/agent/.env.example public/templates/agent/.env
```

Set `DEEPSEEK_API_KEY` in that local file. Keep the key on the server. `AGENT_WORKSPACE_PATH` selects the project directory; relative paths resolve from `server/`. `AGENT_STORAGE_PATH` defaults to `~/.downcity-template-agent` and contains private Agent/Session state.

```bash
pnpm --dir public/templates/agent dev
```

Open `http://127.0.0.1:5174`. Vite forwards `/api` and `/agents` to the backend on port 5314. To serve a built frontend from the backend:

```bash
pnpm --dir public/templates/agent build
pnpm --dir public/templates/agent start
```

Open `http://127.0.0.1:5314`. Set `PORT` to change the backend port; update the Vite proxy when using a different development port.

The server composes `City`, `Agent`, `Workspace`, and `LocalStorageProvider`. It restores the latest `chat` Session for this example's Agent and workspace. `/api/chat` returns its address. The browser creates a `RemoteAgent`, obtains that Session, calls `connect_chat_session(session)`, and renders `<ChatPanel runtime={connection.runtime} />`.

The UI supports canonical history, text/tool streaming, public approvals and questions, rich input, stop, and current-process model retry. `load_earlier()` reads older history. Unmount closes the UI subscription and its browser client. Network errors are shown; uncertain submissions are not replayed automatically. Private questions need a host renderer connected to the Agent private submission API. Custom Power UIs and local file paths require host resource resolvers; the default renderer uses fallback text.

This example binds to loopback and validates browser origins. It shares one server-selected Session. A multi-user product must authenticate users and isolate their Agent/Session collections in the backend; Session IDs alone are not authorization.

Validation commands do not start services:

```bash
pnpm --dir public/templates/agent typecheck
pnpm --dir public/templates/agent build
```
