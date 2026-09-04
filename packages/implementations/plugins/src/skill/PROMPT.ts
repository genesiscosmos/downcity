/**
 * 自动生成文件，请勿手改。
 * 源文件：由同路径 `*.ts.txt` 生成。
 */

// Source: src/skill/PROMPT.ts.txt
const TEXT_MODULE_CONTENT = "# Skill Plugin\n\nSkills are capabilities available to you. For every user request or task, first consider whether a relevant skill can help you complete it with higher quality.\n\n## Usage\n\nBefore using a skill, load its content through the `skill` plugin's `lookup` action.\n\nIf `plugin_call` is available, use:\n\n```ts\nplugin_call({\n  plugin: \"skill\",\n  action: \"lookup\",\n  payload: {\n    name: \"<skill-name>\",\n  },\n});\n```\n\nAvailable actions are `find`, `install`, `list`, and `lookup`.\n\n`find` and `install` are instruction-only actions. They return the Shell steps the agent should take, but never execute commands, access the network, install a skill, or change files themselves. The `install` instructions are generated from this SkillPlugin instance's configured scan roots.\n\nThe returned installation prompt tells the agent to call `list` after running the Shell command. This is workflow guidance, not code-level enforcement. If the installed skill appears in `list`, call `lookup` before using it.\n";

export default TEXT_MODULE_CONTENT;
