# Desktop 语义字号规范（Type Scale）

> 状态：已实施
>
> 目标范围：
>
> - 修改 `app/desktop/src/renderer/styles/tokens.css`（9 级档位 + 清空 Tailwind 默认字号命名空间）
> - 修改 `app/desktop/src/renderer/lib/utils.ts`（把档位注册进 tailwind-merge 的 `font-size` 组）
> - 修改 `app/desktop/src/renderer/features/chat/components/messages/message_layout.ts`（消息正文改走语义档位）
> - 修改 `app/desktop/src/renderer/styles/{chat,base,mermaid}.css`（字号改引语义令牌）
> - 迁移 `app/desktop/src/renderer/` 下 61 个文件、311 处字号调用点
> - 新增 `app/desktop/tests/font_scale.test.ts`；重写 `app/desktop/tests/tailwind_merge_classes.test.ts`
>
> 文档性质：字号的设计合同。**新增界面时的选档依据以本文为准**，不依赖任何调用点的历史取值。

---

## 一、结论摘要

### 1.1 现状（改动前）

Desktop 的字号不是「一套体系」，而是「每次改界面时随手加一档」的结果。渲染层里同时存在 13 档字号：

| 档位 | 出现次数 | 来源 |
| --- | --- | --- |
| `text-xs`（0.75rem） | 151 | Tailwind 默认档 |
| `text-[0.6875rem]` | 61 | 任意值 |
| `text-[0.625rem]` | 39 | 任意值 |
| `text-sm`（0.875rem） | 24 | Tailwind 默认档 |
| `text-[0.8125rem]` | 12 | 任意值 |
| `text-[0.5625rem]` | 10 | 任意值 |
| `text-base` / `text-lg` / `text-2xl` / `text-xl` | 4 / 3 / 3 / 2 | Tailwind 默认档 |
| `text-[0.75rem]` / `text-[0.78125rem]` | 2 / 1 | 任意值 |
| 样式表内 `font-size` 字面量 | 28 | `chat.css` / `mermaid.css` |

三个直接后果：

1. **相邻档只差 0.5px**（0.625 与 0.65625、0.6875 与 0.71875、0.75 与 0.78125rem）。这种差别人眼看不出，所以「该用哪一档」在每个调用点都要重新决定一次，而决定结果无法被 review 校验。
2. **一半是任意值。** `text-[0.6875rem]` 这类写法不跟随界面缩放（缩放通过根元素 `font-size` 实现），也不受任何规则约束，新代码只能靠模仿邻居。
3. **没有「默认档」概念。** 结果是最常见的档位（`text-xs`）并不是应该承载正文的那一档，而消息正文另外用了 `text-sm`。

### 1.2 决策

- **字号收敛为 9 级语义档位**：`text-3xs` … `text-3xl`。
- **单位一律 rem。** 字号与配对行高全部用 rem，没有 px。
- **七个与 Tailwind 同名的档位（`xs` … `3xl`）必须与 Tailwind 默认主题完全等值**，包括配对行高。`3xs` / `2xs` 是 Tailwind 没有的名字，按本应用需要取值。
- **Tailwind 自带的档位命名空间全部清空**（`--text-*: initial`）：`text-4xl` 及以上不再生成规则。不清就有退路，收敛会立刻失效。
- **所有字号只用 Tailwind 语义工具类。** 样式表里也只允许 `var(--text-<档位>)`，不再出现任何字面量（文档方言例外见 §六）。
- **选档按角色**，不按数值：每一级对应一组允许出现的表面（§四），新需求只能复用已有级别。

### 1.3 为什么这次不再「绕开」

历史上有一次失败的收敛尝试，值得记录，因为它决定了本次的实现方式。

消息正文曾经用过自定义工具类 `text-message`，结果连畳八轮「调整字号」在浏览器里毫无效果。根因是 `cn()` 底层的 tailwind-merge 不认识该档名，把它归入「文字颜色」组：

```text
twMerge("text-message text-foreground") → "text-foreground"   // 字号类被当成冲突颜色删掉
```

当时的结论是**绕开工具类**：字号改用 `styles/chat.css` 的普通类 `.chat-message-text`，不参与 twMerge 归类，也不依赖扫描器产物。那个决定救回了字号，但代价是把字号移出 Tailwind 的语义体系，应用里多了一套只此一处的例外写法。

