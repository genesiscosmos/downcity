# Plugin SDK、City 与 Agent 统一加载设计

> 状态：已实现
>
> 适用范围：`@downcity/agent`、`@downcity/local`、`@downcity/plugins`、CLI Plugin Loader、第三方 Plugin 开发文档
>
> 本文档覆盖并修正现有文档中“Plugin constructor 必须接收 profile”以及“安装器直接实例化 constructor”的约定。
>
> 当前约定：Plugin 包通过 `plugin.json` 指向 `setup.ts` 构建产物；`setup.ts` 导出 `schema` 和 `setup`。City 负责 Plugin 的安装、配置、发现与装配，Agent 负责已装配实例的运行和生命周期。

## 1. 设计目标

Plugin 需要同时支持两种使用方式：

1. SDK 用户直接使用 Plugin Class，并由 Plugin 作者自由设计构造参数。
2. CLI、Desktop 和其他通用宿主能够发现、配置和加载未知的第三方 Plugin。

目标 API：

```ts
// SDK：参数完全由 Plugin 自己定义。
const web_plugin = new WebPlugin(
  new WebProvider("playwright"),
);

const agent = new Agent({
  id: "coding-pro",
  model,
  plugins: [web_plugin],
});
```

```text
// CLI：不猜测 Plugin constructor 参数。
读取 plugin.json
→ 读取 profile schema
→ 校验宿主配置
→ City 调用 setup()
→ 得到新的 Plugin 实例
→ 交给 Agent
```

## 2. 核心结论

### 2.1 Plugin Class 不接收框架规定的 profile

`profile` 不是 SDK Plugin 的领域概念。

Plugin Class 可以使用任何适合自身职责的参数：

```ts
new WebPlugin(provider);
new CodingPlugin(shell, file_store);
new MemoryPlugin(database);
new SimplePlugin();
```

框架不规定以下内容：

- constructor 参数数量；
- constructor 参数名称；
- 是否需要配置；
- 是否需要外部 Provider；
- 是否需要运行时对象；
- 是否必须继承某个基类。

SDK 用户创建的 Plugin 实例必须是独立实例。不能导出一个被多个 Agent 共享的全局单例。

### 2.2 Plugin 暴露 `schema` 和 `setup`

为了让 City 加载未知 Plugin，Plugin 包必须提供一个宿主适配入口：

```ts
export const schema = {
  type: "object",
  properties: {
    browser: {
      type: "string",
      enum: ["playwright", "remote"],
    },
  },
  additionalProperties: false,
};

export function setup(context: PluginHostContext): WebPlugin {
  if (!context.embassy) throw new Error("Web Plugin requires an authenticated Embassy");
  const provider = new WebProvider(
    context.profile.browser ?? "playwright",
    context.embassy.user,
  );

  return new WebPlugin(provider);
}
```

`setup` 是 City 到 Plugin 的装配边界，不是 Plugin 的运行生命周期：

- 每次调用都创建一个新的 Plugin 实例；
- 不注册全局状态；
- 不修改 Agent 或 Registry；
- 不执行安装任务；
- 不负责 Plugin 的 `start` 或 `stop`；
- 可以把 City 宿主能力转换成 Plugin 自己需要的 Provider。

Plugin Class 仍然是实际能力和状态的拥有者，`setup` 只负责装配。

### 2.3 City 与 Agent 的职责

City 是 Plugin 的控制面，负责：

- 安装和卸载 Plugin 包；
- 读取 `plugin.json`；
- 持久化和管理 Plugin 配置；
- 校验 `schema`；
- 创建 `PluginHostContext`；
- 调用 Plugin 的 `setup`；
- 将新创建的 Plugin 实例交给 Agent。

Agent 是 Plugin 的运行面，负责：

- 持有 Plugin 实例；
- 注册 Action、Hook、System 和 HTTP 能力；
- 管理 `start`、`stop` 及 Workspace 生命周期；
- 为每次 Action 提供 Agent 执行上下文；
- 隔离不同 Agent 的 Plugin 实例和运行状态。

City 不持有 Agent 执行期间的 Plugin 单例，Agent 也不负责读取安装目录或解释 Plugin 配置文件。

依赖方向保持单向：

```text
City  → Agent
City  → Plugin setup
Plugin Class → Agent Plugin contract
Agent ↛ City
```

