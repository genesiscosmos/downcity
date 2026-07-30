/**
 * Downcity Settings 设置布局组件组。
 *
 * 关键说明（中文）
 * - 只表达设置页的稳定信息层级，不维护表单值或保存生命周期。
 * - 宿主通过组合具体控件决定业务语义，UI 包只负责结构和视觉一致性。
 */

import { cn } from "../lib/utils";
import type {
  DowncityInfoRowProps,
  DowncitySettingGroupProps,
  DowncitySettingItemProps,
  DowncitySettingSectionProps,
  DowncitySettingsContainerProps,
} from "../types/components";

function SettingsContainer({
  children,
  className,
}: DowncitySettingsContainerProps) {
  return (
    <div
      data-slot="settings-container"
      className={cn("flex flex-col gap-7", className)}
    >
      {children}
    </div>
  );
}

function SettingSection({
  title,
  description,
  action,
  children,
  className,
}: DowncitySettingSectionProps) {
  return (
    <section
      data-slot="setting-section"
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      {title || description || action ? (
        <header className="flex items-start justify-between gap-4 px-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? (
              <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
            ) : null}
            {description ? (
              <p className="text-[11px] leading-5 text-muted-foreground/75">
                {description}
              </p>
            ) : null}
          </div>
          {action ? (
            <div className="flex shrink-0 items-center gap-2">{action}</div>
          ) : null}
        </header>
      ) : null}
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function SettingGroup({ children, className }: DowncitySettingGroupProps) {
  return (
    <div
      data-slot="setting-group"
      className={cn(
        "min-w-0 divide-y divide-divider overflow-hidden rounded-[16px] bg-surface-subtle",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SettingItem({
  label,
  description,
  children,
  className,
}: DowncitySettingItemProps) {
  return (
    <div
      data-slot="setting-item"
      className={cn(
        "flex min-h-14 flex-col items-stretch justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-sm text-foreground">{label}</div>
        {description ? (
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end sm:max-w-[55%]">{children}</div>
    </div>
  );
}

function InfoRow({ label, children, className }: DowncityInfoRowProps) {
  return (
    <div
      data-slot="info-row"
      className={cn(
        "flex min-h-11 items-center justify-between gap-4 px-4 py-2.5",
        className,
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {children}
      </span>
    </div>
  );
}

export { InfoRow, SettingGroup, SettingItem, SettingSection, SettingsContainer };
