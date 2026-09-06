# Plugin SDK 与宿主统一加载设计

## 1. 产品意图

Plugin 是 City 提供给所有 Agent 的扩展能力。Agent 不安装、启用、禁用或配置 Plugin；它只维护身份、模型、指令、自定义 Tools 与 Session。

## 2. 所有权

```text
City
├── Plugin Registry
│   └── Plugin ID → 唯一实例
├── Plugin Config
│   └── Plugin ID → 唯一 JSON object
├── Plugin Lifecycle Storage
└── Agent / Workspace Registry

Agent
└── Session
    └── PluginContext(agent, workspace, session, turn, config snapshot)
```

City 负责 Plugin 实例的 `initialize` 与 `dispose`。所有已注册 Plugin 自动提供给所有 Agent。Agent 与 Workspace 的增删不会创建或销毁 Plugin 实例。

## 3. 配置

每个 Plugin 只有一份 City 级配置：

```toml
schema_version = 2

[config]
endpoint = "https://example.com"
```

宿主通过 `CityPluginHost.config(plugin_id)` 提供同步读取、异步原子替换的配置端口。City 为每次 Action、Hook、System 与 Availability 调用创建新的 `PluginContext`，并把当前配置快照放入 `context.config`。

City 不提供通用命名 Profile。多账号、多租户或多端点属于具体 Plugin 的配置结构，由 Plugin 自己定义选择规则。

## 4. 配置动作

Plugin 在 `initialize()` 中注册配置动作：

```ts
class GithubPlugin extends Plugin {
  readonly name = "github";

  initialize(context: PluginLifecycleContext) {
    context.plugin.config_action({
      id: "config.read",
      run: async (_input, action_context) => action_context.config.get(),
    });
    context.plugin.config_action({
      id: "config.save",
      run: async (input, action_context) => {
        const config = validate_config(input);
        await action_context.config.set(config);
        await this.refresh_resources();
        return config;
      },
    });
  }
}
```

配置持久化成功后，具体 Plugin 必须关闭或刷新由旧配置创建的长期连接、Timer、Worker 与客户端。下一次调用再按新配置惰性创建资源。

## 5. 本地安装协议

第三方 `plugin.json` 可以声明：

- `main`：默认导出一个 Plugin 实例。
- `renderer`：声明成对的 Sidebar/Mainview 和独立 Config 插槽。
- `readme`、`icon`、版本与安装来源。

Renderer 的 Sidebar/Mainview 使用 `plugin.invoke()`，Config 使用 `config.invoke()`。Renderer 不获得 Desktop controller、Node、Electron 或配置存储对象。

## 6. 失败语义

- 重复 Plugin ID 在加入 City 时失败。
- 初始化失败的 Plugin 不进入执行 Registry，但保留错误快照供宿主展示。
- 单个 Plugin 初始化失败不阻止 Desktop 继续启动。
- 移除或关闭 Plugin 时，City 等待既有 execution lease 释放后再调用 `dispose`。
- 本地配置格式无效时明确报错，不静默回退空配置。