`@downcity/agent` 不能反向依赖 `@downcity/city`。`PluginHostContext` 由 City 导出，Plugin 的 `setup.ts` 可以依赖它；Agent 只接收 `setup` 返回的 Plugin 实例。

### 2.4 Profile 只属于 City 配置层

这里仍然可以使用 `profile` 这个词，但它只表示：

```text
City/CLI/GUI 保存并交给 Plugin `setup` 的一段配置数据
```

它不再表示：

- Plugin constructor 的固定参数；
- SDK 对外 API；
- Plugin 必须实现的配置类型；
- Agent 内核维护的配置对象。

如果未来需要，也可以把宿主层的 `profile` 改名为 `config`，不影响 SDK Plugin。

## 3. Plugin 包结构

推荐的源码和安装产物结构：

```text
example-plugin/
├── plugin.json
├── package.json
├── README.md
├── icon.png
└── src/
    ├── plugin.ts
    ├── setup.ts
    └── install.ts              # 可选
```

构建后的安装目录可以只保留运行所需文件：

```text
~/.downcity/plugins/web/
├── plugin.json
├── package.json
├── README.md
├── icon.png
├── config.toml                 # City 级 Plugin profile 配置，可选
└── dist/
    └── setup.js
```

`src/`、TypeScript 配置和构建工具不属于安装协议，是否保留由安装来源决定。

不再要求：

- `profiles/` 目录；
- `index.mjs` 固定文件名；
- `setup.ts` 是推荐的源码文件名，实际构建入口由 `plugin.json.setup` 指定；
- `init.ts` 自动执行文件。

文件名可以自由设计，入口由 `plugin.json` 声明。

## 4. `plugin.json` 协议

示例：

```json
{
  "schema_version": 1,
  "id": "web",
  "title": "Web",
  "version": "1.0.0",
  "description": "Web capabilities for an Agent",
  "icon": "./icon.png",
  "setup": "./dist/setup.js"
}
```

字段含义：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `schema_version` | 是 | Plugin manifest 协议版本。 |
| `id` | 是 | 全局稳定 Plugin ID，也是安装目录名和 Registry key。 |
| `title` | 否 | 面向用户的名称；缺省使用 `id`。 |
| `version` | 是 | Plugin 版本。 |
| `description` | 是 | Plugin 用途说明。 |
| `icon` | 否 | `http(s)` 地址或 Plugin 根目录内的相对资源。 |
| `setup` | 是 | 导出 `schema` 和 `setup` 的 ESM 入口。文件名不固定。 |

`setup` 模块必须导出：

```ts
export const schema: JsonObject;
export function setup(context: PluginHostContext): Plugin;
```

可以同时导出 SDK Class，但 CLI 不依赖它：

```ts
export { WebPlugin } from "./plugin.js";
export { schema, setup } from "./setup.js";
```

## 5. `setup` 协议

### 5.1 输入

`setup` 接收由 `@downcity/city` 导出的宿主上下文：

```ts
export interface PluginHostContext {
  /** 当前 Plugin 的稳定 ID。 */
  readonly plugin_id: string;

  /** City 读取并通过 schema 校验后的 Plugin 配置。 */
  readonly profile: JsonObject;

  /** 当前用户的 Embassy 访问能力。 */
  readonly embassy?: Embassy;

  /** Plugin 运行时私有数据目录，不用于存放 City 管理的 profile 配置。 */
  readonly data_path: string;

  /** City 提供的日志器。 */
  readonly logger: Logger;

  /** City 为未来宿主能力保留的显式扩展区。 */
  readonly extensions: Readonly<Record<string, unknown>>;
}
```

`PluginHostContext` 由 `@downcity/city` 导出。它不是 Plugin 实例，也不是 Agent 全量对象。在已登录的 City 宿主中，第一阶段保证的外部身份能力为：

```ts
context.embassy.user
```

Plugin 可以从中创建自己的 Provider，例如 `WebProvider`、AI 访问器或业务 Service Client。Plugin 不得修改或关闭 Embassy。

`extensions` 只用于 City 未来增加明确命名的宿主能力。它不是通用 Service Container；每个扩展必须有独立的能力语义、权限边界和文档，不允许 Plugin 猜测或遍历未知扩展。

Workspace 文件、Shell、Session 和当前 Action 执行信息仍然由 Agent action context 提供，不通过 `setup` 复制一份。

### 5.2 输出

```ts
export type PluginSetupResult = Plugin | Promise<Plugin>;
```

