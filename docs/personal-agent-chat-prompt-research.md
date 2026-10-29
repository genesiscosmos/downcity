# Personal agent 聊天提示词研究

本文研究个人助手公开提示词中与语气、长度和对话感相关的规则，并记录 Downcity 的调整依据。用户确认后，已更新默认 core 文本、生成资产及中英文说明文档；实际模型对话效果尚待验证。

## 结论

最值得参考的是 Hermes 的回复长度控制、Claude 的日常表达方式，以及 OpenClaw 对人格和操作规则的分工。要把“自然、简短”变成可执行的行为：简单问题直接短答，完成任务只说关键结果，少用模板化开场和重复总结，需要深入时再展开。

“拟人化”在这里指自然的表达、对上下文的理解和有依据的判断，不需要假装有真人经历、强行亲密或每句话都加语气词。

## 研究范围与证据

选择三个公开源码的个人 agent：OpenClaw、Hermes Agent、nanobot；另用 Claude 官方公开 system prompt 和 OpenAI Model Spec 作为通用个人助手的表达参考。此选择用于比较设计，不代表市场份额排名。

三个开源 agent 的相关文件已直接读取原文；Claude 和 OpenAI 部分依据官方页面的搜索索引摘录。Claude 页面在当前浏览器中跳转到区域不可用页面，未完整核读。OpenAI Model Spec 是公开行为规范，不是 ChatGPT 当前生产环境完整 system prompt。没有把第三方泄露提示词当作官方资料，也没有进行跨模型效果实测。

开源仓库链接指向 main，后续可能变化。下述引文对应本次读取内容。

| 对象 | 可核查的规则 | 对 Downcity 的启发 |
| --- | --- | --- |
| Hermes Agent | 问题长度与回答长度匹配；完成任务简报结果；不复述请求、重复总结或解说用户已看见的工具调用 | 最接近当前“少说、说重点”的目标 |
| nanobot | 默认短答；用户要求深入时再展开；知道与不知道的内容说清楚 | 用很少规则定义稳定默认行为 |
| OpenClaw | 跳过客套开场；有判断；必要时详细；人格语气放 SOUL，工作规则放 AGENTS | 保留各 Agent 个性，避免把聊天默认风格变成完整人设 |
| Claude | 日常对话用自然句子和段落；简单问题可仅几句话；减少列表 | 降低报告感和模板感 |
| OpenAI Model Spec | 根据当下对话判断何时深入、何时简短；清楚、直接、温暖 | 长度应随需求变化，不能机械限制字数 |

## 值得借鉴的具体做法

### Hermes：直接约束常见的啰嗦行为

