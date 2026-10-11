# Package 命名与 Registry 冗余清理计划

> 状态：待执行
>
> 适用范围：npm Registry 上的 `@downcity/*` 发布物、仓库内 homepage 文档、下游消费方（`official`、local-proxy skill）
>
> 目标：让"代码里的包名"、"Registry 上的包"、"文档里的 import"三处重新对齐，并补上防止再次漂移的校验
>
> 更新时间：2026-10-03

## 1. 这份计划解决什么

问题的表象是"线上 city 是 0.2.x、线下是 0.1.x"，但版本号只是症状。真正的原因是仓库在 8 月到 9 月连续做了四轮改名与拆分，代码改干净了，**Registry 上的旧包名、下游的依赖声明、文档里的 import 示例**没有同步跟上。这三处没有任何自动对齐机制，全部依赖人工记忆，于是积累成了现在这种"同一个能力有好几个名字同时活着"的状态。

改名的完整链条（每一轮都在三个平面上留了残留）：

| 时间 | 提交 | 改名内容 | Registry 残留 |
| --- | --- | --- | --- |
| 2026-08-12 | `e126c68ab` 之前 | City runtime 拆入 `@downcity/agent`，federation 拆出 `@downcity/federation` | `@downcity/city@0.2.270` 变成兼容转发壳 |
| 2026-09-04 | `269c30b8` | 从零重建 `packages/city`，版本号写 `0.1.1` | 旧 0.2.x 线（126 个版本）成为孤儿 |
| 2026-09-16 | `fecc2be10`、`963fc922d` | `image`、`sound` 从 plugin 收进 City capability | `@downcity/plugins` 的 `/image`、`/sound` 子路径失效 |
| 2026-09-18 | `388a1337f` | `packages/implementations/plugins/` → `powers/`（`R078` 明确重命名） | 旧名 `@downcity/plugins` 仍在 npm 上，且**未标 deprecated** |
| 2026-09-23 | `79349872b` | `chat` power 更名 `messenger` | `@downcity/plugins/chat` 失效 |

结论：`@downcity/city` 与 `@downcity/plugins` 是同一个病——重建或改名之后，旧名字没有退场。City 的旧版已标 deprecated（`1.1.x` 20 个、`0.2.x` 126 个全部已标），`@downcity/plugins` 则完全没处理。

## 2. Registry 现状盘点

公开包共 29 个（含 `downcity` CLI），按"是否还在仓库里维护"分成两类。

### 2.1 在维护的包（有对应源码目录）

| 包名 | 版本 | 源码位置 |
| --- | --- | --- |
| `@downcity/type` | 0.1.220 | `packages/type` |
| `@downcity/agent` | 1.1.446 | `packages/agent` |
| `@downcity/federation` | 0.1.24 | `packages/federation` |
| `@downcity/city` | 0.1.33 | `packages/city` |
| `@downcity/services` | 0.1.265 | `packages/implementations/services` |
| `@downcity/powers` | 1.0.318 | `packages/implementations/powers` |
| `@downcity/database-d1` / `-postgresql` / `-sqlite` | 0.1.16 | `packages/implementations/databases/*` |
| `@downcity/sandbox-microsandbox` / `-native` | 0.1.4 / 0.1.2 | `packages/implementations/sandboxes/*` |
| `@downcity/workspace-cloudflare-computer` | 0.1.21 | `packages/implementations/workspaces/cloudflare-computer` |
| `@downcity/ui` | 0.1.280 | `packages/ui` |
| `downcity`（CLI） | 1.1.487 | `packages/cli` |

### 2.2 孤儿包（仓库内引用为 0，能力已迁走）

这 11 个包仍挂在 npm 上，包名在仓库任何 `package.json`、源码、脚本、workflow 中都已无引用。它们的名字被占着，是"看起来乱"的主要来源。

