/**
 * 为 remark-math 的单美元行内公式增加边界约束，避免美元金额跨正文配成公式。
 * 在 micromark 完成候选公式时检查边界；失败后由 Markdown 解析器回退为普通文本，
 * 因而加粗、链接、转义与代码仍由各自的语法处理，不需要改写消息源码。
 */
import type { combineExtensions } from "micromark-util-combine-extensions";

/** 复用现有 micromark 依赖的语法扩展类型。 */
type SyntaxExtension = ReturnType<typeof combineExtensions>;
/** 字符对应的单个解析规则，排除规则数组和缺省值。 */
type SyntaxConstruct = Exclude<NonNullable<NonNullable<SyntaxExtension["text"]>[string]>, unknown[]>;

/** remark-parse 提供的扩展注册入口。 */
interface MarkdownParserData {
  /** unified 共享设置；保持与 Processor data 返回值的结构一致。 */
  settings?: unknown;
  /** 当前 Processor 已注册的 micromark 语法扩展。 */
  micromarkExtensions?: SyntaxExtension[];
}

/**
 * 单美元边界采用常见的数学分隔规则：内侧不紧邻空白，闭合符后不紧邻数字。
 * 数字开头的金额候选也不能跨越 Markdown 加粗或代码边界，避免价格吞入后续公式。
 * 例如 `$5 and $10`、`**$5**，$x$` 中的金额保持原文；
 * `$2 + 2$` 与双美元公式仍交由原解析规则处理。
 */
function guard_math_construct(construct: SyntaxConstruct): SyntaxConstruct {
  if (construct.name !== "mathText") return construct;
  const tokenize_math = construct.tokenize;

  return {
    ...construct,
    tokenize(effects, ok, nok) {
      const context = this;
      return tokenize_math.call(context, effects, (code) => {
        // 原解析器成功时，最后一个事件是整个 mathText 节点的退出事件。
        const math_token = context.events.at(-1)?.[1];
        if (math_token) {
          const source = context.sliceSerialize(math_token);
          if (!source.startsWith("$$") && (
            /\s/u.test(source.charAt(1)) || /\s/u.test(source.charAt(source.length - 2)) ||
            (code !== null && code >= 48 && code <= 57) ||
            (/^\$[+-]?(?:\d|\.\d)/u.test(source) && /\*\*|__|`/u.test(source))
          )) return nok(code);
        }
        return ok(code);
      }, nok);
    },
  };
}

/** 在 remark-math 注册后调用；仅替换当前 Processor 的行内美元解析规则。 */
export function remark_math_currency(this: { data(): MarkdownParserData }): undefined {
  for (const extension of this.data().micromarkExtensions ?? []) {
    const text_constructs = extension.text;
    const dollar_constructs = text_constructs?.[36];
    if (!text_constructs || !dollar_constructs) continue;
    text_constructs[36] = Array.isArray(dollar_constructs)
      ? dollar_constructs.map(guard_math_construct)
      : guard_math_construct(dollar_constructs);
  }
}
