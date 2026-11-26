# Notes Power

一个只读的第三方 Power 源码模板。一个后端实例向 Desktop 提供一条演示笔记，前端复用宿主 Page、Group 和 Row。

| 协议 | 状态 |
| --- | --- |
| `downcity.desktop.react.v1` | 已实现完整 Page，可由当前 Desktop 加载 |
| `acme.web.react.v1` | 仅演示静态声明，Downcity 无适配器；入口不编译、不执行 |

文件入口为 `downcity.ts`；业务位于 `src/notes_power.ts`，纯数据类型位于 `shared/notes_contract.ts`，各宿主 UI 在 `ui/<host>/` 中。

使用包含多 Renderer 支持的 Downcity 宿主。将本目录复制为独立项目，检查 `package.json` 中 SDK 和 React 版本范围与实际宿主兼容。需要本地检查时安装声明的 registry 依赖，然后运行 `npm run typecheck`。可提交单一 npm 或 pnpm 锁文件；受管宿主支持的包管理器版本以正式文档为准。

```sh
city power install ./notes-power --json
city power reload <power_id> --json
```

安装和重新加载使用现有宿主；离线时准备目标快照，不自动启动 Desktop 或服务。该目录是 Power 代码来源，无需 `power.json` 或 `dist`。通过 `city power list` 查看来源、稳定 `power_id` 和实际状态，再使用同一 ID 配置、重载和卸载。示例 Acme 协议需要支持它的宿主。预构建 Power 包的清单及逐文件资源要求见正式文档。

本模板没有用户配置、秘密、模型动作或持久化写入；`notes.list` 是在 `initialize()` 登记的宿主业务动作。扩展业务时自行定义数据存储和输入校验，通过前端注入的 `power.invoke()` 使用该动作；模型 Actions 如有需要再调用共同业务服务。

正式文档：[多宿主 Renderer](https://downcity.ai/docs/power/renderers)。

## English

This Power code source demonstrates one backend Power with a working Desktop renderer and a static example declaration for another host. The Acme protocol has no Downcity adapter: its module is not compiled or executed. The Desktop UI uses host components and the bound `power.invoke()` gateway to list one sample note.

Copy this directory, check SDK and React compatibility with your host, and use `city power install ./notes-power --json`. Use `city power list` to find its stable `power_id` and observed status, then use that ID for configuration, reload and uninstall. Run `npm run typecheck` after installing declared dependencies for local checks. Code sources need neither `power.json` nor committed build output. There are no secrets, configuration inputs, model Actions, or persistent writes in this example.