| 包名 | latest | 版本数 | 最后发布 | 能力现在在哪 |
| --- | --- | --- | --- | --- |
| `@downcity/plugins` | 1.0.312 | 124 | 2026-09-10 | `@downcity/powers` |
| `@downcity/shell` | 0.1.172 | 91 | 2026-08-11 | `@downcity/city/shell` |
| `@downcity/server` | 0.1.149 | 71 | 2026-08-12 | 已并入 `@downcity/agent` / `@downcity/city` |
| `@downcity/sandbox-linux` | 0.1.38 | 15 | 2026-08-31 | `@downcity/sandbox-native` |
| `@downcity/sandbox-macos` | 0.1.38 | 15 | 2026-08-31 | `@downcity/sandbox-native` |
| `@downcity/sandbox-windows-mxc` | 0.1.38 | 15 | 2026-08-31 | `@downcity/sandbox-native` |
| `@downcity/sandbox-windows-srt` | 0.1.37 | 14 | 2026-08-31 | `@downcity/sandbox-native` |
| `@downcity/workspace` | 0.1.7 | 3 | 2026-09-02 | `@downcity/city/workspace` |
| `@downcity/local` | 0.2.29 | 2 | 2026-08-31 | `@downcity/city/local` |
| `@downcity/plugin` | 0.1.5 | 2 | 2026-08-31 | `@downcity/city/power` |
| `@downcity/agent-registry` | 0.1.3 | 2 | 2026-08-11 | 已并入 CLI / Desktop 内部实现 |

按版本总数算，124（plugins）+ 91（shell）+ 71（server）+ 59（sandbox 四个）+ 9（workspace / local / plugin / agent-registry）= 354 个孤儿版本占着包名，而实际维护的 13 个 scoped 包加起来只有 768 个版本（含 `downcity` CLI 共 1255 个）。

### 2.3 city 的三条版本线

| 版本线 | 数量 | 时间 | 状态 | 这个包当时是什么 |
| --- | --- | --- | --- | --- |
| `1.1.x` | 20 | 2026-05-14 ~ 05-29 | 全部 deprecated | 跟随 monorepo 的 1.1.x |
| `0.2.x` | 126 | 2026-05-30 ~ 08-12 | 全部 deprecated | City runtime + City access SDK（services / actions / auth / AI 计费） |
| `0.1.x` | 4 | 2026-09-08 ~ 10-01 | 活跃，latest=0.1.33 | City 组合根、Power 生命周期、Agent transport 运行时 |

`^0.2.149` 这类范围的上界是 `<0.3.0`，而 `0.1.33` 排序在 `0.2.0` 之下，永远不被选中。这是"线上卡在 0.2.x"的直接机制：任何还写着 `^0.2.x` 的依赖会永久解析到那个只剩兼容转发的壳。

子路径也在同一次重建中改名：

| 版本 | 导出子路径 |
| --- | --- |
| 0.1.17 / 0.1.22 | `.` `./local` `./shell` `./plugin` `./workspace` `./plugin/react` |
| 0.1.32 / 0.1.33 | `.` `./http` `./local` `./power` `./shell` `./workspace` `./power/react` |

即 `./plugin` 与 `./plugin/react` 在 0.1.32 已不存在，且 0.1.33 没有留别名（符合"不做兼容转发"的方向）。0.1.17 与 0.1.22 恰好还导出 `/plugin`，所以照着文档写代码的人会因为解析到哪个版本而随机成功或失败。

### 2.4 powers 的新旧导出差异

| `@downcity/plugins@1.0.312`（旧，9-10） | `@downcity/powers@1.0.318`（新，10-02） |
| --- | --- |
| `./chat` | `./messenger` |
| `./image` | 已移入 city capability |
| `./sound` | 已移入 city capability |
| `./memory` `./renderers` `./skill` `./task` `./web` | 同名保留 |

旧名的 latest 反而带着 `image`、`sound` 和改名前的 `chat`，看起来"功能更全"，会持续误导。`@downcity/plugins` 在 npm 上**未标 deprecated**，是唯一完全没处理的旧包。

## 3. 版本归一：统一到 0.4.x 是否成立

结论：**0.4.x 不成立**，它不解决任何现有问题，还会新增一层歧义。

理由基于 semver 实际解析（用 `semver@7.8.1` 对 registry 全部 city 版本求解 `maxSatisfying`）：