本次要求「全部使用 Tailwind 语义大小」，所以必须修根因而不是绕开：`lib/utils.ts` 用 `extendTailwindMerge` 把 9 个档位注册进 `font-size` 组。`text-<档位>` 与 `text-<颜色>` 从此分属两组，互不冲突，普通类这个逃生口随之删除。

这条链路（源码类名 → 扫描器命中 → 生成规则 → twMerge 保留）一共有 4 个可以静默失败的关口，本次为每一道都补了守卫（§八）。

---

## 二、档位表

定义在 `styles/tokens.css`，**值全部为 rem**。

| 档位 | 字号 | 配对行高 | 与 Tailwind | 语义角色 |
| --- | --- | --- | --- | --- |
| `text-3xs` | 0.625rem | 0.875rem | 自有档位 | 极短标签、角标 |
| `text-2xs` | 0.6875rem | 1rem | 自有档位 | 元信息 |
| `text-xs` | 0.75rem | 1rem | 等值 | 辅助正文 |
| **`text-sm`** | **0.875rem** | **1.25rem** | 等值 | **默认正文** |
| `text-base` | 1rem | 1.5rem | 等值 | 强调正文 |
| `text-lg` | 1.125rem | 1.75rem | 等值 | 区块标题 |
| `text-xl` | 1.25rem | 1.75rem | 等值 | 面板标题 |
| `text-2xl` | 1.5rem | 2rem | 等值 | 页面主标题 |
| `text-3xl` | 1.875rem | 2.25rem | 等值 | 保留（当前无调用点） |

四点约定：

1. **`sm` 是本应用的默认正文档。** 任何「普通文字」默认用它。注意它比 Tailwind 的 `base` 小一档——本应用是密集的桌面工具，正文不用浏览器默认的 1rem（§三.2 说明了原因）。
2. **行高与字号成对，但可以单独覆盖。** Tailwind 生成的声明是 `line-height: var(--tw-leading, var(--text-sm--line-height))`，因此显式 `leading-*` 永远优先。只有消息正文这么做（§五）。
3. **不加第 10 级。** 需要「比 `xs` 大一点、比 `sm` 小一点」时，答案是把其中一侧整体移到相邻档，而不是插一级。13px 就是这么消失的（§七.2）。
4. **`3xl` 目前没有调用点**，是为将来的全屏引导页保留的。它必须与 Tailwind 等值，所以不能为了「看起来有用」而改成 1.5rem——那正是 `2xl`。

---

## 三、与 Tailwind 等值（硬要求）

### 3.1 要求本身

`xs` / `sm` / `base` / `lg` / `xl` / `2xl` / `3xl` 的字号与配对行高**必须与 Tailwind 默认主题完全一致，不允许任何偏移**：

| 档位 | 字号 | 配对行高 |
| --- | --- | --- |
| `xs` | 0.75rem | 1rem |
| `sm` | 0.875rem | 1.25rem |
| `base` | 1rem | 1.5rem |
| `lg` | 1.125rem | 1.75rem |
| `xl` | 1.25rem | 1.75rem |
| `2xl` | 1.5rem | 2rem |
| `3xl` | 1.875rem | 2.25rem |

**为什么必须等值：** 档名是前端的公共词汇。只要同名不同值，从 Tailwind 文档或其他项目复制类名就会拿到错误的尺寸，而错误只在渲染后才看得出来。这类偏移还特别容易被「都是相对单位、看着差不多」合理化，所以它不能靠约定，得靠测试。

**怎么保证：** `font_scale.test.ts` 不维护自己的期望表，而是**编译一份 Tailwind 默认主题，把 `--text-*` 真值读出来**，再与 `tokens.css` 逐项对照。Tailwind 升版改了默认值，测试会失败并要求重新对齐。该文件还带一条自检（Tailwind 的 `xs` 必须是 0.75rem），避免解析方式失效后测试恒真。

行高同理等值。Tailwind v4 用比例写法（`calc(1.25 / 0.875)`），其计算值与 `tokens.css` 里写的绝对 rem 完全相同，且两种写法在界面缩放下同比例变化；测试接受任一种写法，比对的是折合后的 rem。

### 3.2 等值带来的两个后果

**后果一：`base` 不再是「默认档」。**
Tailwind 的 `base` = 1rem = 浏览器默认字号，等值之后本应用的 `base` 也是 1rem。但本应用的正文用 `sm`（0.875rem）：16px 已经在 `docs/desktop-agent-message-rendering-redesign-prd.md` 第 24 节被用户明确否过（「太大了」），而且 1rem 正文会顶到块间距约束的边界（§五.1）。

