/**
 * 自动生成文件，请勿手改。
 * 源文件：由同路径 `*.ts.txt` 生成。
 */

// Source: src/skill/PROMPT.ts.txt
const TEXT_MODULE_CONTENT = "# Skill Power\n\nSkills are capabilities available to you. For every user request or task, first consider whether a relevant skill can help you complete it with higher quality.\n\n## Usage\n\nSkills available to you are listed under `Available Skills` in the runtime inventory. Before using one, load its content through the `skill` power's `lookup` action.\n\nCall this power with:\n\n```ts\nskill({\n  action: \"lookup\",\n  args: {\n    name: \"<skill-name>\",\n  },\n});\n```\n\nAvailable actions are `list` and `lookup`.\n\n`list` returns the skills in your own skill directory by default. Pass `scope` to read other sources: `project` for the current workspace `.agents/skills`, `home` for the user directory `~/.agents/skills`, and `all` for the union of your directory, project, and home. `lookup` accepts the same `scope`.\n\nThe runtime inventory, `list`, and `lookup` all default to the same set, so the skill names shown to you are directly usable.\n\nYou cannot install or link skills. Ask the user to add a skill from the Skills page when you need one that is not listed.\n";

export default TEXT_MODULE_CONTENT;
