# @downcity/type

`@downcity/type` 是 Downcity 跨 package 的共享协议类型包。

它只放需要被多个 package 共同识别的核心协议，避免 `@downcity/agent`、`@downcity/agent`、`@downcity/services` 之间产生不必要的直接耦合。

## 当前协议

- `CityModelDescriptor`：City 模型目录返回的公开模型信息。
- `CityModel`：User City 返回的可执行 City 模型，可被支持 City model 的 SDK 直接消费。
- `isCityModel()`：判断一个值是否实现 City model 协议。
- `ToolEffect`：Tool 向宿主报告已经发生、需要在当前 Turn 内收集的结构化副作用。
- `AgentTool` / `ToolCallContext`：Agent 可调用工具的协议与执行时注入的调用环境。
- `ToolHookSet`：扩展能力按检查点贡献内容的处理器集合。