所以 `base` 在本应用的角色是「强调正文」，只有创作向导的大号输入在用（4 处），日常最常用的档是 `sm` 与 `xs`。这是「等值」与「正文 14px」两条要求相交后的唯一解，不是遗漏。

**后果二：13px 从阶梯里消失。**
Tailwind 的档位表是 0.75 / 0.875 / 1 / …，13px（0.8125rem）不在其中。等值之后它只能并入相邻档——这是本次唯一需要判断的地方，见 §七.2。

---

## 四、选档规则（按角色，不按数值）

### 4.1 每级允许出现的表面

| 档位 | 允许的表面 | 当前实例 |
| --- | --- | --- |
| `3xs` | 不承载阅读的位置：图表坐标轴刻度、头像首字母、计数角标、极短的状态标签 | `UsageLineChart` / `ModelPricingChart` 的轴标签、`AccountSwitchList` 的首字母、`CollapsibleModelGroup` 的计数 |
| `2xs` | 元信息：时间戳、文件名、chip、字段键名、工具行细节、快捷键提示 | `ChatMessageTimestamp`、`WorkspaceTagMenu`、`ActivityToolState` 的细节行、`button.tsx` 的 `default/small` 档 |
| `xs` | 辅助正文：列表项的次要行、帮助文案、空态说明、提示与错误 | `SettingComponents` 的描述行、`ChatSubjectList` 的会话摘要、`SessionTimeline` 的 Agent 描述、消息的失败提示条 |
| `sm` | 默认正文与常规控件：消息正文、通用段落、按钮标签、标准输入、**列表行主标签** | `message_layout` 的正文与容器兜底、`button.tsx` 的 `large`、`SettingComponents` 的标签、Workspace README |
| `base` | 强调正文：创作向导里的大号输入（用户视线焦点） | `CreateAgentView` / `CreateGroupView` 的 prompt 输入、`AgentView` 的名称输入 |
| `lg` | 区块标题、关键数值 | `SettingComponents` 的页标题、`SettingsView` 的额度金额 |
| `xl` | 面板标题、主数值 | `SettingsView` 的账号名与用量数值 |
| `2xl` | 页面主标题：**每屏至多一个** | `CreateAgentView` / `CreateGroupView` 的问题标题、`WorkspaceView` 的 Workspace 名 |
| `3xl` | 保留。需要全屏引导页式的主标题时才启用 | —（当前无调用点） |

### 4.2 判断顺序

给一个新界面选档时，按顺序回答三个问题，第一个「是」就是答案：

1. 这段文字是**用户要连续阅读的内容**吗（消息、段落、文档）？→ `sm`。
2. 这个界面里**唯一的主标题**吗？→ `2xl`。是一个**区块的标题**吗？→ `lg`。是**面板的标题**吗？→ `xl`。
3. 它属于某个**更大文字的附属信息**吗（描述、时间、计数、说明）？→ 降一档到两档：列表行主标签用 `sm`，描述用 `xs`，元信息用 `2xs`，不承载阅读的用 `3xs`。

三条反例（都不允许）：

- 「这个列表比别处挤，所以这里用 `2xs`」——密度差异应该由**行高与间距**表达，不是字号。列表主标签是全应用的 `sm`。
- 「这一行有 3 个信息，用 3 个字号区分」——层级用颜色（`foreground` / `muted-foreground` / `subtle-foreground`）与字重表达。同一行最多两个字号档。
- 「这里差 1px 才够」——字号不是对齐工具。相邻档差 0.0625rem 以上是刻意的：可见的差别才值得存在；不可见的差别只会养出 13 档那种局面。

---

## 五、行高：配对行高 + 阅读行高

每个档位都声明了配对行高，值与 Tailwind 等值，所以 UI 文本不需要各自写 `leading-*`。

唯一的例外是消息正文：

```ts
// message_layout.ts
export const chat_message_text_class_name = "text-sm leading-reading text-foreground";
```

- 正文用 `sm`（0.875rem），**不新开一级**。
- 行高单独取 `--leading-reading`（1.8，无单位倍数）：`sm` 的配对行高是 1.25rem，是 UI 文本的密度，对长段落太挤。

1.8 不是随手取的，是两条用户反馈夹出来的：0.8125rem 被「有点小」否、0.9375rem 被「还是很大」否，取 0.875rem；行高从 1.7 调到 1.8 才被认为「行内间距够了」。完整过程见 `docs/desktop-agent-message-rendering-redesign-prd.md` 第 24 节。