| 范围 | 当前解析结果 | 是否 deprecated |
| --- | --- | --- |
| `*` | `1.1.47` | 是 |
| `>=0.1.0` | `1.1.47` | 是 |
| `^1.0.0` / `^1.1.0` | `1.1.47` | 是 |
| `^0.1.0` | `0.1.33` | 否 |
| `^0.2.0` | `0.2.270` | 是 |

关键事实是 `1.1.47` 仍是全包最高版本。即使把 city 发成 `0.4.0`，`*` 与 `>=0.1.0` 仍会解析到 `1.1.47`——因为 `0.4.0 < 1.1.47`。宽松范围选中废弃版本的根因是"存在更高的废弃版本"，只有发布一个高于 `1.1.47` 的版本才能改变它。

`0.4.x` 的第二个问题是 0.x 的 caret 语义：`^0.4.0` 接受 `0.4.9` 但不接受 `0.5.0`。也就是说整个 0.x 线上，每个 minor 对消费方都是破坏性的，每次 minor 升级都要下游改范围。留在 0.x 就是永久承担这个成本。

另外要区分两件被混在一起的事：`npm i @downcity/city`（不带范围）走 `latest` tag，现在就会装 `0.1.33`，没有问题。真正坏掉的只有下游写死的范围（`^0.2.149`、`0.2.268`）。所以"线上是 0.2.x"不是发布错误，是消费方声明过期。

如果目标确实是"整个 SDK 家族用一个版本号"，可行的选项只有两个：

| 方案 | 效果 | 代价 |
| --- | --- | --- |
| 维持各包独立编号（现状） | 内部 `workspace:` 协议保证正确性；`latest` tag 正确 | 下游需各自跟随；跨包版本号不可比 |
| 家族统一 `2.0.0` | `*` / `>=0` 自动指向新版，废弃的 `1.1.47` 不再胜出；major 明确表达 Plugin→Power 这类破坏性改名 | 需一次性全家族同步发布（含 agent、powers、type、services、ui、federation、database-*、sandbox-*） |

不建议的中间态是"只把 city 抬到 1.2.0"：它能让 `*` 指向新版，但 agent（1.1.446）、powers（1.0.318）、type（0.1.220）等仍是各自的线，"统一"目标没达成，反而多出一个与其他包无对应关系的版本号。

## 4. 清理批次

按"风险从低到高、依赖从内到外"排序。批次 A 完全在本仓库内，可以立即执行；B、C 涉及其他仓库或需要 npm 凭据。

### 批次 A：homepage 文档对齐（本仓库）

**范围修正（实测后）**：原计划把 A 写成"纯文本替换"，这个判断不成立。校验脚本跑出来的 27 个 error 只是子路径层，实际文档在符号与术语层也停留在改名之前。只改子路径会得到 `import { Plugin } from "@downcity/city/power"` 这种路径对、符号错的结果，仍然不可用。

实测的文档存量（不含 blog 的 152 个文件）：

| 需要改的东西 | 处数 | 现在（错） | 应该（对） | 依据 |
| --- | --- | --- | --- | --- |
| 子路径 | 32（25 文件） | `@downcity/city/plugin`、`/plugin/react` | `@downcity/city/power`、`/power/react` | `packages/city/package.json` exports |
| 基类与类型 | 866 处 `Plugin` 词根 · 55 处 `PluginContext` · 12 处 `PluginHooks` · 12 处 `PluginLifecycleContext` · 6 处 `PluginJsonObject` · 4 处 `PluginResolveHook` · 4 处 `PluginActions` | `Plugin`、`PluginContext`、`PluginHooks`… | `Power`、`PowerContext`、`PowerHooks`… | `packages/city/src/power/index.ts` 只导出 `Power*`；`Plugin` 符号已不存在 |
| 工厂函数 | 32 | `create_builtin_plugin_registrations` | `create_builtin_power_registrations` | `packages/implementations/powers/src/index.ts` |
| React 渲染器 | 4 | `define_plugin_renderer` | `define_power_renderer` | `packages/city/src/power/react.ts` |
| City 构造选项键 | 28 | `new City({ plugins: … })` | `new City({ powers: … })` | `packages/city/src/city/types/City.ts` 的 `CityOptions` 无 `plugins` 字段 |
| 包名 | 34（22 文件） | `@downcity/plugins` | `@downcity/powers` | 目录 `R078` 重命名 |

