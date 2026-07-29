# CLI Plugin 管理与动态安装重设计

> 状态：已实施
>
> 更新时间：2026-07-29

## 1. 产品意图

City Plugin 管理解决三个问题：

- 用户如何从可信来源安装一个或多个 Plugin。
- 一个 Agent 如何独立启用和配置 Plugin。
- Plugin 如何声明、解析和复用完整 Resource Item。

公开领域只有 Plugin。来源、共享入口、文件完整性和安装目录属于 CLI 内部生命周期，不形成 Project、Package 或 Factory 公开抽象。

## 2. 最终模型

```text
plugins[]
  └── Plugin constructor
        ├── static manifest
        ├── static resolve_resource?()
        └── new Plugin({ config, resources })
```

职责：

- `Plugin.manifest`：Plugin 名称、展示信息、Config Schema 和 Resource Schema。
- `Plugin.resolve_resource`：创建或刷新 Resource 时补全动态字段。
- CLI：安装、校验、按名称索引、解析 Resource ID 并实例化 Plugin。
- Agent SDK：只接收已经创建的 `Plugin[]`。

`PluginFactory`、`PluginProjectRuntime` 和 `plugin_project.plugins[name].create()` 均不存在。

## 3. Plugin constructor 协议

```ts
export class GithubPlugin extends BasePlugin {
  static readonly manifest = {
    name: "github",
    version: "1.0.0",
    title: "GitHub",
    actions: [],
    config: {
      schema: GITHUB_CONFIG_JSON_SCHEMA,
      defaults: {},
    },
    resources: {
      schema: GITHUB_RESOURCE_JSON_SCHEMA,
    },
  };

  static async resolve_resource({ resource }) {
    const user = await github_get_user(resource.token);
    return { name: user.name, login: user.login };
  }

  constructor({ config, resources }) {
    super();
  }
}

export const plugins = [GithubPlugin, LinearPlugin];
```

入口只导出 constructor 数组。CLI 用 `Plugin.manifest.name` 建立索引，并统一执行：

```ts
new plugin_type({ config, resources });
```

实例 `name` 必须与静态 Manifest `name` 一致。

## 4. 静态安装清单

安装阶段不能执行第三方入口，因此仓库必须提交由 Plugin 静态 Manifest 生成的 `downcity.plugin.json`：

```json
{
  "manifest_version": 2,
  "entry": "dist/index.js",
  "plugins": [
    {
      "name": "github",
      "version": "1.0.0",
      "title": "GitHub",
      "actions": [],
      "config": {
        "schema": { "type": "object" },
        "defaults": {}
      },
      "resources": {
        "schema": { "type": "object" }
      }
    }
  ]
}
```

JSON Schema 直接内嵌，不再维护额外 Schema 路径协议。作者可以用 Zod 维护源码 Schema，并在构建时通过 `z.toJSONSchema()` 写入静态 Manifest 和安装清单。

CLI 安装时校验静态 JSON；运行时再比较 constructor 的静态 Manifest 与安装快照，防止两者漂移。

## 5. Resource 生命周期

```text
用户字段
  → CLI 生成 id
  → PluginType.resolve_resource?()
  → 完整 Schema 校验
  → 加密保存 Resource Item
```

Resolver 是 Plugin constructor 的静态能力，不属于 Plugin 实例。Agent 启动不执行 Resolver，只按 Binding 中的 `resource_ids` 读取已保存 Item，然后传给 constructor。

## 6. 安装生命周期

一个入口可以导出多个 Plugin。CLI 内部使用 installation 记录共同管理来源、入口路径、Git commit、完整性摘要和安装目录，但 installation 不进入 Catalog、Binding、Resource 或 Runtime API。

```text
公开模型：Plugin
内部实现：installation → plugins[]
```

安装支持本地目录、Git URL 和 `github:owner/repository#ref`。更新任一 Plugin 会原子更新其共享入口中的全部 Plugin；卸载任一 Plugin 会卸载同一入口中的全部 Plugin，并在操作前检查所有兄弟 Plugin 的 Binding 和 Resource。

```bash
city plugin install <source>
city plugin update <plugin_name>
city plugin uninstall <plugin_name>
city plugin config <plugin_name> [agent_id]
city plugin resource create <plugin_name>
```

## 7. Built-in

内建 Chat、Image、Sound 等也被转换为同一种 Plugin constructor 数组。City 专属依赖只在 Loader 边界通过 constructor adapter 注入；Catalog、Resource Service 和 Agent 装配器不包含 built-in/external 或 Chat 分支。

## 8. 生效与信任边界

安装过程不执行 `npm install`、构建脚本、生命周期脚本或 Plugin 入口。Plugin 必须提交自包含 ESM 制品。

Resource 创建、编辑和刷新在完整校验后原子保存。Binding 或 Resource 修改不会热替换运行中的 Plugin，下一次 Agent 装配时生效。

旧 Project Runtime 和旧单 Plugin Factory 不保留兼容加载器；旧安装记录会被删除，Binding 与 Resource 保留。
