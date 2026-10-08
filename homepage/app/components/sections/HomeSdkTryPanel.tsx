/**
 * SDK 试驾面板。
 *
 * 首屏下方的第二屏核心内容：左侧列出真实的 SDK 调用场景，右侧显示对应代码。
 * 与滚动叙事的分工是——叙事负责讲清「从 Agent 生长到 Federation」的结构，
 * 这里负责让人可以自己点开任意一段看真实 API 形状，不必滚动整屏。
 *
 * 为什么用状态而不是滚动驱动：这段内容属于「查阅」，用户想直接看某一段，
 * 而不是被滚动位置牵着走。
 */
import { useState } from "react";
import { CodeBlock } from "@downcity/ui";
import { cn } from "@/lib/utils";

/** 一个可试驾的 SDK 场景。 */
type SdkScenario = {
  /** 场景标识，用于选中态与 key。 */
  id: string;
  /** 左侧列表显示的场景名。 */
  label: string;
  /** 场景的一句话说明。 */
  summary: string;
  /** 场景代码，展示与复制都用这一份。 */
  code: string;
};

/** 场景集合，按 Agent → City → Federation 的顺序排列。 */
const scenarios: readonly SdkScenario[] = [
  {
    id: "agent",
    label: "Run an agent",
    summary: "Create an agent and send it one prompt.",
    code: `import { Agent, Workspace } from "@downcity/agent";

const workspace = new Workspace({ id: "project", path: process.cwd() });
const agent = new Agent({
  id: "repo-helper",
  instruction: "You are a reliable project assistant.",
});

const session = await agent.sessions.create({ workspace });
const turn = await session.prompt({ query: "Summarize this repository" });
const result = await turn.finished;

console.log(result.text);`,
  },
  {
    id: "city",
    label: "Compose a city",
    summary: "Host several agents with shared workspaces and powers.",
    code: `import { Agent, Group } from "@downcity/agent";
import { City, Workspace } from "@downcity/city";

const city = new City({ workspaces: [workspace] });

city.agents.add(new Agent({ id: "architect", model: city_model }));
city.agents.add(new Agent({ id: "reviewer", model: city_model }));

const group = new Group({
  id: "delivery-team",
  model: city_model,
  members: [architect, reviewer],
});
city.groups.add(group);`,
  },
  {
    id: "federation",
    label: "Reach federation",
    summary: "Resolve models and services from one backend.",
    code: `import { Embassy } from "@downcity/federation";

const embassy = new Embassy({
  federation_url: "https://api.example.com",
  user_token: process.env.FEDERATION_USER_TOKEN!,
});

const catalog = await embassy.user.ai.catalog();
const city_model = catalog.require("deepseek-chat");`,
  },
];

/** SDK 试驾面板。 */
export function HomeSdkTryPanel() {
  const [active_id, set_active_id] = useState<string>(scenarios[0].id);
  const active = scenarios.find((scenario) => scenario.id === active_id) ?? scenarios[0];

  return (
    <div className="grid overflow-hidden rounded-[18px] border border-line bg-card lg:grid-cols-[18rem_1fr]">
      <div className="border-b border-line p-5 lg:border-b-0 lg:border-r">
        <p className="mb-4 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-text-subtle">
          Try the SDK
        </p>
        <ul className="space-y-1">
          {scenarios.map((scenario) => {
            const is_active = scenario.id === active_id;

            return (
              <li key={scenario.id}>
                <button
                  type="button"
                  onClick={() => set_active_id(scenario.id)}
                  aria-pressed={is_active}
                  className={cn(
                    "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                    is_active
                      ? "bg-foreground/[0.055]"
                      : "hover:bg-foreground/[0.035]",
                  )}
                >
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      is_active ? "text-foreground" : "text-text-soft",
                    )}
                  >
                    {scenario.label}
                  </span>
                  <span className="mt-0.5 block text-[0.75rem] leading-snug text-text-subtle">
                    {scenario.summary}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 代码展示复用 UI SDK 的 CodeBlock：复制交互只维护一份实现。 */}
      <div className="min-w-0 bg-surface-soft p-3">
        <CodeBlock code={active.code} language="ts" label={`${active.id}.ts`} />
      </div>
    </div>
  );
}