这已经不是一次替换，而是一次内容重写：152 个文件里的示例代码、类型引用与叙述术语都要对齐到 Power 词汇。可脚本化的只有子路径、符号前缀与函数名，`plugins:` → `powers:` 和正文叙述需要逐处确认，否则会误改历史叙述或产品名。

因此 A 拆成两步：**A1 机械替换**（子路径、`Plugin*` 符号、`create_builtin_*`、`define_*_renderer`，可脚本化且可回归校验），**A2 语义修正**（City 选项键、builtins 表、叙述术语，逐文件人工确认）。

#### A1 机械替换明细

**子路径：`@downcity/city/plugin` → `@downcity/city/power`**

共 32 处，分布在 25 个文件。注意 2 处是 `/plugin/react`，要一起变成 `/power/react`：

| 文档集 | 处数 | 文件 |
| --- | --- | --- |
| `agent-sdk-docs` | 14 | `en/api-reference/sdk-surface.mdx`、`en|zh/local-agent/tools-and-plugins.mdx`、`en|zh/plugins/custom-plugin.mdx`、`en|zh/plugins/plugin-actions.mdx`、`en|zh/plugins/plugin-development.mdx` |
| `plugins-docs` | 10 | `en|zh/examples/*.mdx`（各 5 个：audit-effect、message-augment、notes、review-guard、role-resolver） |
| `city-sdk-docs` | 4 | `en|zh/packages/agent.mdx`、`en|zh/packages/index.mdx` |
| `docs` | 4 | `en|zh/plugin/custom.mdx` |

**符号：`Plugin*` → `Power*`，工厂函数与渲染器同步改名**

| 现在 | 应该 | 处数 |
| --- | --- | --- |
| `Plugin` | `Power` | 866 |
| `PluginContext` | `PowerContext` | 55 |
| `PluginHooks` | `PowerHooks` | 12 |
| `PluginLifecycleContext` | `PowerLifecycleContext` | 12 |
| `PluginJsonObject` | `PowerJsonObject` | 6 |
| `PluginResolveHook` | `PowerResolveHook` | 4 |
| `PluginActions` | `PowerActions` | 4 |
| `create_builtin_plugin_registrations` | `create_builtin_power_registrations` | 32 |
| `define_plugin_renderer` | `define_power_renderer` | 4 |

先替换长名（`PluginHooks` 等），再替换裸的 `Plugin`，否则会二次改写。`PluginRegistry`、`PluginExecutionContext`、`PluginScheduleStore`、`PluginReference` 在代码里已无对应符号，不能机械前缀替换，需删除或重写（归 A2）。

**包名：`@downcity/plugins` → `@downcity/powers`**

共 34 处，分布在 22 个文件：

| 文档集 | 处数 | 说明 |
| --- | --- | --- |
| `plugins-docs` | 18 | `en|zh/builtins/overview.mdx` 各 6 处（import 路径表）、`en|zh/builtins/task.mdx`、`en|zh/builtins/web.mdx`、`en|zh/index.mdx` |
| `agent-sdk-docs` | 6 | `en|zh/local-agent/constructor-options.mdx`、`en|zh/local-agent/tools-and-plugins.mdx`、`en|zh/plugins/overview.mdx` |
| `city-sdk-docs` | 4 | `en|zh/packages/city/index.mdx` 各 2 处 |
| `docs` | 6 | `en|zh/agent/overview.mdx`、`en|zh/agent/sdk-architecture.mdx`、`en|zh/agent/sdk.mdx` |

#### A2 语义修正明细

**`plugins-docs` 的 builtins 表要按新导出重写，不能只换包名前缀**

`private/apps/homepage/content/plugins-docs/{en,zh}/builtins/overview.mdx` 的 import 路径表当前是这个形态：

```text
| `image` | `@downcity/plugins/image` |
| `sound` | `@downcity/plugins/sound` |
```

