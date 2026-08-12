# @downcity/agent-registry

Downcity CLI 与 Desktop 共用的内部 Agent 与 Workspace 注册仓储。它维护用户级 `downcity.db` 中的 Agent 配置和独立 Workspace 目录，不在二者之间建立永久绑定，也不负责 Agent、Session 或 daemon 的运行生命周期。

Agent 与 Workspace 只在宿主创建一次 Runtime 时显式组合。Session 继续保存在具体 Workspace 的 `.downcity/agents/<agent_id>/sessions/` 下。

该 package 由 Downcity 宿主使用，不作为 Agent SDK 的组成部分。
