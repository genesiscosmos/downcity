# Downcity Desktop

Downcity Desktop 是 Downcity CLI 的图形客户端。它与 CLI 共享 `~/.downcity/downcity.db` 中的 Agent Registry，并通过 CLI 启动的本机 daemon RPC 访问 Agent Session。

运行 Desktop 前需要确保 `downcity` 命令已经安装并可从当前系统 `PATH` 找到。

## 开发

先完成根目录依赖安装，然后运行：

```bash
pnpm dev:desktop
```

生产构建：

```bash
pnpm build:desktop
```

当前客户端提供 Agent 列表、Agent 创建、daemon 启动、Session 创建和基础聊天能力。Renderer 只能通过 Preload 暴露的最小 IPC API 访问这些能力。
