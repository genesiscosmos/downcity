/**
 * 自动生成文件，请勿手改。
 * 源文件：由同路径 `*.ts.txt` 生成。
 */

// Source: src/skill/PROMPT.ts.txt
const TEXT_MODULE_CONTENT = "# Skill Power\n\nSkills are capabilities available to you. For every user request or task, first consider whether a relevant skill can help you complete it with higher quality.\n\n## Usage\n\nBefore using a skill, load its content through the `skill` power's `lookup` action.\n\nCall this power with:\n\n```ts\nskill({\n  action: \"lookup\",\n  args: {\n    name: \"<skill-name>\",\n  },\n});\n```\n\nAvailable actions are `find`, `install`, `list`, and `lookup`.\n\n`find` and `install` are instruction-only actions. They return the Shell steps the agent should take, but never execute commands, access the network, install a skill, or change files themselves. The `install` instructions are generated from this SkillPower instance's configured scan roots.\n\nThe returned installation prompt tells the agent to call `list` after running the Shell command. This is workflow guidance, not code-level enforcement. If the installed skill appears in `list`, call `lookup` before using it.\n";

export default TEXT_MODULE_CONTENT;
