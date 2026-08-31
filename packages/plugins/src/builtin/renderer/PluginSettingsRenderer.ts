/** 官方简单设置 Plugin 的自包含 Mainview HTML 生成器。 */

import type { PluginSettingsDefinition } from "@/builtin/types/PluginSettings.js";

/** 根据具体 Plugin 的字段声明生成独立 Mainview。 */
export function create_plugin_settings_renderer(
  definition: PluginSettingsDefinition,
): string {
  const serialized_definition = JSON.stringify(definition).replace(/</gu, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #222; background: transparent; }
    main { width: min(680px, calc(100% - 40px)); margin: 52px auto; }
    h1 { margin: 0; font-size: 20px; font-weight: 650; }
    .description { margin: 8px 0 28px; color: #777; font-size: 13px; line-height: 1.6; }
    .fields { display: grid; gap: 18px; }
    label { display: grid; gap: 6px; }
    .label { font-size: 13px; font-weight: 600; }
    .help { color: #777; font-size: 12px; line-height: 1.5; }
    input, select { width: 100%; min-height: 38px; border: 1px solid rgba(127,127,127,.28); border-radius: 9px; padding: 8px 11px; color: inherit; background: rgba(127,127,127,.06); font: inherit; font-size: 13px; outline: none; }
    input:focus, select:focus { border-color: #6d5ce7; box-shadow: 0 0 0 3px rgba(109,92,231,.12); }
    input[type=checkbox] { width: 18px; min-height: 18px; padding: 0; }
    .boolean { grid-template-columns: 18px 1fr; align-items: start; column-gap: 10px; }
    .actions { display: flex; align-items: center; gap: 12px; margin-top: 28px; }
    button { min-height: 36px; border: 0; border-radius: 9px; padding: 0 16px; color: white; background: #6d5ce7; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    #status { color: #777; font-size: 12px; }
    #status.error { color: #c43d4b; }
    @media (prefers-color-scheme: dark) { body { color: #eee; } }
  </style>
</head>
<body>
  <main>
    <h1 id="title"></h1>
    <p id="description" class="description"></p>
    <form id="form"><div id="fields" class="fields"></div><div class="actions"><button id="save" type="submit">保存</button><span id="status"></span></div></form>
  </main>
  <script>
    const definition = ${serialized_definition};
    const pending = new Map();
    let sequence = 0;
    function invoke(action_id, input) {
      const request_id = Date.now().toString(36) + '_' + (++sequence).toString(36);
      parent.postMessage({ source: 'downcity_plugin', type: 'invoke', request_id, action_id, ...(input === undefined ? {} : { input }) }, '*');
      return new Promise((resolve, reject) => pending.set(request_id, { resolve, reject }));
    }
    addEventListener('message', (event) => {
      const message = event.data;
      if (event.source !== parent || !message || message.source !== 'downcity_host' || message.type !== 'invoke_result') return;
      const request = pending.get(message.request_id);
      if (!request) return;
      pending.delete(message.request_id);
      message.success ? request.resolve(message.result) : request.reject(new Error(message.error || 'Plugin action failed'));
    });
    const fields = document.querySelector('#fields');
    const status = document.querySelector('#status');
    const save = document.querySelector('#save');
    document.querySelector('#title').textContent = definition.title;
    document.querySelector('#description').textContent = definition.description;
    for (const field of definition.fields) {
      const label = document.createElement('label');
      if (field.type === 'boolean') label.className = 'boolean';
      const input = field.type === 'select' ? document.createElement('select') : document.createElement('input');
      input.id = field.key;
      input.dataset.type = field.type;
      if (field.type === 'number') { input.type = 'number'; if (field.minimum !== undefined) input.min = field.minimum; if (field.maximum !== undefined) input.max = field.maximum; }
      if (field.type === 'boolean') input.type = 'checkbox';
      if (field.type === 'select') for (const option of field.options || []) input.add(new Option(option.label, option.value));
      const content = document.createElement('span');
      content.innerHTML = '<span class="label"></span>' + (field.description ? '<span class="help"></span>' : '');
      content.querySelector('.label').textContent = field.label;
      if (field.description) content.querySelector('.help').textContent = field.description;
      label.append(input, content);
      fields.append(label);
    }
    async function load() {
      try {
        const config = await invoke('profile.read');
        for (const field of definition.fields) {
          const input = document.querySelector('#' + field.key);
          const value = config[field.key];
          if (field.type === 'boolean') input.checked = value === true;
          else input.value = value === undefined ? '' : String(value);
        }
      } catch (error) { show(error.message, true); }
    }
    function show(message, error = false) { status.textContent = message; status.className = error ? 'error' : ''; }
    document.querySelector('#form').addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true; show('保存中…');
      const config = {};
      for (const field of definition.fields) {
        const input = document.querySelector('#' + field.key);
        if (field.type === 'boolean') config[field.key] = input.checked;
        else if (field.type === 'number') { if (input.value !== '') config[field.key] = Number(input.value); }
        else if (input.value.trim()) config[field.key] = input.value.trim();
      }
      try { await invoke('profile.save', config); show('已保存'); } catch (error) { show(error.message, true); } finally { save.disabled = false; }
    });
    load();
  </script>
</body>
</html>`;
}
