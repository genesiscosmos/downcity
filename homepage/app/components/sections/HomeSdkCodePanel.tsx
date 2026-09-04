/**
 * 首页 SDK 世界滚动叙事的多文件代码面板。
 *
 * 动画阶段自动打开对应文件；已经随叙事出现的文件可以手动回看。每个文件仍按
 * 语义块逐步增加代码，当前块使用整行背景和左侧强调线表达。
 */

import { IconArrowRight, IconCheck, IconCopy } from "@tabler/icons-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { HomeSdkCodePanelProps, HomeSdkFileKey } from "@/types/home/HomeSdkWorld";

const file_keys = ["agent", "city", "federation"] as const;
const file_names: Record<HomeSdkFileKey, string> = {
  agent: "agent.ts",
  city: "city.ts",
  federation: "federation.ts",
};
const file_first_step: Record<HomeSdkFileKey, number> = {
  agent: 0,
  city: 6,
  federation: 12,
};

const file_accent: Record<HomeSdkFileKey, { line: string; background: string }> = {
  agent: { line: "#ef725f", background: "rgba(239, 114, 95, 0.15)" },
  city: { line: "#6f96d8", background: "rgba(111, 150, 216, 0.14)" },
  federation: { line: "#9ebce8", background: "rgba(158, 188, 232, 0.13)" },
};

const plugin_accent = { line: "#4f9a98", background: "rgba(79, 154, 152, 0.2)" };

/** 返回当前叙事步骤应该自动打开的代码文件。 */
export function home_sdk_file_for_step(active_step: number): HomeSdkFileKey {
  if (active_step <= 5) return "agent";
  if (active_step <= 11) return "city";
  if (active_step <= 17) return "federation";
  if (active_step <= 19) return "city";
  if (active_step === 20) return "agent";
  return "city";
}