这两个子路径在新包里不存在（`image`、`sound` 已收进 City capability）。单纯把 `@downcity/plugins` 换成 `@downcity/powers` 会写出不存在的路径。正确结果应为：

| 能力 | 导入路径 | 依据 |
| --- | --- | --- |
| `messenger` | `@downcity/powers/messenger` | `packages/implementations/powers/package.json` exports |
| `memory` | `@downcity/powers/memory` | 同上 |
| `skill` | `@downcity/powers/skill` | 同上 |
| `task` | `@downcity/powers/task` | 同上 |
| `web` | `@downcity/powers/web` | 同上 |
| `image` / `sound` | 无独立子路径，改为 City capability | `packages/city/src/city/power/builtin/groups/image/`、`groups/sound/` |

同文件的"内建 plugin 能力清单"（`skill`、`web`、`sound`、`messenger`、`schedule`、`task`、`memory`、`shell`）也需要按当前实现复核，`image`、`sound`、`shell` 都已不属于 powers 的子路径集合。

### 批次 B：下游消费方版本对齐（跨仓库）

这两处是"线上 0.2.x"的实际来源。

**B1. `private/services/edge-worker`**

当前 [package.json](/Users/wangenius/Documents/github/downcity/private/services/edge-worker/package.json:19) 写的是精确版本 `"@downcity/city": "0.2.268"`，锁文件里同时存在 `@downcity/city@0.2.268` 与 `@downcity/city@0.2.270`。

**改前必须先用类型检查确认**，因为这 12 处根导入依赖的是 0.2.x 根导出里的 City access SDK 类型，而那部分能力现在归 `@downcity/federation` 和 `@downcity/services`：

```text
src/platform/cloudflare/queue.ts   CityQueueAdapter, CityQueueMessage
src/http/middleware.ts             FederationMiddleware
src/ai/catalog/models.ts           AIModelDefinition, AIModelFallbackRule
src/ai/catalog/metadata.ts         AIModelSpec
src/ai/billing/text.ts             AIBillInput, AICharge
src/ai/channels/**                 多个类型
```

它已经依赖 `@downcity/federation@0.1.24`，但上面这些类型当前解析到的是 city 0.2.x。先跑 `pnpm -C edge-worker typecheck`，把每个类型指向正确的包之后再改版本号，避免把一次版本升级变成无边界的迁移。

另外 `downcity` CLI 自身已经完成了这条迁移（`1.1.428 → ^0.2.268`、`1.1.481 → ^0.1.17`、`1.1.487 → ^0.1.33`），可以作为参照。

**B2. local-proxy skill 模板**

`downcity-local-proxy-skill/skills/downcity-local-proxy/assets/local-proxy-template/package.json` 里 `"@downcity/city": "^0.2.149"`，同文件的 `"@downcity/services": "^0.1.140"` 也明显滞后。3 处导入都是根导入 `from "@downcity/city"`，没有子路径，所以 import 语句本身不用改，只需核对类型归属后升版本。这是独立 git 仓库。

### 批次 C：Registry 旧包标记（需要 npm 凭据）

npm 上的已发布版本无法删除，只能标 deprecate。这是唯一能"收掉"孤儿包的手段。

```bash
# 旧包名，全部标废弃并指向上位替代者
npm deprecate '@downcity/plugins' 'Renamed to @downcity/powers. Image and sound are now City capabilities.'
npm deprecate '@downcity/shell' 'Folded into @downcity/city; import from @downcity/city/shell.'
npm deprecate '@downcity/workspace' 'Folded into @downcity/city; import from @downcity/city/workspace.'
npm deprecate '@downcity/local' 'Folded into @downcity/city; import from @downcity/city/local.'
npm deprecate '@downcity/plugin' 'Renamed to @downcity/city/power.'
npm deprecate '@downcity/server' 'Merged into @downcity/agent and @downcity/city.'
npm deprecate '@downcity/agent-registry' 'Internal capability; no longer published.'
npm deprecate '@downcity/sandbox-linux' 'Superseded by @downcity/sandbox-native.'
npm deprecate '@downcity/sandbox-macos' 'Superseded by @downcity/sandbox-native.'
npm deprecate '@downcity/sandbox-windows-mxc' 'Superseded by @downcity/sandbox-native.'
npm deprecate '@downcity/sandbox-windows-srt' 'Superseded by @downcity/sandbox-native.'
```