允许异步创建，但必须明确原因，例如读取 Plugin 私有配置或初始化一个 Plugin 自有 Provider。不得在 `setup` 中启动脱离生命周期管理的后台 Worker。

### 5.3 示例

```ts
export function setup(context: PluginHostContext): WebPlugin {
  const { profile } = context;
  const browser = profile.browser === "remote"
    ? new RemoteBrowserProvider(context.embassy.user)
    : new PlaywrightBrowserProvider();

  return new WebPlugin(browser);
}
```

SDK 用户不需要经过这个 hook：

```ts
const plugin = new WebPlugin(
  new PlaywrightBrowserProvider(),
);
```

## 6. Profile Schema

### 6.1 Schema 的职责

`schema` 只服务于 City 控制面：

- CLI 配置校验；
- Desktop 动态表单；
- 默认值展示；
- Secret 和 `writeOnly` 字段识别；
- 配置升级和错误提示。

Schema 不替代 Plugin 内部的领域校验。Plugin 仍然必须在 `setup` 创建 Provider 或执行 Action 前做必要的业务校验。

### 6.2 Schema 示例

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "browser": {
      "type": "string",
      "enum": ["playwright", "remote"],
      "default": "playwright"
    },
    "endpoint": {
      "type": "string",
      "format": "uri"
    },
    "token": {
      "type": "string",
      "writeOnly": true
    }
  },
  "additionalProperties": false
}
```

Profile 数据由 City 持久化，具体格式不是 SDK Plugin 协议的一部分。当前 CLI 可以继续使用 `config.toml` 作为本地存储，但传给 `setup` 的必须是已经解析后的对象。`config.toml` 属于 Plugin 的 City 级配置，同一个 Plugin 的多个 Agent 可以引用同一个 profile；Agent 只在自己的 `agent.json` 中保存 profile 引用，不复制或拥有这份配置。

## 7. 安装与配置

### 7.1 普通安装

```text
city plugin install <source>
  → 下载到 staging 目录
  → 校验 plugin.json
  → 校验 setup、schema、icon 的路径
  → 校验 package 边界
  → 原子替换 ~/.downcity/plugins/<plugin_id>/
```

普通安装不导入或执行第三方 `setup`，也不自动执行任意脚本。

### 7.2 显式配置

当前安装协议不自动执行 Plugin 脚本。需要用户输入或 OAuth 的流程由 City/CLI 的显式命令负责；Plugin 的 `setup` 只用于实例装配，不替代安装和生命周期。配置页面可以加载 `plugin.json.setup` 并读取导出的 `schema`，但不能调用导出的 `setup` 方法。

## 8. Agent 装配与隔离

SDK Agent API 保持简单：

```ts
const agent = new Agent({
  id: "coding-pro",
  model,
  plugins: [
    new WebPlugin(new PlaywrightBrowserProvider()),
    new CodingPlugin(new LocalShellProvider()),
  ],
});
```

通用宿主的装配方式：

```ts
const plugin_module = await load_plugin_setup(manifest.setup);
const plugin = await plugin_module.setup({
  plugin_id: manifest.id,
  profile: stored_profile,
  embassy,
  data_path: plugin_data_path,
  logger,
  extensions: {},
});

const agent = new Agent({
  id,
  model,
  plugins: [plugin],
});
```

Agent 只持有 Plugin 实例，不关心实例来自 SDK、CLI 还是远程安装。

配置与运行时数据必须分离。City 从全局的 `~/.downcity/plugins/<plugin_id>/config.toml` 读取 profile，并在每次装配时把 profile 快照传给 `setup`；`context.data_path` 只表示 Plugin 的运行时私有目录。CLI 和 Desktop 可以把这个目录放在 Agent（以及未来的 Workspace）边界内，因此不同 Agent 不共享运行时状态，但仍然共享同一份 City 级 profile 配置。

每个 Agent 必须拥有独立的：

- Plugin 实例；
- Plugin profile 快照；
- Plugin 运行状态；
- Plugin 私有数据路径；
- Plugin lifecycle；
- Plugin action 执行上下文。

禁止跨 Agent 共享已实例化的 Plugin。

## 9. Plugin Action 上下文

Plugin 的外部宿主能力来自 `setup`：

```ts
this.provider;
this.user_service;
```

Action 的 Agent 执行上下文来自 Agent：

```ts
execute: async ({ context, execution_context, input }) => {
  await context.data_files.write_file(...);

  if (execution_context.abort_signal?.aborted) {
    throw new Error("action aborted");
  }

  return {
    success: true,
    data: await this.provider.search(input),
  };
}
```

不再在 `PluginContext` 中重复暴露宿主 AI 或 Web 服务。Plugin 通过自身持有的 Provider 使用外部服务，通过 Action context 使用当前 Agent 执行能力。

## 10. 生命周期

`setup` 创建实例后，生命周期仍由 Agent 的 PluginRegistry 管理：

```text
City.setup()
  → PluginRegistry.add()
  → lifecycle.start()
  → action / hook / system
  → lifecycle.stop()
