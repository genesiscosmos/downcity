/**
 * 主题切换控件。
 *
 * 三档选择（浅色 / 深色 / 跟随系统）统一收敛到一个下拉菜单，与站点导航栏的主题
 * 切换保持同一套状态与视觉。图标反映当前实际生效的外观，而不是用户选中的模式，
 * 这样「跟随系统」时也能一眼看出当下是深是浅。
 */
import { IconCheck, IconMoon, IconSun, IconSunMoon } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { use_site_theme, type SiteThemeMode } from "@/components/docs/theme-provider";

/** 主题菜单项定义，顺序即展示顺序。 */
const theme_options: ReadonlyArray<{ value: SiteThemeMode; label: string; icon: typeof IconSun }> =
  [
    { value: "light", label: "Light", icon: IconSun },
    { value: "dark", label: "Dark", icon: IconMoon },
    { value: "system", label: "System", icon: IconSunMoon },
  ];

/** 主题切换器。 */
export function ThemeSwitcher({ label }: { label: string }) {
  const { mode, resolved_theme, set_mode } = use_site_theme();
  const CurrentIcon = resolved_theme === "dark" ? IconMoon : IconSun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        className="inline-flex size-8 items-center justify-center rounded-md text-text-soft transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
      >
        <CurrentIcon className="size-4" strokeWidth={1.7} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[8rem]">
        {theme_options.map((option) => {
          const Icon = option.icon;

          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => set_mode(option.value)}
              className="flex items-center justify-between gap-3 text-[0.8125rem]"
            >
              <span className="flex items-center gap-2">
                <Icon className="size-4 text-text-soft" strokeWidth={1.7} />
                <span>{option.label}</span>
              </span>
              <IconCheck
                className={cn("size-4", mode === option.value ? "opacity-100" : "opacity-0")}
                strokeWidth={2}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