[默认 SOUL.md](https://github.com/NousResearch/hermes-agent/blob/main/SOUL.md) 中的两段很明确：

> a one-line question gets a one-line answer

> finished work gets a short report of what changed, what's verified, and what's left, never a replay of the process

它还明确排除客套开场、复述用户请求、重复总结和解说可见工具调用。这些比单独一句“be concise”更容易检查，也直接覆盖了 agent 常见的长篇工作汇报。

可以借鉴“回复长度随需求变化”和“只报告结果”的原则。具体长度仍应允许必要例外，例如信息缺失、结果有重要限制，或用户明确要求说明原因。

### nanobot：保持默认规则短小

[默认 SOUL.md](https://github.com/HKUDS/nanobot/blob/main/nanobot/templates/SOUL.md) 的核心规则包括：

> Keep responses short unless depth is asked for.

> Say what I know, flag what I don't, and never fake confidence.

它把短答、诚实和友好放在一起。简洁不应造成武断，口语化也不应降低信息可靠性。这适合作为平台默认风格的基调。

### OpenClaw：让人格有明确的行为作用

[SOUL 模板](https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/SOUL.md) 要求跳过 “Great question!” 和 “I'd be happy to help!” 等客套话，并强调：

> Concise when needed, thorough when it matters.

[官方人格指南](https://github.com/openclaw/openclaw/blob/main/docs/concepts/soul.md) 进一步把语气、判断、简洁、幽默放到 SOUL，操作约定放到 AGENTS。指南中的示例重写提示还提出：一句话能回答，就只说一句话。

这是一份可选的人格强化指南，并不意味着所有实例默认使用其中每条规则。其强烈立场、粗口等建议不适合作为 Downcity 全平台默认。可以吸收自然表达、有依据的判断和克制的幽默，让具体人格由 Agent 配置承担。

### Claude 与 OpenAI：自然对话需要匹配场景

[Claude Opus 4.6 官方公开 prompt](https://platform.claude.com/docs/en/release-notes/system-prompts/claude-opus-4-6) 的索引内容明确要求：普通对话或简单问题保持自然语气，优先句子和段落，日常回答可以只有几句话。

不建议照搬其对列表的全部限制。Downcity 有代码、步骤和对比场景，列表或表格在这些场景中更清楚。

[OpenAI Model Spec](https://model-spec.openai.com/2025-12-18.html) 的 “Have conversational sense” 则强调按当下需求选择深入解释、摘要或对话式回应。对我们有用的是这种场景判断，而不是全局固定字数上限。

## Downcity 当前情况

当前默认文本来自 [core.prompt.ts.txt](../packages/agent/src/model/prompts/assets/core.prompt.ts.txt)，其中与表达相关的规则主要是：

> keep replies direct, clear, and as brief as the task allows

这说明方向，但没有说明具体怎么做到。模型仍然可能通过“标题、分点、背景、结论、总结”的模板完成一个简单回答。

[AgentInstructions.ts](../packages/agent/src/agent/AgentInstructions.ts) 将身份和调用方 instruction 合并为 Agent block，再独立注入 core。这个函数本身不区分 Chat、Work、Task；若直接修改 core，应按共享默认规则评估影响，不能假定只影响 Chat。

此外，Agent 自己的 instruction、各 Power 的提示和历史对话也可能鼓励详细输出。默认 core 可以改善基调，但实际效果需要结合完整装配后的 prompt 判断。当前会话里的详细写作要求就说明，风格来源不止一个。

继续检查 public 和 private 的源码后，在本次搜索覆盖范围内，没有找到与当前会话中 “Writing style / Intermediate commentary / Final answer” 相同的内置默认模板。[AgentRepository.ts](../packages/city/src/local/repositories/AgentRepository.ts) 的 `read_soul` 表明 Agent 主体指令从持久化文件读取。因此不能把本会话所有写作要求都归因于仓库的默认 core；也不应通过此次改动直接覆盖用户已有 Agent 人设。

还有一个生效边界：[StepInput.ts](../packages/agent/src/session/input/StepInput.ts) 在首次组装后冻结 Session 的 system。已有快照不会仅因修改源文件自动更新；`syncshot()` 提供显式重新组装入口。实施后应先用重新加载新版代码的新会话验证，已有会话的刷新单独操作。

## 建议修改方案

第一步，在现有默认 prompt 中加入短小的表达规则，先明确日常短答、自然措辞、减少重复和结果汇报方式。保留现有操作、授权、隐私和长文档交付规则。

建议的表达部分如下，作为待确认草案，尚未写入运行时：

```text
Speak naturally, using everyday words and short sentences. Match the user's language and tone while keeping the Agent's own personality. Be warm and candid; let humor arise naturally when it fits.

Keep replies short by default. Answer simple questions in one or a few sentences, then stop. Add detail when the user asks or when it is needed to understand the answer or make a decision.

Prefer short paragraphs in everyday conversation. Use headings, lists, or tables when they make the content easier to follow. Skip canned openings, restating the request, repeated summaries, and routine offers to help further.

After doing work, briefly report the result, relevant verification, and anything unresolved. Keep progress updates brief and useful. State uncertainty plainly and give your own judgment when you have a reason.
```

“简单问题一句或几句”是默认指引，不是硬性字数限制。不要全局限制 max_tokens 来实现简洁，否则可能截断代码、文档或必要说明。

此处的“口语化”应随语言自然表达。中文使用常用词和短句，避免公文式措辞；不要把每句加上“呀、呢、哦”、固定称呼或表情作为验收指标。自然的追问应由当前语境决定，避免每条回复都附带“需要我继续吗”。工作完成时仅在有相关信息时报告验证或未解决事项，不把每次回答都套进同一个汇报模板。

第二步，检查默认 Agent 模板和实际装配的系统提示。若其中存在普遍要求每轮详述背景、过程和完整总结的规则，再单独精简；用户特意配置的详细风格需要尊重。

如果最终确定仅 Chat 应使用这套表达，Work 和 Task 需要不同交付密度，则再设计按 Session 类型注入的风格层。当前无需仅为语气优化先引入新的配置体系。

待确认的第一轮实施范围是：修改 `core.prompt.ts.txt` 的表达规则，使用现有生成流程更新对应 TypeScript 资产，同步 `session-chat-system-prompt.md`，并检查 homepage 的 Agent 文档是否需要说明默认回复风格。先确认共享 core 的影响范围，再执行源码修改。当前研究文档的创建和补充不代表运行时改动已获确认。

## 预期表达示例

以下为人工编写的目标示例，不是运行模型后的测试结果。

| 用户输入 | 目标回复 |
| --- | --- |
| 在吗 | 在，怎么了？ |
| 这个方案你怎么看 | 我倾向先做单机版。当前规模用不上分布式，后面拆也来得及。 |
| 改好了没 | 改好了，类型检查通过。还没验证实际登录流程。 |
| 今天不想干活 | 那就缓一缓。是累了，还是被哪件事卡住了？ |
| 详细讲讲为什么 | 根据问题完整解释原因、取舍和例子，允许更长回答。 |

验收时，用相同输入对比修改前后的回答，覆盖闲聊、事实问答、工作进度、任务完成、失败和用户要求详细解释的场景。重点观察是否更自然、是否删除重复、是否保留关键事实，以及需要展开时是否仍能完整回答。提示词文件检查只能验证装配，不能替代真实模型对话评估。

## Muse 与 Grok Bot 补充研究及落地

后续查到的 [Muse agent 社区收录版](https://github.com/asgeirtj/system_prompts_leaks/blob/main/Meta/muse-agent/workspace/system/system_prompt.md) 和 [Grok Bot 社区收录版](https://github.com/asgeirtj/system_prompts_leaks/blob/main/xAI/grok-bot/grok-bot.md) 更贴近本次目标。这两份没有官方确认其完整性和当前生产使用状态，作为设计参考使用。

Grok Bot 的 `User communication style` 要求大部分回复一两句、使用普通词和完整句子、先给答案，避免客服腔和不必要的小标题。Muse 的 `Writing Style` 和 `Final Response Brevity` 强调像聊天发消息，删重复和跑题，同时保留实质；最终答复简短不应减少前面的研究与执行工作。

[xAI 官方 prompt 仓库](https://github.com/xai-org/grok-prompts) 主要收录 Grok 聊天助手和 X 上的 @grok，不能直接当作独立 Grok Bot 的完整提示词。[Muse 官方设计文章](https://introducing.muse.ai/) 公开部分设计理念和提示词片段，并非完整 prompt。

本次实施吸收上述表达原则，更新共享 core 的默认风格，并保留 Agent 人格、执行边界和深入解释的空间。`@downcity/agent` 构建已通过；编译产物与文本源一致，Agent 指令和 core 均保留。此前章节中的建议稿和待确认范围保留为研究记录，以实际 core 文本为准。

## 来源

- [Hermes Agent 默认 SOUL.md](https://github.com/NousResearch/hermes-agent/blob/main/SOUL.md)
- [nanobot 默认 SOUL.md](https://github.com/HKUDS/nanobot/blob/main/nanobot/templates/SOUL.md)
- [OpenClaw 默认 SOUL 模板](https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/SOUL.md)
- [OpenClaw 官方人格指南](https://github.com/openclaw/openclaw/blob/main/docs/concepts/soul.md)
- [Claude 官方 system prompt 说明](https://platform.claude.com/docs/en/release-notes/system-prompts/overview)
- [Claude Opus 4.6 公开 system prompt](https://platform.claude.com/docs/en/release-notes/system-prompts/claude-opus-4-6)
- [OpenAI Model Spec：2025-12-18 公开版本](https://model-spec.openai.com/2025-12-18.html)
