/** Chat Plugin 自己拥有的自包含 Profile Mainview。 */

/** Chat Plugin Mainview HTML。 */
export const CHAT_PLUGIN_RENDERER_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #222; background: transparent; }
    main { width: min(760px, calc(100% - 40px)); margin: 44px auto 72px; }
    h1 { margin: 0; font-size: 20px; font-weight: 650; }
    h2 { margin: 30px 0 12px; font-size: 13px; font-weight: 650; }
    .description { margin: 8px 0 0; color: #777; font-size: 13px; line-height: 1.6; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .channel { margin-bottom: 12px; border: 1px solid rgba(127,127,127,.2); border-radius: 13px; padding: 15px; background: rgba(127,127,127,.035); }
    .channel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 13px; }
    .channel-head select { width: 150px; }
    .channel-head button { margin-left: auto; color: #c43d4b; background: rgba(196,61,75,.1); }
    .channel-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
    label { display: grid; gap: 6px; min-width: 0; }
    .wide { grid-column: 1 / -1; }
    .label { font-size: 12px; font-weight: 600; }
    .help { color: #777; font-size: 11px; line-height: 1.45; }
    input, select { width: 100%; min-height: 38px; border: 1px solid rgba(127,127,127,.28); border-radius: 9px; padding: 8px 11px; color: inherit; background: rgba(127,127,127,.06); font: inherit; font-size: 13px; outline: none; }
    input:focus, select:focus { border-color: #6d5ce7; box-shadow: 0 0 0 3px rgba(109,92,231,.12); }
    .check { display: flex; align-items: center; gap: 8px; min-height: 38px; }
    .check input { width: 17px; min-height: 17px; }
    button { min-height: 34px; border: 0; border-radius: 9px; padding: 0 13px; color: inherit; background: rgba(127,127,127,.12); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    button.primary { color: white; background: #6d5ce7; }
    button:disabled { opacity: .5; cursor: default; }
    .actions { display: flex; align-items: center; gap: 12px; margin-top: 24px; }
    #status { color: #777; font-size: 12px; }
    #status.error { color: #c43d4b; }
    .empty { border: 1px dashed rgba(127,127,127,.28); border-radius: 12px; padding: 22px; color: #777; text-align: center; font-size: 12px; }
    @media (max-width: 680px) { .grid, .channel-fields { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
    @media (prefers-color-scheme: dark) { body { color: #eee; } }
  </style>
</head>
<body>
  <main>
    <h1>Chat</h1>
    <p class="description">配置这个 Profile 使用的消息渠道和入站队列。已有凭据不会返回到 Mainview；凭据输入留空会保持原值。</p>

    <h2>Queue</h2>
    <div class="grid">
      <label><span class="label">Maximum concurrency</span><input id="max_concurrency" type="number" min="1" max="32" placeholder="4"></label>
      <label><span class="label">Merge debounce (ms)</span><input id="merge_debounce_ms" type="number" min="0" max="60000"></label>
      <label><span class="label">Maximum merge wait (ms)</span><input id="merge_max_wait_ms" type="number" min="0" max="120000"></label>
    </div>

    <h2>Channels</h2>
    <div id="channels"></div>
    <button id="add_channel" type="button">添加 Channel</button>

    <div class="actions"><button id="save" class="primary" type="button">保存</button><span id="status"></span></div>
  </main>
  <script>
    const pending = new Map();
    let sequence = 0;
    let profile = { queue: {}, channels: [] };
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
    const channels = document.querySelector('#channels');
    const status = document.querySelector('#status');
    const save = document.querySelector('#save');
    function show(message, error = false) { status.textContent = message; status.className = error ? 'error' : ''; }
    function field(label, key, value = '', type = 'text', placeholder = '') {
      const element = document.createElement('label');
      element.innerHTML = '<span class="label"></span><input>';
      element.querySelector('.label').textContent = label;
      const input = element.querySelector('input');
      input.dataset.key = key; input.type = type; input.value = value ?? ''; input.placeholder = placeholder;
      return element;
    }
    function render_channels() {
      channels.replaceChildren();
      if (!profile.channels.length) {
        const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '这个 Profile 还没有消息渠道。'; channels.append(empty); return;
      }
      profile.channels.forEach((channel, index) => {
        const card = document.createElement('section'); card.className = 'channel'; card.dataset.index = String(index);
        const head = document.createElement('div'); head.className = 'channel-head';
        const type = document.createElement('select'); type.innerHTML = '<option value="telegram">Telegram</option><option value="feishu">Feishu / Lark</option><option value="qq">QQ</option>'; type.value = channel.type;
        type.addEventListener('change', () => { profile.channels[index] = { id: channel.id || '', name: channel.name || '', type: type.value, secret_configured: false }; render_channels(); });
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.addEventListener('click', () => { profile.channels.splice(index, 1); render_channels(); });
        head.append(type, remove);
        const fields = document.createElement('div'); fields.className = 'channel-fields';
        fields.append(field('Channel ID', 'id', channel.id), field('Name', 'name', channel.name));
        if (channel.type === 'telegram') {
          fields.append(field('Bot Token', 'bot_token', '', 'password', channel.secret_configured ? '已配置；留空保持' : ''));
        } else {
          fields.append(field('App ID', 'app_id', channel.app_id || ''), field('App Secret', 'app_secret', '', 'password', channel.secret_configured ? '已配置；留空保持' : ''));
          if (channel.type === 'feishu') fields.append(field('API Domain', 'domain', channel.domain || '', 'text', 'https://open.feishu.cn'));
          if (channel.type === 'qq') {
            const check = document.createElement('label'); check.className = 'check'; check.innerHTML = '<input type="checkbox" data-key="sandbox"><span class="label">Sandbox</span>'; check.querySelector('input').checked = channel.sandbox === true; fields.append(check);
          }
        }
        card.append(head, fields); channels.append(card);
      });
    }
    function read_number(id) { const value = document.querySelector('#' + id).value; return value === '' ? undefined : Number(value); }
    function collect() {
      return {
        queue: {
          ...(read_number('max_concurrency') === undefined ? {} : { max_concurrency: read_number('max_concurrency') }),
          ...(read_number('merge_debounce_ms') === undefined ? {} : { merge_debounce_ms: read_number('merge_debounce_ms') }),
          ...(read_number('merge_max_wait_ms') === undefined ? {} : { merge_max_wait_ms: read_number('merge_max_wait_ms') }),
        },
        channels: [...channels.querySelectorAll('.channel')].map((card) => {
          const current = profile.channels[Number(card.dataset.index)];
          const result = { type: current.type, secret_configured: current.secret_configured };
          for (const input of card.querySelectorAll('[data-key]')) {
            if (input.type === 'checkbox') result[input.dataset.key] = input.checked;
            else if (input.value.trim()) result[input.dataset.key] = input.value.trim();
          }
          return result;
        }),
      };
    }
    document.querySelector('#add_channel').addEventListener('click', () => { profile.channels.push({ id: '', name: '', type: 'telegram', secret_configured: false }); render_channels(); });
    save.addEventListener('click', async () => {
      save.disabled = true; show('保存中…');
      try { profile = await invoke('profile.save', collect()); render(); show('已保存'); } catch (error) { show(error.message, true); } finally { save.disabled = false; }
    });
    function render() {
      for (const key of ['max_concurrency', 'merge_debounce_ms', 'merge_max_wait_ms']) document.querySelector('#' + key).value = profile.queue?.[key] ?? '';
      render_channels();
    }
    invoke('profile.read').then((value) => { profile = value; render(); }, (error) => show(error.message, true));
  </script>
</body>
</html>`;
