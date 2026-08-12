/**
 * 仓库级 npm scripts 帮助输出。
 *
 * 关键点（中文）
 * - `package.json` 的 scripts 本身没有原生 description 字段，因此用单独脚本集中输出说明。
 * - 这里只展示根仓库最常用、最需要解释的命令，避免把帮助信息做成噪音。
 * - 输出内容面向当前仓库协作者，不面向 npm 通用生态。
 */

/**
 * 单条脚本说明。
 *
 * @typedef {object} ScriptHelpItem
 * @property {string} name 脚本名称，即 `npm run <name>` 中的 `<name>`。
 * @property {string} summary 一句话说明脚本用途。
 * @property {string} detail 更具体的执行范围、构建顺序或副作用说明。
 */

/** @type {ScriptHelpItem[]} */
const HELP_ITEMS = [
  {
    name: "help",
    summary: "显示根仓库常用 npm scripts 说明。",
    detail: "用于快速查看各脚本职责，避免反复翻 package.json。",
  },
  {
    name: "build",
    summary: "完整构建整个仓库。",
    detail:
      "等价于 `build:all`，会构建 city、services、cli 与 homepage 等主要交付物。",
  },
  {
    name: "build:all",
    summary: "执行完整仓库构建链路。",
    detail:
      "按仓库构建脚本完成全量构建；发布版本由 release commit 显式控制。",
  },
  {
    name: "build:plugins",
    summary: "只构建 Plugins 包。",
    detail: "先构建 `@downcity/shell`，再执行 `pnpm -C packages/plugins build`，不会修改 package version。",
  },
  {
    name: "build:federation",
    summary: "只构建 @downcity/federation 包。",
    detail: "先构建 @downcity/type，再构建 Federation runtime 与 Embassy SDK。",
  },
  {
    name: "build:city",
    summary: "构建 @downcity/city Agent 宿主包。",
    detail: "先构建 Agent、Federation、Plugins 与平台 Adapter，再构建 City。",
  },
  {
    name: "build:cli",
    summary: "构建 Downcity CLI 产品包。",
    detail: "依次构建 `packages/cli`，不会修改 package version。",
  },
  {
    name: "build:homepage",
    summary: "只构建 homepage。",
    detail: "适合单独验证官网改动，不会触发 cli 构建。",
  },
  {
    name: "patch:build",
    summary: "按 package 执行 patch bump + build。",
    detail:
      "支持 `npm run patch:build -- --shell --agent --city --services --plugins --cli`、`--ui`、`--all`、`--no-bump`，默认构建 agent + plugins + cli。",
  },
  {
    name: "agent:patch:build",
    summary: "只对 @downcity/agent 执行 patch bump + build。",
    detail: "等价于 `npm run patch:build -- --agent`，会先构建 @downcity/shell 作为依赖。",
  },
  {
    name: "plugins:patch:build",
    summary: "只对 @downcity/plugins 执行 patch bump + build。",
    detail: "等价于 `npm run patch:build -- --plugins`，会先构建 shell 和 agent 作为依赖。",
  },
  {
    name: "federation:patch:build",
    summary: "只对 @downcity/federation 执行 patch bump + build。",
    detail: "等价于 `npm run patch:build -- --federation`。",
  },
  {
    name: "city:patch:build",
    summary: "只对 @downcity/city 执行 patch bump + build。",
    detail: "等价于 `npm run patch:build -- --city`。",
  },
  {
    name: "cli:patch:build",
    summary: "只对 downcity 执行 patch bump + build。",
    detail:
      "等价于 `npm run patch:build -- --cli`，会构建 Agent、Federation、Plugins、City、Services 与 UI 等依赖，再构建 packages/cli 并全局安装 downcity 命令。",
  },
  {
    name: "all:patch:build",
    summary: "对全部 packages 执行 patch bump + build。",
    detail: "等价于 `npm run patch:build -- --all`，会处理 shell、agent、city、services、plugins、ui、cli。",
  },
  {
    name: "install:ws",
    summary: "安装整个 workspace 依赖。",
    detail: "等价于在仓库根目录执行 `pnpm install`。",
  },
  {
    name: "dev:ui-sdk",
    summary: "启动 packages/ui 的开发模式。",
    detail: "用于单独开发 UI SDK，不会自动启动 homepage 或 console。",
  },
  {
    name: "dev:homepage",
    summary: "启动 homepage 开发模式。",
    detail: "等价于 `homepage`，都会执行 `pnpm -C homepage dev`。",
  },
  {
    name: "homepage",
    summary: "启动 homepage 开发模式。",
    detail: "保留一个更短的命令入口，便于日常使用。",
  },
  {
    name: "console",
    summary: "启动 console 开发模式。",
    detail: "执行 console 的 Vite dev server，用于调试控制台前端。",
  },
  {
    name: "publish",
    summary: "执行 downcity 发布脚本。",
    detail:
      "同步 root、@downcity/shell、@downcity/agent、@downcity/plugins、downcity 版本并推送，触发 scoped 包发布 workflow，并在成功后触发 downcity 镜像包 workflow。",
  },
  {
    name: "build:packages",
    summary: "packages 构建脚本底层入口。",
    detail: "当前与 `patch:build` 指向同一个脚本，保留给已有使用习惯与兼容调用。",
  },
];

const nameWidth = Math.max(...HELP_ITEMS.map((item) => item.name.length));

console.log("Downcity root scripts\n");

for (const item of HELP_ITEMS) {
  const paddedName = item.name.padEnd(nameWidth, " ");
  console.log(`- ${paddedName}  ${item.summary}`);
  console.log(`  ${item.detail}`);
}
