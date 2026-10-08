/**
 * 组件实时预览模块。
 *
 * MDX 里只写一行 `<ComponentPreview name="button-basic" />`，右侧渲染真实组件，
 * 可切换到源码。关键约束是「展示的代码就是运行的代码」：示例文件
 * `previews/<name>.tsx` 既是渲染源，也是源码展示源，不存在第二份需要同步的副本。
 *
 * 为什么用 `import.meta.glob` 而不是 `import(name)` 拼字符串：glob 由打包器在构建期
 * 静态分析，依赖图、按需分包与类型都成立；运行时拼路径会退化成动态导入并让打包器
 * 无法追踪引用。
 */
import { Suspense, lazy, useMemo, useState, type ComponentType } from "react";
import { IconCode, IconEye } from "@tabler/icons-react";
import { CodeBlock } from "@downcity/ui";
import { cn } from "@/lib/utils";

/**
 * 示例组件模块表。
 *
 * 键形如 `./previews/button-basic.tsx`，值为按需加载的模块。示例默认导出一个无 props
 * 的组件，因此这里只需懒加载命名空间即可。
 */
const preview_modules = import.meta.glob("./previews/*.tsx");

/** 示例源码表，键与 `preview_modules` 一致，值为原始 TSX 文本。 */
const preview_sources = import.meta.glob("./previews/*.tsx", {
  query: "?raw",
  import: "default",
});

/** 由示例名解析示例文件路径。 */
function preview_path(name: string): string {
  return `./previews/${name}.tsx`;
}

/** 预览容器缺失示例时的提示文案。 */
const missing_preview_message = (name: string) =>
  `Preview "${name}" not found. Add app/components/docs/previews/${name}.tsx.`;

/**
 * 组件预览。
 *
 * 预览与源码两档切换，默认停在预览档——读者先看效果再决定是否看实现。
 */
export function ComponentPreview({
  name,
  className,
}: {
  /** 示例名，对应 `app/components/docs/previews/<name>.tsx`。 */
  name: string;
  /** 外层附加类名。 */
  className?: string;
}) {
  const [tab, set_tab] = useState<"preview" | "code">("preview");
  const path = preview_path(name);

  // 示例组件在首次渲染时才加载，切到源码档不需要等组件模块。
  const PreviewComponent = useMemo(() => {
    if (!(path in preview_modules)) return null;

    return lazy(async () => {
      const module = (await preview_modules[path]()) as {
        default: ComponentType;
      };

      return { default: module.default };
    });
  }, [path]);

  // 源码同样按需加载：只有打开源码档才需要这段文本。
  const source_loader = preview_sources[path];
  const [source, set_source] = useState<string | null>(null);

  const open_code_tab = () => {
    set_tab("code");
    if (source !== null || !source_loader) return;

    void (source_loader() as Promise<string>).then(set_source);
  };

  const tab_button_class = (is_active: boolean) =>
    cn(
      "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[0.75rem] font-medium transition-colors",
      is_active
        ? "bg-surface text-foreground shadow-xs"
        : "text-text-soft hover:text-foreground",
    );

  return (
    <div className={cn("my-6 overflow-hidden rounded-xl border border-line bg-surface", className)}>
      <div className="flex items-center gap-1 border-b border-line bg-surface-soft px-2 py-1.5">
        <button
          type="button"
          onClick={() => set_tab("preview")}
          aria-pressed={tab === "preview"}
          className={tab_button_class(tab === "preview")}
        >
          <IconEye className="size-3.5" strokeWidth={1.8} />
          Preview
        </button>
        <button
          type="button"
          onClick={open_code_tab}
          aria-pressed={tab === "code"}
          className={tab_button_class(tab === "code")}
        >
          <IconCode className="size-3.5" strokeWidth={1.8} />
          Code
        </button>
      </div>

      {tab === "preview" ? (
        <div className="flex min-h-40 items-center justify-center bg-background px-6 py-10">
          {PreviewComponent ? (
            <Suspense
              fallback={<div className="text-[0.75rem] text-text-subtle">Loading preview…</div>}
            >
              <PreviewComponent />
            </Suspense>
          ) : (
            <p className="text-[0.75rem] text-danger">{missing_preview_message(name)}</p>
          )}
        </div>
      ) : (
        <div className="[&_figure]:my-0 [&_figure]:rounded-none [&_figure]:border-0">
          <CodeBlock code={source ?? ""} language="tsx" label={`${name}.tsx`} />
        </div>
      )}
    </div>
  );
}