**四处必须同值**：Agent 正文、用户消息、Group 的两种发言（都走上面的常量），以及 Composer（`base.css` 的 `.chat-input-editor`，用同一对令牌）。理由是 Composer 与用户气泡是同一段文字在发送前后的两种状态——不同值会出现「按下回车，文字突然变小」，而那只在发送瞬间可见。

### 5.1 与字号绑定的硬约束

`.markdown` 的段落间距是 `0.5em`（随正文字号缩放），它必须比消息内的块间距（`gap-2.5` = 0.625rem）小至少 0.125rem：

```text
0.5 × 字号 ≤ 0.625rem − 0.125rem  ⇒  字号 ≤ 1rem
```

也就是说**消息正文不得超过 `base`**。当前 `sm`（0.875rem）下差值为 0.1875rem；就算换成 `base`（1rem）也刚好触底，但那时正文就是 16px 了，与用户反馈冲突。所以实际上限是 `sm`。

这条约束由 `chat_message_layout.test.ts` 守着——它把三个量级都换算成 rem 再比较，因此**不需要知道根字号是多少**，与界面缩放无关。调大正文字号时它会失败，这是有意的：加字号必须同时加块间距，否则正文与工具活动会粘在一起。

---

## 六、文档方言：有意保留的 em 相对值

`markdown.css`、`mermaid.css`、`base.css` 里的 `font-size` 仍是 **em 相对值**：

```css
.markdown :where(h1) { font-size: 1.55em; }
.markdown :where(code) { font-size: 0.92em; }
```

它们不是 UI 层级，而是**文档方言**：Markdown 的标题、行内码、表格，以及 Mermaid 图表内的文字，都相对**承载它们的正文字号**缩放。同一段 Markdown 会出现在消息正文（`sm`）、Workspace 文档预览（`sm`）与 Plugin 说明（Plugin 自己的 `xs`）里，正文一变它们必须跟着变。换成绝对档位反而会与所在的阅读容器脱钩。

因此规则是：

- UI 层级（**决定这段文字有多重要**）→ 只能 `text-<档位>`。
- 文档方言（**相对宿主缩放**）→ 允许 `em`，且只允许出现在上述三个样式表里。

---

## 七、迁移

### 7.1 档名整体下移一位

等值要求把 `base` 定在 1rem，于是 `xs` 以上的每个档名都要下移一位才能保住原来的尺寸。**除 13px 外，没有任何字号变化**：

| 旧档名 | 旧值 | 新档名 | 新值 | 是否变号 |
| --- | --- | --- | --- | --- |
| `3xs` | 0.625rem | `3xs` | 0.625rem | 否 |
| `2xs` | 0.6875rem | `2xs` | 0.6875rem | 否 |
| `xs` | 0.75rem | `xs` | 0.75rem | 否 |
| `sm` | 0.8125rem | `sm` | 0.875rem | **是（见 7.2）** |
| `base` | 0.875rem | `sm` | 0.875rem | 否 |
| `lg` | 1rem | `base` | 1rem | 否 |
| `xl` | 1.125rem | `lg` | 1.125rem | 否 |
| `2xl` | 1.25rem | `xl` | 1.25rem | 否 |
| `3xl` | 1.5rem | `2xl` | 1.5rem | 否 |

### 7.2 13px 的归属（本次唯一需要判断的地方）

Tailwind 的阶梯里没有 0.8125rem，这 16 处必须选一个方向。**选中 `sm`（0.875rem，向上）**：

| 位置 | 处数 |
| --- | --- |
| 列表行主标签与表单控件文字：`SettingsView` 账号与额度行、`AccountSwitchList`、`SettingComponents` 的设置行标签、`TurnFileDiffCard` 标题、`PluginRendererComponents` 的默认正文/标题/空态、`AgentView` 与 `WorkspaceView` 的输入 | 12 |
| 活动与交互卡片：`.activity-tool-row`、`.activity-tool-name`、`.activity-tool-state`、`.interaction-card-title` | 4 |

**理由：** 12 处是「列表行主标签」，它们配对的描述文字是 0.6875–0.75rem。上移到 0.875rem 能拉开 0.125rem 以上的层次；沉到 `xs`（0.75rem）反而会与描述同级——而 `xs` 正是全应用 153 处描述文字所在的档。

