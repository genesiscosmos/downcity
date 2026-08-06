/**
 * Workboard 游戏化浮动 inspector。
 *
 * 关键点（中文）
 * - 这里把原本散落在主组件里的 ledger、roster、activity line 全部收拢。
 * - 视觉语义从 dashboard inspector 改成游戏里的 codex / quest log。
 * - 组件只消费公开状态，不暴露 agent 内部 session、task、service 等细节。
 */

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import {
  AnimatedPxlKitIcon,
  PxlKitIcon,
  isAnimatedIcon,
  type AnyIcon,
} from "@pxlkit/core";
import { RadarPing } from "@pxlkit/effects";
import { Clock as PixelClock, Sparkles as PixelSparkles, WarningTriangle } from "@pxlkit/feedback";
import { Crown } from "@pxlkit/gamification";
import { cn } from "../lib/utils";
import { WorkboardPixelAgent } from "./workboard-pixel-agent";
import { formatWorkboardRelativeTime } from "./workboard-stage";
import type {
  DowncityWorkboardActivityItem,
  DowncityWorkboardAgentItem,
  DowncityWorkboardSignalItem,
} from "../types/workboard";
import type { DowncityWorkboardGameInspectorProps } from "../types/workboard-game-ui";

const PIXEL_PANEL_CLIP = "polygon(0 6px,6px 6px,6px 0,calc(100% - 6px) 0,calc(100% - 6px) 6px,100% 6px,100% calc(100% - 6px),calc(100% - 6px) calc(100% - 6px),calc(100% - 0px) 100%,6px 100%,6px calc(100% - 6px),0 calc(100% - 6px))";

function activityIcon(kind: string): AnyIcon {
  if (kind === "focus") return Crown;
  if (kind === "progress") return RadarPing;
  return PixelClock;
}

