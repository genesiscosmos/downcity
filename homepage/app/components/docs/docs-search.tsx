/**
 * 文档搜索对话框。
 *
 * 检索完全在浏览器内完成：打开时按当前语言拉取静态索引，之后按标题、小标题与正文
 * 分段打分排序。为什么不做服务端检索：站点是静态直传部署，构建期生成索引既省掉
 * 一个运行时依赖，也没有网络往返带来的输入延迟。
 *
 * 打分规则（从高到低）：标题完全匹配 > 标题前缀匹配 > 标题包含 > 小标题包含 >
 * 正文包含。命中位置越靠前权重越高，保证输入「session」时页面标题指向 session 的
 * 文档排在只顺带提到 session 的文档前面。
 */
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@downcity/ui";
import { IconSearch } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { docs_spaces } from "@/lib/docs/spaces";
import type { DocsLocale, DocsSearchIndex, DocsSearchRecord } from "@/lib/docs/types";

/** 单次查询最多展示的结果数。 */
const result_limit = 20;

/**
 * 为单条记录打分。
 *
 * 返回 0 表示不匹配。分数只用于排序，不对外暴露，因此采用整数档位而不是连续加权，
 * 便于在代码里直接看出各档优先关系。
 */
function score_record(record: DocsSearchRecord, query: string): number {
  const needle = query.toLowerCase();
  const title = record.title.toLowerCase();

  if (title === needle) return 100;
  if (title.startsWith(needle)) return 80;
  if (title.includes(needle)) return 60;

  if (record.headings.some((heading) => heading.toLowerCase().includes(needle))) return 40;
  if (record.snippet.toLowerCase().includes(needle)) return 20;

  return 0;
}

/** 载入指定语言的静态索引。 */
async function load_index(locale: DocsLocale): Promise<DocsSearchIndex | null> {
  try {
    const response = await fetch(`/search-index.${locale}.json`);
    if (!response.ok) return null;

    return (await response.json()) as DocsSearchIndex;
  } catch {
    return null;
  }
}

/** 取文档空间的显示名。 */
function space_label(space_id: string, locale: DocsLocale): string {
  const space = docs_spaces.find((item) => item.id === space_id);

  return space ? space.label[locale] : space_id;
}

/**
 * 文档搜索。
 *
 * 索引在首次打开对话框时按需加载并按语言缓存，避免给每个页面都挂上几百 KB 的首屏
 * 负担；语言变化时重新拉取对应索引。
 */
export function DocsSearch({
  locale,
  trigger_label,
  placeholder,
  empty_label,
  recent_hint,
}: {
  /** 当前界面语言，决定加载哪一份索引与结果里的空间名。 */
  locale: DocsLocale;
  /** 触发按钮的文字。 */
  trigger_label: string;
  /** 输入框占位文字。 */
  placeholder: string;
  /** 无结果时的提示文字。 */
  empty_label: string;
  /** 结果分组标题。 */
  recent_hint: string;
}) {
  const [open, set_open] = useState(false);
  const [query, set_query] = useState("");
  const [index, set_index] = useState<DocsSearchIndex | null>(null);
  const navigate = useNavigate();

  // 打开时按需加载索引；语言变化后重新加载。
  useEffect(() => {
    let cancelled = false;

    if (!open) return undefined;
    if (index?.locale === locale) return undefined;

    void load_index(locale).then((loaded) => {
      if (!cancelled && loaded) set_index(loaded);
    });

    return () => {
      cancelled = true;
    };
  }, [open, locale, index?.locale]);

  // 支持 Cmd/Ctrl + K 唤起，与常见文档站保持一致。
  useEffect(() => {
    const handle_keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        set_open((previous) => !previous);
      }
    };

    window.addEventListener("keydown", handle_keydown);

    return () => window.removeEventListener("keydown", handle_keydown);
  }, []);

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed || !index) return [];

    return index.records
      .map((record) => ({ record, score: score_record(record, trimmed) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;

        return left.record.title.localeCompare(right.record.title);
      })
      .slice(0, result_limit)
      .map((entry) => entry.record);
  }, [query, index]);

  const select = (record: DocsSearchRecord) => {
    set_open(false);
    set_query("");
    navigate(record.url);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => set_open(true)}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[0.8125rem] text-text-soft transition-colors hover:border-line-strong hover:text-foreground"
      >
        <IconSearch className="size-3.5" strokeWidth={1.8} />
        <span className="hidden sm:inline">{trigger_label}</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-100 flex items-start justify-center bg-background/60 px-4 pt-[12vh] backdrop-blur-sm"
          role="presentation"
          onClick={() => set_open(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={trigger_label}
            className="w-full max-w-xl overflow-hidden rounded-[14px] border border-line bg-surface shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <Command shouldFilter={false} className="rounded-none bg-transparent">
              <CommandInput
                value={query}
                onValueChange={set_query}
                placeholder={placeholder}
                autoFocus
              />
              <CommandList>
                <CommandEmpty>{empty_label}</CommandEmpty>
                {results.length > 0 ? (
                  <CommandGroup heading={recent_hint}>
                    {results.map((record) => (
                      <CommandItem
                        key={record.url}
                        value={record.url}
                        onSelect={() => select(record)}
                        className="flex-col items-start gap-1"
                      >
                        <span className="flex w-full items-center justify-between gap-3">
                          <span className="truncate font-medium text-foreground">
                            {record.title}
                          </span>
                          <span className="shrink-0 text-[0.7rem] uppercase tracking-[0.1em] text-text-subtle">
                            {space_label(record.space, locale)}
                          </span>
                        </span>
                        {record.description || record.snippet ? (
                          <span className="line-clamp-1 text-[0.75rem] text-text-soft">
                            {record.description || record.snippet}
                          </span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
          </div>
        </div>
      ) : null}
    </>
  );
}
