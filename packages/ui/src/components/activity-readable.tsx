/**
 * 非 Power 活动的只读详情，仅在父活动展开时挂载。
 * 正文有预览上限；问答仅回显，交互表单由输入区承载。
 */
import { MarkdownView } from "./markdown/MarkdownView";
import type { ActivityReadableBody, ActivityReadableDetail, ActivityText } from "../types/activity-readable";
import { activity_item_limit, bounded_text } from "../lib/activity/activity_detail_shared";
import { activity_file_language } from "../lib/activity/file-language";
import { use_control_translation as use_translation } from "../lib/control-messages";

/** 正文直接展示内容，只为错误、空结果或实际预览省略补充提示。 */
export function ActivityReadableDetailView({ detail, streaming }: {
  /** 适配器提供的安全只读内容。 */ detail: ActivityReadableDetail;
  /** 文件提交内容是否仍在生成。 */ streaming: boolean;
}) {
  const translate = use_translation("chat");
  const text_of = (value: ActivityText) => value.key ? translate(value.key, value.values) : value.text ?? "";
  return <div className="min-w-0 space-y-2">
    {detail.facts.map((fact, index) => <p key={index} className="mb-1 whitespace-pre-wrap break-words text-muted-foreground">{text_of(fact)}</p>)}
    {detail.body ? <ReadableBody body={detail.body} target={detail.target} text_of={text_of} /> : null}
    {streaming ? <span className="activity-tool-input-caret" aria-hidden /> : null}
  </div>;
}

/** 正文分发只识别视图类型，不读取工具名、回执或交互协议。 */
function ReadableBody({ body, target, text_of }: {
  /** 已有界的正文。 */ body: ActivityReadableBody;
  /** 文件正文使用的文件路径，动作正文为空。 */ target: string;
  /** 翻译片段的本地格式化器。 */ text_of: (value: ActivityText) => string;
}) {
  if (body.type === "text") return <FileText text={bounded_text(body.text)} target={target} />;
  if (body.type === "questions") return <dl>{body.questions.slice(0, activity_item_limit).map((item, index) => <div key={index} className="mb-2 last:mb-0">
    <dt className="whitespace-pre-wrap break-words font-medium">{item.question}</dt>
    <dd className="whitespace-pre-wrap break-words text-muted-foreground">{text_of(item.answer)}</dd>
  </div>)}</dl>;

}

/** 文件格式复用项目语言识别和安全 Markdown；未知文本保持原样，围栏不会解释正文中的 Markdown。 */
function FileText({ text, target }: {
  /** 有界的实际返回或提交内容。 */ text: string;
  /** 文件路径；为空表示普通动作描述。 */ target: string;
}) {
  const language = activity_file_language(target);
  if (!target) return <p className="whitespace-pre-wrap break-words">{text}</p>;
  if (!language) return <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>;
  const markdown = language === "markdown" || language === "mdx";
  const longest_fence = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
  const fence = "`".repeat(longest_fence + 1);
  const rendered = markdown ? text : `${fence}${language}\n${text}\n${fence}`;
  return <MarkdownView layout="embedded" text={rendered} mode="static" />;
}