/** 生成与地图语义一致的渐进代码块。 */
function create_code_groups(locale: "zh" | "en") {
  return {
    agent: [
      { key: "agent-import", start_step: 0, order: 0, lines: ['import { Agent } from "@downcity/agent";', 'import { City } from "@downcity/city";'] },
      { key: "workspace-import", start_step: 2, order: 1, lines: ['import { Workspace } from "@downcity/city";'] },
      { key: "model-import", start_step: 4, order: 2, lines: ['import { Embassy } from "@downcity/federation";'] },
      { key: "plugin-import", start_step: 5, order: 3, lines: ['import { create_builtin_plugin_registrations } from "@downcity/plugins";'] },
      { key: "agent-create", start_step: 1, order: 10, lines: ["", "const agent = new Agent({", '  id: "repo-helper",', `  instruction: "${locale === "zh" ? "你是可靠的项目助手。" : "You are a reliable project assistant."}",`, "});"] },
      { key: "workspace-create", start_step: 2, order: 11, lines: ["", "const workspace = new Workspace({", '  id: "project",', "  path: process.cwd(),", "});"] },
      { key: "session-create", start_step: 3, order: 13, lines: ["", "const session = await agent.sessions.create({ workspace });"] },
      { key: "model-resolve", start_step: 4, order: 14, lines: ["", `// ${locale === "zh" ? "User Token 已绑定登录时选择的 Bureau。" : "The User Token is bound to the Bureau selected at login."}`, "const embassy = new Embassy({", '  federation_url: "https://api.example.com",', "  user_token: process.env.FEDERATION_USER_TOKEN!,", "});", "const catalog = await embassy.user.ai.catalog();", 'const city_model = catalog.require("deepseek-chat");', "await session.set({ model: city_model });"] },
      { key: "agent-with-plugins", start_step: 5, order: 12, replaces: "agent-create", highlight_from: 4, highlight_until: 16, lines: ["", "const agent = new Agent({", '  id: "repo-helper",', `  instruction: "${locale === "zh" ? "你是可靠的项目助手。" : "You are a reliable project assistant."}",`, "});", "const registrations = create_builtin_plugin_registrations();", "const city = new City({", "  workspaces: [workspace],", "  plugins: registrations,", "});", "city.agents.add(agent, {", "  plugins: [", '    { plugin_id: "skill" },', '    { plugin_id: "task" },', '    { plugin_id: "web" },', '    { plugin_id: "memory" },', "  ],", "});"] },
      { key: "user-prompt", start_step: 20, order: 20, lines: ["", `const turn = await session.prompt({ query: "${locale === "zh" ? "总结当前仓库" : "Summarize this repository"}" });`, "const result = await turn.finished;", "console.log(result.text);"] },
    ],
    city: [
      { key: "city-import", start_step: 6, order: 0, lines: ['import { Agent, Group } from "@downcity/agent";', 'import { City } from "@downcity/city";', 'import { Embassy } from "@downcity/federation";', 'import { Workspace } from "@downcity/city";'] },
      { key: "city-model", start_step: 6, order: 10, lines: ["", "const embassy = new Embassy({", '  federation_url: "https://api.example.com",', "  user_token: process.env.FEDERATION_USER_TOKEN!,", "});", "const catalog = await embassy.user.ai.catalog();", 'const city_model = catalog.require("deepseek-chat");'] },
      { key: "city-workspace", start_step: 6, order: 11, lines: ["", "const workspace = new Workspace({", '  id: "project",', "  path: process.cwd(),", "});"] },
      { key: "city-build", start_step: 6, order: 13, lines: ["", "const city = new City({ workspaces: [workspace] });"] },
      { key: "city-agents", start_step: 7, order: 20, lines: ["", "const architect = new Agent({ id: \"architect\", model: city_model });", "const reviewer = new Agent({ id: \"reviewer\", model: city_model });", "city.agents.add(architect);", "city.agents.add(reviewer);"] },
      { key: "city-group", start_step: 8, order: 30, lines: ["", "const group = new Group({", '  id: "delivery-team",', "  model: city_model,", "  members: [architect, reviewer],", "});", "city.groups.add(group);"] },
      { key: "city-group-session", start_step: 9, order: 40, lines: ["", "const group_session = await group.sessions.create({ workspace });"] },
      { key: "neighbor-city", start_step: 10, order: 41, lines: ["", `// ${locale === "zh" ? "同一套组合可以运行在另一座独立 City 中。" : "The same composition can run as another independent City."}`] },
      { key: "third-city", start_step: 11, order: 42, lines: [`// ${locale === "zh" ? "每座 City 独立持有运行资源与生命周期。" : "Each City owns its own runtime resources and lifecycle."}`] },
      { key: "connected-city", start_step: 18, order: 13, replaces: "city-build", lines: ["", "const city = new City({", "  embassy,", "  workspaces: [workspace],", "});"] },
      { key: "embassy-service", start_step: 19, order: 43, lines: ["", "const catalog = await city.embassy!.user.ai.catalog();", 'const remote_model = catalog.get("deepseek-chat");'] },
      { key: "group-prompt", start_step: 21, order: 50, lines: ["", "group_session.subscribe((event) => {", "  if (event.type === \"message\") console.log(event.message.text);", "});", `await group_session.prompt({ query: "${locale === "zh" ? "评审当前实现并给出修改方案" : "Review the implementation and propose changes"}" });`] },
    ],
    federation: [
      { key: "federation-import", start_step: 12, order: 0, lines: ['import { AIService, Federation } from "@downcity/federation";', 'import { Database } from "@downcity/database-sqlite";'] },
      { key: "services-import", start_step: 14, order: 1, lines: ['import { AccountsService, CreditsService, PaymentService, UsageService, stripePaymentProvider } from "@downcity/services";'] },
      { key: "channel-import", start_step: 13, order: 2, lines: ['import { DeepSeekChannel } from "./deepseek_channel.js";'] },
      { key: "federation-create", start_step: 12, order: 10, lines: ["", 'const database = new Database({ filename: "./federation.sqlite" });', "const federation = new Federation({ database });"] },
      { key: "model-service", start_step: 13, order: 20, lines: ["", "const deepseek = new DeepSeekChannel();", "const ai = new AIService();", "ai.use(deepseek.model({", '  id: "deepseek-chat",', '  upstream_model: "deepseek-chat",', '  name: "DeepSeek Chat",', "}));", "federation.use(ai);"] },
      { key: "account-service", start_step: 14, order: 21, lines: ["", "const accounts = new AccountsService();", "federation.use(accounts);"] },
      { key: "credits-service", start_step: 15, order: 20, replaces: "model-service", lines: ["", "const deepseek = new DeepSeekChannel();", "const credits = new CreditsService();", "const ai = new AIService({ credits });", "ai.use(deepseek.model({", '  id: "deepseek-chat",', '  upstream_model: "deepseek-chat",', '  name: "DeepSeek Chat",', "}));", "federation.use(credits);", "federation.use(ai);"] },
      { key: "usage-service", start_step: 16, order: 30, lines: ["", "federation.use(new UsageService({", "  ai_usage_reader: ai,", "  credits_usage_reader: credits,", "  account_usage_reader: accounts,", "}));"] },
      { key: "payment-service", start_step: 17, order: 31, lines: ["", "federation.use(new PaymentService({", "  providers: [stripePaymentProvider()],", "  resolve_topup: ({ topup_amount_minor }) => ({", "    credits: topup_amount_minor * 10_000,", "  }),", "  on_paid: async (record) => {", "    await credits.topup({", '      card: { kind: "primary", user_id: record.user_id },', "      credits: record.credits,", '      source: "payment",', "      ref: record.payment_id,", "      idempotency_key: `payment:${record.payment_id}`,", "    });", "  },", "}));"] },
    ],
  } as const;
}

