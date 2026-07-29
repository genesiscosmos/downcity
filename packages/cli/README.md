# downcity

`downcity` 是 Downcity 的全局安装聚合包。

```bash
npm install -g downcity
downcity -v
```

安装后会得到 `city` / `downcity` 与 `fed` / `downfed` 两个相互独立的工具：

- `city` 是本机 City 容器，基于 `City()` 与 Agent SDK 管理全局 Agent、运行时、Plugin 与控制台。
- `fed` 是 Federation Server Manager；TUI 用于注册和管理 Server，项目命令读取当前目录的 `federation.json`。Local Node.js 和 Cloudflare Workers 都通过 `fed deploy` 部署。

```bash
fed create ./my-fed
cd my-fed
pnpm install
fed deploy
fed
```

`fed create` 默认生成 Local Node.js + SQLite 项目。Local deploy 会自动注入并保存 admin key。无参数执行 `fed` 会进入系统级 Federation 管理面板，已部署实例不依赖当前工作目录。

City 的主要命令：

```bash
city agent create .
city agent start <agent_id>
city agent token create <agent_id> --name local
city plugin action <plugin_name> <action_name> <agent_id> --input '{}'
```

`city agent start` 创建的 Agent 默认启用 `ask_question` Tool。使用
`city agent chat <agent_id>` 交互时，模型可以在缺少关键信息时显示文本、单选或多选问题；
回答会通过 Session Interaction 提交，并在同一轮模型执行中继续处理。

Agent 与 Plugin Binding 统一保存在全局数据库；Plugin 配置不进入 Agent SDK 的运行时 Plugin 对象。未传 `agent_id` 时，TTY 打开全局 Agent 选择器，非交互环境直接报错。

为独立产品后端登记 Bureau：

```bash
fed bureau token
```

命令打开 Bureau Token 交互式管理界面，可创建、查看和撤销 Token。创建时必须输入用途，也可以直接运行 `fed bureau token create`。CLI 在本地生成 `bureau_token`，Federation 保存用途和 hash，并将明文输出一次。把明文写入 Bureau 服务器的 `DOWNCITY_BUREAU_TOKEN` 环境变量；Federation 与 Bureau 不需要部署在同一台服务器。脚本中可用 `fed bureau token list` 查看，使用 `fed bureau token revoke <token_id>` 撤销。
