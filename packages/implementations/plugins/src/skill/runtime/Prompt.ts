/**
 * Skill plugin prompt section 渲染器。
 *
 * 关键点（中文）
 * - 负责渲染运行时动态清单，以及 find/install action 返回的纯提示词。
 * - 稳定规则放在 `SkillPromptAssets.ts`，避免分散在代码里维护。
 * - 仅做字符串渲染，不做文件 IO。
 */

import { getSkillSearchRoots } from "./Paths.js";
import type { SkillDefinition } from "@/skill/types/SkillDefinition.js";
import type { SkillRoot } from "@/skill/types/SkillRoot.js";
import type { SkillPluginOptions } from "@/skill/types/SkillPlugin.js";

/**
 * 把外部输入编码为单个 POSIX Shell 参数。
 *
 * 关键点（中文）：action 只返回提示词，但提示中的命令仍需避免把 query/spec 解释为额外 Shell 语法。
 */
function quote_shell_argument(value: string): string {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/**
 * 根据已配置扫描根生成安装位置提示。
 */
function render_install_root_instructions(
  roots: SkillRoot[],
  spec_argument: string,
): string {
  if (roots.length === 0) {
    return [
      "- No scan roots are configured.",
      "  Do not install a skill until the SkillPlugin configuration provides a discoverable root.",
    ].join("\n");
  }

  return roots
    .map((root) => {
      if (root.source === "project") {
        return [
          `- [project] Install from the project root with \`npx -y skills add ${spec_argument} -y\`.`,
          `  The installed skill must end up under \`${root.resolved}/<skill-id>/SKILL.md\`.`,
        ].join("\n");
      }
      if (root.source === "home") {
        return [
          `- [home] Install globally with \`npx -y skills add ${spec_argument} -g -y\`.`,
          `  The installed skill must end up under \`${root.resolved}/<skill-id>/SKILL.md\`.`,
        ].join("\n");
      }
      return [
        `- [custom] Install or copy the skill into \`${root.resolved}/<skill-id>/SKILL.md\`.`,
        "  The skills CLI has no generic custom-root flag, so verify the final path instead of assuming installation succeeded.",
      ].join("\n");
    })
    .join("\n");
}

/**
 * 生成 find action 返回的纯提示词。
 */
export function render_skill_find_prompt(query: string): string {
  const query_argument = quote_shell_argument(query);
  return [
    "# Find Skill Instructions",
    "",
    "This action only returns instructions. It has not searched for or installed anything.",
    "Use the available web or browser capability to search these Skill catalogs:",
    "- https://www.skills.sh/",
    "- https://app.lobehub.com/community/skill",
    `Use the available shell tool to run \`npx -y skills find ${query_argument}\`.`,
    "Compare the catalog and CLI results, then choose an installation spec before calling the `skill.install` action.",
  ].join("\n");
}

/**
 * 生成 install action 返回的扫描感知纯提示词。
 */
export function render_skill_install_prompt(
  project_root: string,
  options: SkillPluginOptions | null | undefined,
  spec: string,
): string {
  const roots = getSkillSearchRoots(project_root, options);
  const spec_argument = quote_shell_argument(spec);
  return [
    "# Install Skill Instructions",
    "",
    "This action only returns instructions. It has not installed or changed any files.",
    "Install only into one of the configured scan roots:",
    render_install_root_instructions(roots, spec_argument),
    "",
    [
      "After the shell installation command completes, call",
      "`plugin_call({ plugin: \"skill\", action: \"list\", payload: {} })`",
      "and check whether the new skill appears. Then call `skill.lookup` before using it.",
    ].join(" "),
  ].join("\n");
}

/**
 * 渲染 skills 系统提示片段。
 *
 * 约束（中文）
 * - 为控制 token 成本，最多展示前 40 个 skill。
 * - roots 会按扫描顺序输出，便于排查冲突覆盖。
 * - 查找与安装指引必须根据实际 roots 生成，不能假设固定安装范围。
 */
export function render_skills_prompt_section(
  project_root: string,
  options: SkillPluginOptions | null | undefined,
  skills: SkillDefinition[],
): string {
  const roots = getSkillSearchRoots(project_root, options);

  const skills_section =
    skills.length > 0
      ? skills
          .map((skill) => {
            const desc = skill.description ? ` - ${skill.description}` : "";
            return `- **${skill.name}**${desc}`;
          })
          .join("\n")
      : "- (none)";

  const roots_section =
    roots.length > 0
      ? roots
          .map((root) => {
            return `- [${root.source}] ${root.display} -> ${root.resolved}`;
          })
          .join("\n")
      : "- (none)";

  const ignore_notice =
    Array.isArray(options?.ignore) && options.ignore.length > 0
      ? "Configured ignore rules are active. A matching skill will not appear in `list`, even if its files exist in a scan root."
      : "";

  return [
    "# Runtime Skills Inventory",
    "",
    `Discovered ${skills.length} learned/installed skill(s).`,
    "All skills in `Available Skills` are already available locally.",
    "",
    "## Available Skills",
    skills_section,
    "",
    "## Skill Roots (scan order, higher wins on conflicts)",
    roots_section,
    "",
    "## Missing Skill Workflow",
    "Call `skill.find` with the search query to receive Shell search instructions.",
    "After choosing a spec, call `skill.install` to receive scan-aware installation instructions.",
    "Both actions return prompts only. They do not execute commands or change files.",
    ignore_notice,
  ]
    .filter(Boolean)
    .join("\n");
}