city 的 `1.1.x` / `0.2.x` 已经全部标过 deprecated，无需重复处理。需要注意 `npm deprecate` 不带版本号时作用于全部版本，旧版本的 install 会给警告但仍可安装。

### 批次 D：防止再次漂移（本仓库，脚本层）—— 已完成

仓库已有 `scripts/package-graph.mjs`（发布拓扑）和 `.github/scripts/validate-published-dependencies.mjs`（发布前校验依赖已发布），但**没有任何检查覆盖"文档引用的包名/子路径是否真实存在"**。这是这次能积累出一团乱的根本缺口。

已新增 `private/scripts/verify-doc-package-references.mjs`：扫描 `private/apps/homepage/content/**/*.mdx` 中所有 `@downcity/<name>` 与 `@downcity/<name>/<subpath>` 引用，对子路径断言其存在于该包 `exports`，对包名断言其存在于 workspace（只有包名缺失时记为 warning，因为存在对外部包与历史叙述的合法引用）。

已接入 `package.json` 的 `release:test`（`verify-doc-package-references.mjs` 接在 `node --test` 之后）与 `release-integrity.yml` 已监控的路径，同时提供独立命令 `pnpm docs:verify`。接入时点为 A1 完成后——错误数从 27 降到 0，CI 才能保持绿灯。

## 5. 不该动的部分

盘点时遇到的这三类**不是**冗余，清理时不要误删：

**`@downcity/shell` 的 4 处引用** —— 全部是"不再存在独立包"的说明性文字，例如 `private/apps/homepage/content/docs/zh/agent/sdk-architecture.mdx:96` 的"不再存在独立的 `@downcity/shell` 包"。属于正确内容，已核对。

**`@downcity/ui-bridge`（2 处）** —— `private/apps/homepage/content/ui-sdk-docs/{en,zh}/host-integration.mdx` 里明确写着"以后如果需要可以再加一个这样的包"，是假设性命名，不是失效引用。

另外 `plugins-docs` 这个文档集本身的目录名与路由 `/plugins-docs` 仍叫 plugin，内容讲的却是 power，`meta.json` 的 title 是 "Agent Powers Docs"。改它牵连导航、URL 与 SEO 收录，属于独立议题。

### 5.1 已修复：`@downcity/bureau` 与 Workboard 组件

这两处原先被归入"待确认"，在核对文档与代码后已确认是真实错误并修复：

**`@downcity/bureau`（4 处，已修）** —— `docs/{en,zh}/federation/organizations.mdx` 与 `organizations-api.mdx` 里写的是 `import { Federation } from "@downcity/bureau"`。`@downcity/bureau` 在 npm 上返回 Not Found，workspace 里也不存在。核对时还发现第二层错误：这些示例同时调用 `bureau.service(...)` 与 `bureau.post(...)`，而 `bureau` 变量在全文从未声明，示例根本不可能运行。已改为文档其他页面使用的 `Embassy` 入口：`embassy.user.service("organizations").action(...).invoke(...)`，以及 `embassy.user.post("/v1/projects", ...)`（`EmbassyUser.post` 要求同源相对路径，原来的绝对 URL 会被 `resolve_request_url` 拒绝）。

**Workboard 组件（8 处，已修）** —— `ui-sdk-docs/{en,zh}/components/` 下 `workboard-game.mdx`、`workboard-stage.mdx`、`workboard-stage-map.mdx` 文档的 7 个组件里，只有 `Workboard` 是真实导出。`@downcity/ui` 实际只导出两个 workboard 值：`Workboard` 与 `buildWorkboardGameMapConfig`；`WorkboardGameAtlas`/`GameInspector`/`GameRoom`/`PixelAgent`/`RoomField`/`Stage`/`StageMap` 全部是内部 renderer，从未在 `index.ts` 中导出（git 历史确认：只有 `DowncityWorkboard*Props` 类型被导出过，组件值从未导出）。已重写这四页：说明这些是组合式 `Workboard` 的内部层，公开面是 `Workboard` 与地图构造函数，示例只使用真实存在的导出。