**已知取舍：** 剩下 4 处是活动行与交互卡片的文字（`.activity-tool-row` / `.activity-tool-name` / `.activity-tool-state` / `.interaction-card-title`）。它们上移后与正文同为 0.875rem，与正文的区别只剩行高（1.3 vs 1.8）、颜色（58%–82% 混色 vs 全色）与更内层的细节档（细节 0.6875rem、计数 0.625rem）。

这是本次迁移里唯一「两种做法都讲得通」的决定，且**只需一行就能改**：把这四条规则改成 `var(--text-xs)`，活动行就比正文小一档（正文 0.875 > 活动 0.75 > 细节 0.6875 > 计数 0.625），代价是失去 12 处列表标签的层次。选哪边取决于产品判断，不取决于实现。

### 7.3 用户可见变化

**字号变化的共 32 处**（代码 23 处 + 样式表 9 处，占全部 339 处声明的 9%），其余完全零变化：

| 位置 | 改动前 | 现在 | 处数 |
| --- | --- | --- | --- |
| 图表轴标签与图例（`UsageLineChart` 3 处、`ModelPricingChart` 7 处） | 0.5625rem | 0.625rem | 10 |
| Agent 消息的失败提示条（`AgentMessageContent`） | 0.78125rem | 0.75rem | 1 |
| 工具 diff 行（`.activity-tool-diff-line`）、提问选项描述（`.question-option-description`） | 0.65625rem | 0.625rem | 2 |
| 交互笔记输入（`.interaction-note-input`）、提问选项标签（`.question-option-label`）、Agent 消息内的资源 chip（`.agent-message-resource`） | 0.71875rem | 0.6875rem | 3 |
| 见 §7.2 的列表主标签 / 活动行 | 0.8125rem | 0.875rem | 16 |

尺寸账目守恒（代码层，按实际像素统计）：

```text
HEAD  9px×10  10px×39  11px×61  12px×152  12.5px×1  13px×12  14px×23  16px×4  18px×3  20px×2  24px×3   合计 310
现在           10px×49  11px×61  12px×153              14px×36  16px×4  18px×3  20px×2  24px×3            合计 311
```

（总数 +1 是因为消息正文的字号从普通 CSS 类 `.chat-message-text` 搬进了类名列表
`chat_message_text_class_name`，多出一处**显式声明**。尺寸本身不变。）

行高变化的只有**没有显式 `leading-*`** 的位置，且都在 0.0625rem 以内。`xs`（0.75/1rem）与 `sm`（0.875/1.25rem）的配对行高与 Tailwind 原生 `text-xs` / `text-sm` 完全相同，因此占多数的这两档**外观零变化**。这不是巧合：迁移的目标是「档名与 Tailwind 等值」，而不是顺手改版。

---

## 八、机制与守卫

### 8.1 三条实现要点

1. **清空默认命名空间。** `tokens.css` 的 `--text-*: initial` 让 Tailwind 不再生成 `text-4xl` 及以上。写了这些类名不会报错，只是不生成规则——所以这也是「防呆」而不只是「清理」。
2. **注册进 tailwind-merge。** `lib/utils.ts` 用 `extendTailwindMerge` 把 9 个档位放进 `font-size` 组。七级同名的档位 Tailwind 原生认得，仍然显式注册：两处清单保持一致，新增档位时不会出现「一半已注册、一半没注册」的状态。漏注册一级，那一级会在**所有** `cn()` 调用点被静默删除（§1.3 的缺陷）。
3. **普通类不再是逃生口。** 消息正文移除 `.chat-message-text`；`chat.css` 是无图层 CSS，优先级高于 `@layer utilities`，因此那里也不能再出现给正文定字号的规则。

### 8.2 守卫清单

| 文件 | 守住什么 |
| --- | --- |
| `tests/font_scale.test.ts` | **`xs` … `3xl` 与 Tailwind 默认主题的字号与行高逐项等值**（编译 Tailwind 本尊后比对）；自有档位 `3xs`/`2xs` 小于 `xs`；9 级、递增、全 rem、成对行高；代码里无 `4xl` 及以上、无任意值；**源码里每一个 `text-*` 类名都能被 Tailwind 生成规则**；样式表字号只引令牌或 em；`lib/utils.ts` 与 `tokens.css` 两份清单一致；9 级都真的生成规则；`4xl` 及以上一个都不生成 |
| `tests/tailwind_merge_classes.test.ts` | 跑真正的 `cn()`：四个真实调用点保留字号；**逐级**验证 9 个档位都能穿过 `cn()`；反向断言未注册的档名确实被删除（证明守卫不是恒真）；字号之间后者覆盖前者；消息正文不再依赖普通类 |
| `tests/design_token_drift.test.ts` | 渲染层不出现 `text-4xl` 及以上与 `text-[…rem]` 这类任意值 |
| `tests/chat_message_layout.test.ts` | 消息正文档位与行高同行同源；块间距 > 段落间距且差值 ≥ 0.125rem（等价于正文 ≤ `base`） |
| `tests/tailwind_tokens.test.ts` | 语义颜色 / 圆角令牌能生成工具类（字号部分已移交 `font_scale.test.ts`） |

