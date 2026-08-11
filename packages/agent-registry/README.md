# @downcity/agent-registry

Downcity CLI 与 Desktop 共用的内部 Agent 注册仓储。它维护用户级 `downcity.db` 中的 Agent 身份、Workspace 绑定和宿主配置，不负责 Agent、Session 或 daemon 的运行生命周期。

该 package 由 Downcity 宿主使用，不作为 Agent SDK 的组成部分。