### 5.2 已修复：文档空间 `plugins-docs` → `powers-docs`

原先归入"独立议题"的文档集改名已完成。这是一次公开 URL 变更，涉及内容目录、路由、文档空间注册表、sitemap、检索索引、markdown 端点与导航文案：

| 层 | 改动 |
| --- | --- |
| 内容目录 | `content/plugins-docs/` → `content/powers-docs/`（git mv，保留历史） |
| 路由 | `app/routes/plugins-docs/` → `app/routes/powers-docs/`；`app/routes.ts` 中三个 route 的路径与 id 同步 |
| 文档空间 | `spaces.ts` 的 `id` 与 label（`Plugins` → `Powers`）、`types.ts` 的 `DocsSpaceId`、`docs-index.ts` 与 `docs-page.tsx` 的映射键 |
| 内容管线 | `source.config.ts` 的 `pluginsDocs` → `powersDocs`（目录名绑定）；`react-router.config.ts` 与 `generate-markdown-endpoints.mjs` 的集合表 |
| SEO 产物 | sitemap、`llms-full.txt`、`search-index.*.json` 与逐页 `.md` 端点均从 `docs_spaces` 推导，自动跟随；已核对无旧路径残留 |
| 导航文案 | `navbar.tsx` 与 `Footer.tsx` 的路径变量、`home.json` 的 footer label、`meta.json` 的 title |
| 站内链接 | 85 处引用（含 blog 已发布文章）全部改为新路径 |
| 旧 URL 保留 | `public/_redirects` 新增 6 条 301：`/en|zh/plugins-docs*` → `/en|zh/powers-docs*`，原无语言前缀规则的目标同步指向新路径 |

验证：`pnpm --dir private/apps/homepage build` 成功，预渲染 34 个 powers-docs 页面；markdown 端点新生成 32 个、旧路径 0 个；`pnpm --dir private/apps/homepage test:seo` 23 项全过；`docs:verify` 与 `release:test` 均通过。旧的 `/plugins-docs` 链接经 301 保留，不会断链或丢失收录。

### 5.3 已修复：全部 plugin 命名的文档路径收敛为 power

原计划保留了 `agent-sdk-docs/plugins/`、`docs/plugin/` 与各类 `*-plugin` 文件名作为独立议题，本轮已全部收敛。**按用户要求不做向后兼容**：不保留旧路径的 301。

| 层 | 改动 |
| --- | --- |
| 目录 | `agent-sdk-docs/{en,zh}/plugins/` → `powers/`；`docs/{en,zh}/plugin/` → `power/` |
| 文件 | `built-in-plugins`→`built-in-powers`、`custom-plugin`→`custom-power`、`plugin-actions`→`power-actions`、`plugin-availability`→`power-availability`、`plugin-call-surfaces`→`power-call-surfaces`、`plugin-development`→`power-development`、`plugin-hooks`→`power-hooks`、`plugin-http`→`power-http`、`plugin-system`→`power-system`、`tools-and-plugins`→`tools-and-powers`；powers-docs 下 7 个 example 同样改名 |
| 链接 | 82 个文件的站内链接目标同步（含 blog 已发布文章） |
| meta.json | `agent-sdk-docs/{en,zh}` 的 `plugins`→`powers`、`local-agent` 的 `tools-and-plugins`→`tools-and-powers`、`docs/{en,zh}` 的 `plugin`→`power`、两个 powers 目录的 title 与 pages 列表 |
| 首页源码 | `HomeSdkCodePanel.tsx` 的示例代码（`@downcity/plugins`、`create_builtin_plugin_registrations`、`plugins:` 键）修正为真实 API；`HomeSdkWorld` 的 `HomeSdkWorldPluginKind`/`plugin_kind`/`tone: "plugin"`/`--sdk-map-plugin`/`plugin_*` 布局 key、`navbar`/`Footer` 路径变量与文案、`home.json` 的 footer label、营销页文案全部收敛 |
| redirects | 上一轮新增的 `plugins-docs` → `powers-docs` 兼容 301 已删除 |

