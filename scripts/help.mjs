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
      "等价于 `build:all`，按 manifest package graph 构建全部 packages，再构建 homepage。",
  },
  {
    name: "build:all",
    summary: "执行完整仓库构建链路。",
    detail:
      "按 manifest package graph 完成全量构建并刷新全局 CLI，不修改 package version。",
  },
  {
    name: "build:powers",
    summary: "只构建 Plugins 包。",
    detail: "从 manifest 自动补齐 Plugins 的运行时依赖，不修改 package version。",
  },
  {
    name: "build:federation",
    summary: "只构建 @downcity/federation 包。",
    detail: "先构建 @downcity/type，再构建 Federation runtime 与 Embassy SDK。",
  },
  {
    name: "build:city",
    summary: "构建 @downcity/city 运行时包。",
    detail: "先构建 Agent 等运行时依赖，再构建 City、Plugin 生命周期、transport 与本地数据能力。",
  },
  {
    name: "build:cli",
    summary: "构建 Downcity CLI 产品包。",
    detail: "按 manifest graph 构建 CLI 依赖和产品包并刷新全局命令，不修改 package version。",
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
      "支持 `npm run patch:build -- --type --agent --city --powers --services --cli`、`--ui`、`--all`、`--no-bump`。",
  },
  {
    name: "agent:patch:build",
    summary: "只对 @downcity/agent 执行 patch bump + build。",
    detail: "等价于 `npm run patch:build -- --agent`，依赖闭包和顺序从 package manifests 自动推导。",
  },
  {
    name: "city:patch:build",
    summary: "只对 @downcity/city 执行 patch bump + build。",
    detail: "等价于 `npm run patch:build -- --city`，依赖闭包和顺序从 package manifests 自动推导。",
  },
  {
    name: "powers:patch:build",
    summary: "只对 @downcity/powers 执行 patch bump + build。",
    detail: "等价于 `npm run patch:build -- --powers`，依赖闭包和顺序从 package manifests 自动推导。",
  },
  {
    name: "federation:patch:build",
    summary: "只对 @downcity/federation 执行 patch bump + build。",
    detail: "等价于 `npm run patch:build -- --federation`。",
  },
  {
    name: "cli:patch:build",
    summary: "只对 downcity 执行 patch bump + build。",
    detail:
      "等价于 `npm run patch:build -- --cli`，按 manifest 依赖图构建 CLI 运行时依赖，再由 CLI build 装配 UI/Fedman 静态资源并全局安装命令。",
  },
  {
    name: "all:patch:build",
    summary: "对全部 packages 执行 patch bump + build。",
    detail: "等价于 `npm run patch:build -- --all`，目标范围来自 build-packages 的完整 public package 清单。",
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
    name: "release:test",
    summary: "验证 package graph、版本、workspace 改写和发布器不变量。",
    detail: "该命令也是 Release Integrity CI 的统一入口，不会执行实际发布。",
  },
  {
    name: "packages:publish",
    summary: "交互式发布 Downcity public packages。",
    detail:
      "从仓库 .env 读取 NPM_TOKEN，支持全部或指定 package，按独立版本执行 patch build、tarball 审计、pnpm 拓扑发布与 Registry 校验；不会自动 commit 或 push。",
  },
  {
    name: "homepage:deploy",
    summary: "在本地构建并部署 homepage 到 Cloudflare Pages。",
    detail:
      "首次使用前执行 `pnpm dlx wrangler@4.95.0 login`，默认部署到 downcity Pages 项目。",
  },
];

const nameWidth = Math.max(...HELP_ITEMS.map((item) => item.name.length));

console.log("Downcity root scripts\n");

for (const item of HELP_ITEMS) {
  const paddedName = item.name.padEnd(nameWidth, " ");
  console.log(`- ${paddedName}  ${item.summary}`);
  console.log(`  ${item.detail}`);
}
