/**
 * Web 的通用视图。
 *
 * 承载跨能力的配置与配置文件的归属：操作超时与观察字符上限由三个能力共用，
 * 配置文件则保存全部能力的配置。这里不再出现 Provider 选择——那属于各个能力。
 */

import { useCallback, useEffect, useState } from "react";
import type { PowerActionGateway, PowerRendererUi } from "@downcity/city/power/react";
import type { WebConfigPatch, WebConfigTestResult } from "@/web/types/WebPowerConfig.js";
import type { WebMainviewSnapshot } from "@/web/types/WebMainview.js";
import { to_config_patch_json, to_error_message } from "@/web/renderer/WebPowerShared.js";

/** 通用视图的本地编辑状态。 */
interface GeneralDraft {
  /** 网络与浏览器操作超时。 */
  timeout_ms: number;
  /** 页面观察字符上限。 */
  max_observation_chars: number;
}

/** 通用视图属性。 */
export interface WebGeneralViewProps {
  /** 已绑定当前 Power 的业务 action 网关。 */
  readonly power: PowerActionGateway;
  /** 宿主提供的反馈能力和 UI 组件。 */
  readonly ui: PowerRendererUi;
}

/** 渲染跨能力的通用配置。 */
export function WebGeneralView({ power, ui }: WebGeneralViewProps) {
  const {
    Button, Callout, Group, Inline, Input, LoadingState, Page, Row, Section, Toolbar,
  } = ui.components;
  const [snapshot, set_snapshot] = useState<WebMainviewSnapshot>();
  const [draft, set_draft] = useState<GeneralDraft>();
  const [loading, set_loading] = useState(true);
  const [saving, set_saving] = useState(false);
  const [error, set_error] = useState("");

  const load = useCallback(async () => {
    set_loading(true);
    set_error("");
    try {
      const next = await power.invoke<WebMainviewSnapshot>("web.snapshot");
      set_snapshot(next);
      set_draft({
        timeout_ms: next.config.timeout_ms,
        max_observation_chars: next.config.max_observation_chars,
      });
    } catch (reason) {
      set_error(to_error_message(reason));
    } finally {
      set_loading(false);
    }
  }, [power]);
  useEffect(() => { void load(); }, [load, ui.revision]);

  const update = <TKey extends keyof GeneralDraft>(key: TKey, value: GeneralDraft[TKey]) =>
    set_draft((current) => current ? { ...current, [key]: value } : current);

  const save = async () => {
    if (!draft) return;
    set_saving(true);
    set_error("");
    try {
      const patch: WebConfigPatch = {
        timeout_ms: draft.timeout_ms,
        max_observation_chars: draft.max_observation_chars,
      };
      await power.invoke("web.config.save", to_config_patch_json(patch));
      ui.toast({ type: "success", message: "Web 配置已保存" });
      ui.invalidate();
    } catch (reason) {
      const message = to_error_message(reason);
      set_error(message);
      ui.toast({ type: "error", message });
    } finally {
      set_saving(false);
    }
  };

  const reveal_config_file = async () => {
    try {
      const result = await power.invoke<WebConfigTestResult>("web.config.reveal_file");
      ui.toast({ type: result.success ? "success" : "error", message: result.message });
    } catch (reason) {
      ui.toast({ type: "error", message: to_error_message(reason) });
    }
  };

  if (loading && !snapshot) return <LoadingState label="正在读取 Web 配置…" />;
  if (!snapshot || !draft) return <Page><Callout tone="danger">{error || "无法读取 Web 配置"}</Callout></Page>;

  return <Page>
    {error ? <Callout tone="danger">{error}</Callout> : null}
    <Toolbar
      title="通用"
      description="三个能力共用的参数，以及保存全部配置的文件。"
      actions={<Button variant="primary" disabled={saving} on_click={() => void save()}>{saving ? "保存中…" : "保存"}</Button>}
    />
    {snapshot.warnings.length ? <Callout tone="warning">{snapshot.warnings.join("；")}</Callout> : null}

    <Section title="参数">
      <Group>
        <Row
          label="操作超时（ms）"
          description="搜索、网页读取与浏览器动作共用的上限。"
          trailing={<Input
            type="number"
            value={String(draft.timeout_ms)}
            minimum={1000}
            maximum={60000}
            on_value_change={(value) => update("timeout_ms", Number(value) || 30_000)}
          />}
        />
        <Row
          label="观察字符上限"
          description="返回内容的最大字符数。"
          trailing={<Input
            type="number"
            value={String(draft.max_observation_chars)}
            minimum={1}
            maximum={100000}
            on_value_change={(value) => update("max_observation_chars", Number(value) || 12_000)}
          />}
        />
      </Group>
    </Section>

    <Section title="配置文件">
      <Group>
        <Row
          label={snapshot.config_path || "当前配置没有对应的文件。"}
          trailing={snapshot.config_path
            ? <Button on_click={() => void reveal_config_file()}>打开所在目录</Button>
            : undefined}
        />
      </Group>
    </Section>
  </Page>;
}