验证：`pnpm --dir private/apps/homepage typecheck` 通过；`pnpm --dir private/apps/homepage build` 成功；`pnpm --dir private/apps/homepage test:seo` 23 项全过；构建产物中无任何 `plugin` 命名的路径；`docs:verify` 与 `release:test` 通过。`find private/apps/homepage/content -name '*plugin*'` 与全仓库路径字符串搜索均为空。

### 5.4 校验脚本已覆盖符号层

原 `verify-doc-package-references.mjs` 只校验包名与子路径，因此上面这类"路径对、符号错"的问题逃过了检查。现已扩展为同时校验 `import { ... } from "@downcity/<name>"` 的每个符号是否真实由该包导出（以各包声明文件为事实源，含 `export * from` 的一层展开）。当前扫描 515 个 mdx、457 个 import 符号，零缺失。

## 6. 执行状态与验收

顺序上先做 A（本仓库、零风险），再做 D（把校验装上，防止 A 的成果再次腐化），然后是 B（跨仓库，需要类型检查），最后是 C（需要 npm 凭据，且不可逆）。

| 批次 | 范围 | 状态 | 验收方式 |
| --- | --- | --- | --- |
| A1 | 机械替换：子路径、`Plugin*` 符号、工厂函数、渲染器 | 已完成 | `pnpm docs:verify` 错误 27 → 0；MDX 编译全部通过 |
| A2 | 语义修正：`plugins:` → `powers:`、builtins 表 | 已完成 | 代码块内统一为 `powers:`；`image`/`sound` 两行已重写为 City capability |
| A3 | 词汇与 API 对齐（`plugin`/`插件` → `Power`） | 已完成 | 243 个 mdx 改动；详见下方 A3 结果 |
| D | 文档引用校验（包名、子路径、导出符号） | 已完成 | `pnpm docs:verify` 零 error；已接入 `release:test` |
| B | `private/services/edge-worker`、local-proxy 模板 | 未开始 | 先跑对应 `typecheck` 确认类型归属 |
| C | 11 个孤儿包标 deprecated | 未开始 | 需 npm 凭据 |

A1 的实际结果：改动 138 个 mdx 文件，包含子路径 32 处、`Plugin*` 符号改名、`create_builtin_power_registrations` 32 处、`define_power_renderer` 4 处，以及代码块内的 `plugins:` → `powers:`。blog 目录未动（已发布的历史文章不重写）。

A3 的实际结果：改动 243 个 mdx。完成的内容：

| 类别 | 改动 |
| --- | --- |
| 词汇 | 中文正文 `插件` → `Power`（中文侧与 desktop locale 一致）；中文行内的小写 `power` → `Power` |
| 英文 | 保留源文档已有的小写 `power` 行文风格（不改英文大小写） |
| 注释 | 代码块内的行注释同步为 `power`；纯代码标识符不动 |
| API | `city.plugins` → `city.powers`、`plugin_host` → `power_host`、`plugin_id`/`plugin_name` → `power_id`/`power_name`、`CityPluginRegistration` → `CityPowerRegistration`、`/api/plugins/*` → `/api/powers/*`、`/api/ui/plugins` → `/api/ui/powers`、`city plugin` → `city power` |
| 存储制品 | `~/.downcity/plugins/` → `~/.downcity/powers/`、`plugin.json` → `power.json`、renderer 自定义 scheme `downcity-plugin://` → `downcity-power://` |
| 删除的入口 | `plugin_call` 已不存在；6 处示例改写为真实工具形态（`skill({ action, args })`、`ai({ action: "sound.asr", args })`） |

`plugin_call` 在代码里已被删除（每个 Power 直接编译成一个以 Power 名为工具名的模型工具），文档里的 6 处示例重写为真实形态，而不是改个名字继续保留一个不存在的入口。

保护性约束：文档路由与链接目标（`/plugins-docs/*`、`/agent-sdk-docs/plugins/*`、`/docs/plugin/*`）保持原样，因为文件路径与路由未变；已发布的历史文章（blog）不重写。迁移后校对：412 个链接目标逐一对比完全一致，代码围栏缩进零差异，243 个文件全部通过 MDX 编译。