两条值得单独说明的实现细节，都是「假保护」的常见来源：

- **用编译器当裁判，而不是名字模式。** 「哪些 `text-*` 是字号」无法靠前缀正则判断：颜色（`text-amber-600`）与对齐（`text-center`）同样以 `text-` 开头。改为把源码里所有 `text-*` token 喂给 Tailwind 编译，凡是**生成不出规则的**就是死类名。这比维护黑白名单准确，且能顺手抓出残留的旧档名与拼写错误。
- **判定规则存在必须带词边界。** `.text-2x` 是 `.text-2xs` 的前缀，用子串包含判定会把拼错的 `text-2x` 当成存在（这个漏洞在本次实现中被探针测出并修掉）。

守卫不是恒真的证据：本次用临时探针验证过三轮——写入 `text-sm` / `text-[0.8125rem]` / `text-size-42` 后 5 条测试失败；写入 `text-2x` / `text-xs2` / `text-basex` / `text-4xl` / `text-bse` 后死类名全部被报出；把 `--text-base` 改成 `0.9375rem` 后等值测试失败并给出「本应用 0.9375rem，Tailwind 1rem」。

### 8.3 验证

```bash
cd app/desktop && node --test tests/*.test.ts        # 423/424；唯一失败为既有的 qq 渠道断言
cd app/desktop && ./node_modules/.bin/tsc -p tsconfig.web.json --noEmit && ./node_modules/.bin/tsc -p tsconfig.node.json --noEmit
```

**完整 `electron-vite build` 在本环境跑不起来**（缺 `@rollup/rollup-linux-arm64-gnu` 原生模块），因此「扫描器是否命中」这条链路由 `font_scale.test.ts` 的第九条断言代替：它把源码里出现的每一个 `text-*` token 原样喂进 Tailwind 编译并断言能产出规则。发布前建议在本地补一次真实构建。

---

## 九、未处理（有意留在范围外）

- **`leading-[…]` 仍是任意值**（`leading-[1.7]`、`leading-[1.6]`、`leading-[1.65]`、`leading-[1.55]`、`leading-[1.45]` 共 6 处），以及 `leading-4/5/6/7` 这类间距尺度值。它们与字号不同：`leading-N` 是 rem 绝对值，会跟随界面缩放，不会静默失效；改成「每档一个语义行高」会改到所有正文的阅读节奏，超出本次「字号收敛 + 与 Tailwind 等值」的范围。
- **Plugin 自带的 Markdown 仍是 `xs`**（`PluginRendererComponents` 的默认正文与 CodeBlock）。它们是 Plugin 自己的 UI，宿主不应单方面改其密度；本次只按数值等值映射。
- **`markdown.css` 的 `em` 比值未重算**（`h1` 1.55em、`code` 0.92em）。它们在 `sm` 下的取值与改动前一致，重算属于排版审美调整，不属于字号收敛。
- **`3xl`（1.875rem）当前无调用点。** 它是 9 级阶梯的第 9 级，且必须与 Tailwind 等值，因此保留定义并在此记录，避免被误认为「死令牌」而删除或改值。
- **`homepage/` 与 `packages/ui/` 不在范围内。** homepage 是 Tailwind v3 + 自带 `tailwind.config.ts` 的营销站，`packages/ui` 尚未被 desktop 引用（desktop 的 `package.json` 里没有 `@downcity/ui`）。等 desktop 开始消费 `packages/ui` 时，需要让它在 `packages/ui/src/styles.css` 里声明同一套 `--text-*`，否则会出现第二套字号体系。
- **没有做视觉回归截图对比。** 变化集中在 32 处 ±0.0625rem（其中 16 处是 §7.2 的判断），建议在真实构建后用关键界面（会话正文与工具活动行、设置-模型列表、用量图表、命令面板）做一次目视确认。
