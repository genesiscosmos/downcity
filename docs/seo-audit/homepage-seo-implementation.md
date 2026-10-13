# Homepage SEO 实施记录

## 范围

落实已批准的首页 SEO 与 Builder 价值文案方向；不部署、不调整支付接口行为、不启动双应用案例。

## 已实施

- 中英 Hero 增加明确品类说明，以用户价值作为 H1；描述面向独立 Builder 与小团队。
- Title、Description 使用 Agent Harness / 智能体运行时及应用基础设施表达。
- 能力区标题与说明改为构建应用、组织资源和复用基础；保留原有六项能力，不新增未经验证的性能或隔离承诺。
- 六项能力分别链接到 Agent SDK 的入门、会话、工具、重连、多 Agent 集成和 UI 文档；中英路径分别生成。
- Footer 与定位一致；首屏产品链接规范化为尾斜杠。
- JSON-LD 描述由集中定位源同步更新，保留现有实体关系。
- 更新 SEO 回归测试：中英新 H1、单 H1、品类、收益与六个文档链接及目标构建文件均有断言。

## 验证及边界

`git -C private diff --check` 通过。

首次类型检查报告 Stripe API 版本类型不匹配：`app/services/payment/stripe.config.ts:11`。该文件不属于本轮首页文案修改，未为通过检查而升级支付 API 或屏蔽类型错误。

最终 `pnpm -C private/apps/homepage build` 通过，`pnpm -C private/apps/homepage test:seo` 23 项全部通过（0 失败）。新 H1、六项文档链接及其目标静态文件、canonical、hreflang 和品牌实体均通过构建产物断言。线上 HTML、移动端视觉、Core Web Vitals、GSC / 百度索引与转化数据尚未验证，不能把本地构建通过当作线上优化生效。

## 发布结果

已按用户“先上线”指令直接发布通过构建与 SEO 测试的产物；跳过已知 Stripe 类型检查阻塞，未修改支付 API。Cloudflare Pages `downcity` 项目、`main` 分支，部署 ID `1c4082c1-1a3b-4d41-ae87-cab81139e13e`，部署列表确认为 Production。

部署地址：https://1c4082c1.downcity-homepage.pages.dev

发布初期自定义域名仍返回旧文案；后续复核 `https://downcity.ai/` 与 `https://downcity.ai/zh/` 均返回 HTTP 200，原始 HTML 中 H1 分别为 `Build your own system of agent applications.` 与 `构建你自己的 Agent 应用体系。`，确认新首屏已在自定义域名生效。未执行支付功能、移动端视觉或现场性能验证。

## 登录故障修复与重新发布

本地 Workers 运行时复现：认证请求的 `redirect: "error"` 不受支持，fetch 在发送前抛出 TypeError。改用 `manual` 并继续通过 `response.ok` 拒绝 3xx；补充不输出 Cookie、Token、响应正文的错误分类日志。

认证 Function 独立 TypeScript 检查与 private diff 格式检查通过。重新部署地址：https://f95d1879.downcity-homepage.pages.dev 。在该部署地址与正式域名 https://downcity.ai 分别验证：providers 返回 200 与 GitHub / Google；空会话返回 200 与 account:null；英文及中文登录页均返回 200。认证响应 Cache-Control 为 no-store。

未代替用户执行第三方 OAuth 授权，尚未验证真实账户的登录回调、会话恢复与退出。全项目 Stripe 类型问题仍未处理。

## 发布后验收

1. 核对批准版本的中英首屏及原始 HTML、canonical、hreflang 和 JSON-LD。
2. 检查移动端换行、CTA 可见性及文档链接最终响应。
3. 记录发布前后查询与 CTA 转化基线；不承诺固定排名或流量增长。