/** 为首页代码示例提供轻量语法着色。 */
function render_code_line(line: string) {
  const token_pattern = /(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:import|from|export|return|function|const|let|try|finally|if|throw|new|await|async|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|\b[A-Z][A-Za-z0-9_$]*\b|\b[A-Za-z_$][A-Za-z0-9_$]*(?=\s*\())/g;
  return line.split(token_pattern).filter(Boolean).map((token, token_index) => {
    const token_class = token.startsWith("//") ? "text-[#7f877d] italic" : /^("|'|`)/u.test(token) ? "text-[#aebd9c]" : /^(import|from|export|return|function|const|let|try|finally|if|throw|new|await|async|true|false|null|undefined)$/u.test(token) ? "text-[#d28b7d]" : /^\d/u.test(token) ? "text-[#c8b795]" : /^[A-Z]/u.test(token) ? "text-[#9cafc5]" : /^[A-Za-z_$]/u.test(token) ? "text-[#c8cbc4]" : undefined;
    return <span key={token_index} className={token_class}>{token}</span>;
  });
}

/** 渲染带真实文件 Tab 的同步代码面板。 */
export function HomeSdkCodePanel({ active_step, active_file, on_file_select, locale, tabs_label, docs_path, docs_label, copy_label, copied_label }: HomeSdkCodePanelProps) {
  const reduce_motion = useReducedMotion();
  const code_scroller_ref = useRef<HTMLPreElement>(null);
  const [is_copied, set_is_copied] = useState(false);
  const code_groups = useMemo(() => create_code_groups(locale), [locale]);
  const available_groups = code_groups[active_file]
    .filter((group) => group.start_step <= active_step);
  const replaced_group_keys = new Set<string>(
    available_groups.flatMap((group) => "replaces" in group && group.replaces ? [group.replaces] : []),
  );
  const visible_groups = available_groups
    .filter((group) => !replaced_group_keys.has(group.key))
    .slice()
    .sort((left, right) => left.order - right.order);
  const current_groups = visible_groups.filter((group) => group.start_step === active_step);
  const active_group_keys = new Set(
    current_groups.length > 0
      ? current_groups.map((group) => group.key)
      : visible_groups.at(-1)
        ? [visible_groups.at(-1)!.key]
        : [],
  );
  const active_accent = active_file === "agent" && active_step === 5 ? plugin_accent : file_accent[active_file];
  const visible_code = visible_groups.flatMap((group) => group.lines).join("\n");

  useEffect(() => {
    const scroller = code_scroller_ref.current;
    if (!scroller) return;
    window.requestAnimationFrame(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: reduce_motion ? "auto" : "smooth" });
    });
  }, [active_file, active_step, reduce_motion]);

  const copy_code = async () => {
    await navigator.clipboard.writeText(visible_code);
    set_is_copied(true);
    window.setTimeout(() => set_is_copied(false), 1400);
  };

  let line_number = 0;

  return (
    <article id="sdk-world-code-panel" data-file={active_file} className="flex min-h-0 min-w-0 flex-col bg-[#1b1d1b] text-[#e7e8e3]" aria-live="polite">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#1b1d1b]">
        <div className="flex h-12 min-w-0 shrink-0 items-stretch border-b border-white/10" role="tablist" aria-label={tabs_label}>
          <div className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {file_keys.map((file_key) => {
              const is_available = active_step >= file_first_step[file_key];
              const is_active = active_file === file_key;
              return (
                <button
                  key={file_key}
                  id={`sdk-file-tab-${file_key}`}
                  type="button"
                  role="tab"
                  aria-selected={is_active}
                  aria-controls="sdk-file-code"
                  disabled={!is_available}
                  className={`relative h-12 shrink-0 border-r border-white/8 px-2.5 font-mono text-[0.6rem] transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 md:px-4 md:text-[0.7rem] ${is_active ? "bg-[#252725] text-[#f3f3ef]" : is_available ? "text-white/46 hover:bg-white/5 hover:text-white/75" : "cursor-not-allowed text-white/18"}`}
                  onClick={() => on_file_select(file_key)}
                >
                  {file_names[file_key]}
                  {is_active ? <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ backgroundColor: active_accent.line }} /> : undefined}
                </button>
              );
            })}
          </div>
          <Link to={docs_path} aria-label={docs_label} title={docs_label} className="inline-flex size-12 shrink-0 items-center justify-center border-l border-white/8 text-white/55 transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40">
            <IconArrowRight className="size-4" strokeWidth={1.6} />
          </Link>
          <button type="button" className="inline-flex size-12 shrink-0 items-center justify-center border-l border-white/8 text-white/55 transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40" aria-label={is_copied ? copied_label : copy_label} title={is_copied ? copied_label : copy_label} onClick={() => void copy_code()}>
            {is_copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
          </button>
        </div>

        <pre ref={code_scroller_ref} id="sdk-file-code" role="tabpanel" aria-labelledby={`sdk-file-tab-${active_file}`} className="min-h-0 flex-1 overflow-auto py-6 font-mono text-[0.72rem] leading-6 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin] md:py-8 md:text-[0.78rem] md:leading-7">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.code key={active_file} layout className="block min-w-max">
              {visible_groups.map((group) => {
                const is_active = active_group_keys.has(group.key);
                return (
                  <motion.span key={group.key} layout initial={reduce_motion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce_motion ? 0 : 0.3 }} className="block">
                    {group.lines.map((line, group_line_index) => {
                      line_number += 1;
                      const is_active_line = is_active && (!('highlight_from' in group) || (group_line_index >= group.highlight_from && group_line_index < group.highlight_until));
                      return (
                        <motion.span key={`${group.key}-${group_line_index}`} layout animate={{ backgroundColor: is_active_line ? active_accent.background : "rgba(0, 0, 0, 0)" }} transition={{ duration: reduce_motion ? 0 : 0.32 }} className={`grid grid-cols-[2.85rem_minmax(0,1fr)] border-l-2 pr-6 ${is_active_line ? "text-[#f4f4f0]" : "border-transparent text-white/66"}`} style={{ borderLeftColor: is_active_line ? active_accent.line : "transparent" }}>
                          <span className="select-none pr-3 text-right text-white/22" aria-hidden="true">{line_number}</span>
                          <span className="whitespace-pre">{render_code_line(line) || " "}</span>
                        </motion.span>
                      );
                    })}
                  </motion.span>
                );
              })}
            </motion.code>
          </AnimatePresence>
        </pre>
      </div>
    </article>
  );
}

export default HomeSdkCodePanel;