function ActivityLine(props: { item: DowncityWorkboardActivityItem }) {
  const icon = activityIcon(props.item.kind);

  return (
    <li className="flex items-start gap-2 border-b border-border/50 py-2 last:border-b-0">
      <span className="mt-0.5 inline-flex size-5 items-center justify-center border border-border/60 bg-background/82 text-foreground/70">
        {isAnimatedIcon(icon) ? (
          <AnimatedPxlKitIcon icon={icon} size={14} colorful speed={0.8} />
        ) : (
          <PxlKitIcon icon={icon} size={14} colorful />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">{props.item.title}</span>
          <span className="border border-border/50 bg-background/72 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-foreground/54">
            {props.item.status}
          </span>
        </div>
        <div className="mt-1 text-sm leading-6 text-muted-foreground">{props.item.summary}</div>
      </div>
    </li>
  );
}

function CueLine(props: { item: DowncityWorkboardSignalItem }) {
  return (
    <li
      className={cn(
        "flex items-start justify-between gap-3 border-b border-border/50 py-2 text-sm last:border-b-0",
        props.item.tone === "warning" ? "text-amber-800" : "text-foreground",
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-foreground/48">
        {props.item.tone === "warning" ? (
          <PxlKitIcon icon={WarningTriangle} size={12} colorful />
        ) : (
          <PxlKitIcon icon={PixelSparkles} size={12} colorful />
        )}
        {props.item.label}
      </span>
      <span className="border border-border/50 bg-background/72 px-1.5 py-0.5 font-medium">
        {props.item.value}
      </span>
    </li>
  );
}

function PixelStat(props: { label: string; value: string }) {
  return (
    <div className="border border-border/60 bg-background/72 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-foreground/42">{props.label}</div>
      <div className="mt-1 text-sm font-medium text-foreground">{props.value}</div>
    </div>
  );
}

function SpriteRoster(props: {
  peers: DowncityWorkboardAgentItem[];
  selectedAgentId: string;
  onSelectAgent?: (agentId: string) => void;
}) {
  const visiblePeers = props.peers.filter((item) => item.id !== props.selectedAgentId).slice(0, 6);
  if (visiblePeers.length === 0) {
    return (
      <div className="border border-dashed border-border/70 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
        当前区域没有其他 sprite。
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      {visiblePeers.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onClick={() => props.onSelectAgent?.(item.id)}
          className="inline-flex items-center justify-between gap-2 border border-border/70 bg-background/90 px-2 py-1.5 text-sm text-foreground transition-colors hover:border-foreground/20"
        >
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-5 min-w-5 items-center justify-center border border-border/60 bg-background/72 px-1 text-[10px] uppercase tracking-[0.12em] text-foreground/54">
              {index + 1}
            </span>
            <WorkboardPixelAgent agentId={item.id} name={item.name} size={18} />
            <span>{item.name}</span>
          </span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/42">{item.momentum}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * 渲染浮动的游戏化状态面板。
 */
export function WorkboardGameInspector(props: DowncityWorkboardGameInspectorProps) {
  return (
    <aside className="absolute bottom-3 right-3 z-30 w-[min(420px,calc(100%-24px))]">
      <div
        className="relative border-2 border-border/70 bg-[rgba(255,252,247,0.94)] shadow-[0_6px_0_rgba(17,17,19,0.12)] backdrop-blur-[1px]"
        style={{ clipPath: PIXEL_PANEL_CLIP }}
      >
        <span className="pointer-events-none absolute left-2 top-2 h-2 w-2 bg-foreground/16" />
        <span className="pointer-events-none absolute right-2 top-2 h-2 w-2 bg-foreground/10" />
        <span className="pointer-events-none absolute bottom-2 left-2 h-2 w-2 bg-foreground/10" />
        <button
          type="button"
          onClick={props.onToggleCollapsed}
          className="flex w-full items-center justify-between px-3 py-2 text-left"
          aria-expanded={!props.collapsed}
        >
          <span className="text-xs uppercase tracking-[0.16em] text-foreground/46">codex log</span>
          <span className="inline-flex items-center gap-1 text-xs text-foreground/56">
            {props.collapsed ? "Open" : "Close"}
            {props.collapsed ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
          </span>
        </button>

        {!props.collapsed ? (
          <div className="border-t-2 border-border/70 px-3 pb-3 pt-2">
            <div className="border border-border/60 bg-background/72 px-2.5 py-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-foreground/42">active zone</p>
                  <h3 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-foreground">
                    {props.activeZone.title}
                  </h3>
                </div>
                <span className="border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-foreground/52">
                  {props.stageLevel === "clusters" ? "world" : "room"}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{props.activeZone.description}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-foreground/42">
                {props.activeZone.subtitle}
              </p>
            </div>

            <div className="mt-3">
              <p className="text-xs uppercase tracking-[0.12em] text-foreground/46">nearby sprites</p>
              <div className="mt-2 max-h-28 overflow-auto pr-1">
                <SpriteRoster
                  peers={props.selectedPeers}
                  selectedAgentId={props.selected?.id || ""}
                  onSelectAgent={props.onSelectAgent}
                />
              </div>
            </div>

            {props.selected ? (
              <div className="mt-3 border-t-2 border-border/70 pt-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <WorkboardPixelAgent agentId={props.selected.id} name={props.selected.name} size={24} active />
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-foreground/46">selected sprite</p>
                      <p className="text-sm font-semibold text-foreground">{props.selected.name}</p>
                    </div>
                  </div>
                  <span className="border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-foreground/52">
                    {formatWorkboardRelativeTime(props.selected.collectedAt)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <PixelStat label="posture" value={props.selected.posture} />
                  <PixelStat label="tempo" value={props.selected.momentum} />
                  <PixelStat label="life" value={props.selected.running ? "live" : "quiet"} />
                </div>

                <div className="mt-3 border border-border/60 bg-background/78 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-foreground/42">speech line</p>
                  <p className="mt-1 text-sm leading-6 text-foreground">
                    “{props.selected.snapshot.current[0]?.summary || props.selected.headline}”
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{props.selected.statusText}</p>
                </div>

                <div className="mt-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-foreground/46">quest beats</p>
                  <ul className="mt-1 border border-border/60 bg-background/74 px-2 py-1">
                    {(props.selected.snapshot.current || []).slice(0, 3).map((item) => (
                      <ActivityLine key={item.id} item={item} />
                    ))}
                  </ul>
                </div>

                <div className="mt-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-foreground/46">recent drops</p>
                  {(props.selected.snapshot.recent || []).length === 0 ? (
                    <p className="mt-1 border border-dashed border-border/60 bg-background/70 px-2 py-2 text-sm text-muted-foreground">
                      暂无近期片段。
                    </p>
                  ) : (
                    <ul className="mt-1 border border-border/60 bg-background/74 px-2 py-1">
                      {(props.selected.snapshot.recent || []).slice(0, 3).map((item) => (
                        <ActivityLine key={item.id} item={item} />
                      ))}
                    </ul>
                  )}
                </div>

                <div className="mt-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-foreground/46">world cues</p>
                  {(props.selected.snapshot.signals || []).length === 0 ? (
                    <p className="mt-1 border border-dashed border-border/60 bg-background/70 px-2 py-2 text-sm text-muted-foreground">
                      当前没有公开线索。
                    </p>
                  ) : (
                    <ul className="mt-1 border border-border/60 bg-background/74 px-2 py-1">
                      {(props.selected.snapshot.signals || []).slice(0, 4).map((item) => (
                        <CueLine key={item.label} item={item} />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-3 border border-dashed border-border/60 bg-background/70 px-3 py-3 text-sm text-muted-foreground">
                选中一个 sprite 后，这里会出现它的公开片段与线索。
              </div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
