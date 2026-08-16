# Downcity Desktop

Downcity Desktop 与 CLI 共享 `~/.downcity/agents/`、`~/.downcity/plugins/` 中的文件型定义，以及 `downcity.db` 中的 Workspace、Token 与平台状态。Electron main 直接创建 native `Agent`，并由进程内 `City` 统一管理生命周期；它不执行 CLI 命令，也不连接 CLI daemon。

Agent 与 Workspace 是独立记录。Desktop 在执行时让 Agent 进入指定 Workspace，Session、日志、Shell、Sandbox 与 Plugin 状态统一保存在 `~/.downcity/agents/<agent_id>/workspaces/<workspace_id>/`，不写入项目目录。

## 对话与用户状态

Desktop 直接订阅 `SessionMutation`，以 canonical `SessionMessage` 展示流式文本、推理、Tool、审批、问题、文件与错误。发送请求只等待 Session 接受输入；Turn 运行态、停止与最终结果通过独立 IPC 事件同步。一个 Session 执行期间的新输入由 Renderer 队列管理，切换 Session 时分别保留草稿与队列。

设置和 Federation 用户 Session 属于 Desktop/CLI 共享的用户级控制面，不写入项目目录。如果 Token 来自 `DOWNCITY_USER_TOKEN` 环境变量，Desktop 只读使用该身份，不能在界面中清除环境变量。

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
