# Downcity Desktop

Downcity Desktop 与 CLI 共享 `~/.downcity/downcity.db` 中的 Agent、Workspace、Plugin 与 Embassy 配置。Electron main 直接创建 native `Agent`，并由进程内 `City` 统一管理生命周期；它不执行 CLI 命令，也不连接 CLI daemon。

Agent 与 Workspace 是独立记录。Desktop 在装配 Agent 时显式选择 Workspace，Session 继续保存在该 Workspace 的 `.downcity/agents/<agent_id>/sessions/` 下。

## 开发

先完成根目录依赖安装，然后运行：

```bash
pnpm dev:desktop
```

生产构建：

```bash
pnpm build:desktop
```

当前客户端提供 Agent 与 Workspace 列表、Agent 创建、native Agent 装配、Session 创建和基础聊天能力。Renderer 只能通过 Preload 暴露的最小 IPC API 访问这些能力。
