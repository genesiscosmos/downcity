/**
 * Fumadocs 共享布局配置模块。
 * 说明：
 * 1. 文档页侧边栏顶部品牌位仅保留 Logo，避免与站点极简 Header 语言冲突。
 * 2. 这里仅维护文档导航所需的共享配置，不承载额外品牌文案。
 */
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className="flex h-10 w-10 items-center justify-center">
          <img
            src="/icon-512.png"
            width={32}
            height={32}
            alt="Downcity"
            className="brand-logo h-8 w-8 object-contain"
          />
        </div>
      ),
    },
    links: [],
  };
}