```

`setup` 不等于 `start`，也不负责 Plugin 运行状态。

Plugin action 返回 `success: false` 时，只表示业务失败，不得把 Plugin 标记为 lifecycle error。只有以下情况可以改变 Plugin 健康状态：

- `lifecycle.start()` 失败；
- `lifecycle.stop()` 失败；
- Plugin 协议校验失败；
- Plugin 自有运行基础设施不可恢复。

## 11. 错误语义

必须区分：

| 错误 | 所属边界 | 是否改变 Plugin 健康状态 |
| --- | --- | --- |
| profile schema 校验失败 | CLI/Loader | 否，阻止装配 |
| `setup` 创建失败 | Plugin 装配 | 否，实例创建失败 |
| Provider 业务请求失败 | Plugin Action | 否 |
| Action 找不到业务对象 | Plugin Action | 否 |
| `lifecycle.start()` 失败 | Plugin Runtime | 是 |
| `lifecycle.stop()` 失败 | Plugin Runtime | 记录并收口 |
| payload schema 校验失败 | Action 调用 | 否 |
| 用户取消或审批拒绝 | Agent 执行 | 否 |

## 12. 迁移范围

### 12.1 `@downcity/agent`

- 保持 `Agent({ plugins })` API 简洁；
- PluginRegistry 继续拥有 Plugin 实例和生命周期；
- 删除 Plugin constructor 必须接收 profile/runtime 的假设；
- 保留 Action 执行上下文和 Workspace 能力；
- 保证替换、卸载和 stop 的生命周期语义闭合。

### 12.2 `@downcity/local`

- Loader 从“直接调用 Plugin constructor”改为调用 `setup`；
- 读取 `plugin.json.setup` 导出的 `schema`；
- 将宿主配置解析为对象后再校验；
- 由 City 创建并传入 `PluginHostContext`；
- 安装阶段不自动执行 setup；
- 需要交互式配置时由宿主自己的显式命令负责；
- 配置格式可以继续是 `config.toml`，但不再进入 Agent SDK API。

### 12.3 `@downcity/plugins`

- 内置 Plugin 恢复自然 Class 构造；
- 外部 Provider 在 Plugin 包内部组合；
- 通过统一 registration 提供内置 Plugin 的 definition 与 setup；
- Plugin SDK Class 不接收框架规定的 profile 或 host runtime。

### 12.4 文档和测试

- 更新 Plugin 开发指南和 CLI Plugin 文档；
- 删除“必须导出 constructor 并由 Loader 直接 `new`”的说明；
- 增加 SDK 直接构造测试；
- 增加 City schema 校验和 `setup` 装配测试；
- 增加多 Agent 实例隔离测试；
- 增加安装阶段不会调用 setup 的测试；
- 增加 Action 业务失败不会污染 lifecycle 状态的测试。

## 13. 非目标

本次修改不设计：

- Plugin 之间的组合 DSL；
- City 级 Plugin 共享实例；
- 通用 Service Container；
- 自动依赖解析；
- Plugin 之间的隐式通信；
- Agent 全局 runtime 单例；
- 安装时自动执行第三方任意脚本；
- action 返回值与 UI 展示结果的二次分离协议。

## 14. 最终协议

SDK：

```ts
new Plugin(Plugin 自己定义的参数);
```

通用宿主：

```ts
const profile = validate_profile(raw_profile, module.schema);

const plugin = await module.setup({
  plugin_id,
  profile,
  embassy,
  data_path, // 运行时私有目录，不是 profile 配置目录
  logger,
  extensions,
});
```

Agent：

```ts
new Agent({
  id,
  model,
  plugins: [plugin],
});
```

这三个边界分别解决：

```text
Plugin Class       → 自由、直接、适合 SDK
schema             → City 配置发现与校验
setup              → City 创建未知 Plugin 实例
```
