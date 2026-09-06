# CLI Plugin 管理设计

## 1. 目标

CLI 管理 City 的 Plugin Catalog、第三方制品和每个 Plugin 的唯一配置。Agent 命令不管理 Plugin 绑定。

## 2. 命令

```text
city plugin list
city plugin show <plugin_id>
city plugin config <plugin_id>
city plugin config <plugin_id> --set '<json-object>'
city plugin install <source>
city plugin update <plugin_id>
city plugin uninstall <plugin_id>
```

`config --set` 原子替换完整 JSON object。CLI 不根据 Schema 猜测通用表单，也不打印敏感配置值。

## 3. 本地事实源

```text
~/.downcity/
├── agents/<agent_id>/
│   ├── agent.json
│   └── SOUL.md
└── plugins/<plugin_id>/
    ├── config.toml
    ├── plugin.json       # 仅第三方
    ├── package.json      # 仅第三方
    └── 声明的运行制品
```

`agent.json` 不保存 Plugin 引用。`config.toml` 使用 `schema_version = 2` 和唯一 `[config]`。目录权限为 `0700`，配置与 Agent 定义文件权限为 `0600`。

## 4. 生命周期

CLI City 启动时加载全部内置与第三方 Plugin 注册，并交给 City 统一初始化。所有 Agent 自动获得这些 Plugin。安装与保存配置不会执行 Plugin 入口；City 启动或显式加载注册时才执行第三方 `main`。

第三方 Plugin 卸载只检查制品自身状态，不检查 Agent 引用，因为 Agent 不再持有引用。运行中的 City 需要重启后才会重新加载已安装制品。
