'use strict';
/* global api */
// Renderer: renders tool specs as forms and streams tool output. Talks only to window.api (preload).

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
};

const state = { info: null, tools: [], tool: null, action: null, values: {}, runId: null, filter: '' };

function isEmpty(v) { return v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0); }
function visible(f) {
  if (!f.showIf) return true;
  const cur = state.values[f.showIf.field];
  return 'equals' in f.showIf ? cur === f.showIf.equals : !isEmpty(cur);
}

function accessLabel(t) {
  if (t.tier === 'free') return { text: 'Free', cls: 'free' };
  if (t.access.reason === 'licensed') return { text: 'Unlocked', cls: 'free' };
  if (t.access.reason === 'trial') return { text: `${t.access.left} free runs left`, cls: '' };
  return { text: 'Locked', cls: 'locked' };
}

function renderList() {
  const list = $('tool-list');
  list.replaceChildren();
  const q = state.filter.toLowerCase();
  for (const t of state.tools) {
    if (q && !`${t.name} ${t.tagline} ${(t.keywords || []).join(' ')}`.toLowerCase().includes(q)) continue;
    const a = accessLabel(t);
    list.append(el('button', {
      class: 'tool-item', type: 'button', 'aria-current': state.tool && state.tool.id === t.id ? 'true' : 'false',
      onclick: () => selectTool(t.id),
    }, el('span', {}, t.name), el('span', { class: 'tag' }, a.cls === 'free' && t.tier === 'free' ? 'free' : '')));
  }
}

function renderLicense() {
  const up = state.info && state.info.update;
  $('update-btn').hidden = !up;
  if (up) $('update-btn').textContent = `Update available: v${up.version}`;
  $('legal-btn').hidden = !(state.info && state.info.legalUrl);
  const pro = state.info && state.info.pro;
  $('license-badge').textContent = pro ? 'License active — all tools unlocked' : 'Free version';
  $('license-btn').textContent = pro ? 'Manage license' : 'Enter license key';
  $('deactivate-btn').hidden = !pro;
}

function selectTool(id) {
  state.tool = state.tools.find((t) => t.id === id);
  $('empty').hidden = true;
  $('tool').hidden = false;
  const t = state.tool;
  $('tool-name').textContent = t.name;
  $('tool-tagline').textContent = t.tagline;
  const a = accessLabel(t);
  const pill = $('tool-access');
  pill.textContent = a.text;
  pill.className = `pill ${a.cls}`;
  const up = $('tool-upstream');
  up.textContent = `Powered by ${t.upstream.repo} ${t.binary.version}`;
  up.href = `https://github.com/${t.upstream.repo}`;
  $('tool-credit').textContent = `${t.upstream.displayName || t.upstream.repo} is developed by its own authors under the ${t.upstream.license} license and is not affiliated with this app.`;
  const tabs = $('action-tabs');
  tabs.replaceChildren(...t.actions.map((ac) => el('button', {
    class: 'tab', type: 'button', role: 'tab', 'aria-selected': 'false', 'data-id': ac.id, onclick: () => selectAction(ac.id),
  }, ac.label)));
  renderList();
  selectAction(t.actions[0].id);
}

function selectAction(id) {
  state.action = state.tool.actions.find((a) => a.id === id);
  state.values = {};
  for (const f of state.action.fields || []) if (f.default !== undefined) state.values[f.id] = f.default;
  for (const b of $('action-tabs').children) b.setAttribute('aria-selected', String(b.dataset.id === id));
  $('action-desc').textContent = state.action.description || '';
  $('run-btn').textContent = state.action.runLabel || 'Run';
  renderForm();
}

function pickerField(f) {
  const box = el('div', { class: 'picker-box' });
  const paint = () => {
    const v = state.values[f.id];
    const empty = isEmpty(v);
    box.classList.toggle('empty', empty);
    box.textContent = empty ? (f.placeholder || (f.type === 'folder' ? 'No folder chosen' : 'No file chosen — drop files here')) : (Array.isArray(v) ? v.join('\n') : v);
  };
  const choose = async () => {
    const r = await api.pick({ type: f.type, filters: f.filters, title: f.label });
    if (r == null) return;
    if (f.type === 'files') state.values[f.id] = [...new Set([...(state.values[f.id] || []), ...r])];
    else state.values[f.id] = r;
    paint();
  };
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag'); });
  box.addEventListener('dragleave', () => box.classList.remove('drag'));
  box.addEventListener('drop', (e) => {
    e.preventDefault(); box.classList.remove('drag');
    const paths = [...e.dataTransfer.files].map((file) => api.pathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    state.values[f.id] = f.type === 'files' ? [...new Set([...(state.values[f.id] || []), ...paths])] : paths[0];
    paint();
  });
  paint();
  const clear = el('button', { type: 'button', onclick: () => { delete state.values[f.id]; paint(); } }, 'Clear');
  return el('div', { class: 'picker' }, box, el('button', { type: 'button', onclick: choose }, f.type === 'files' ? 'Add…' : 'Choose…'), clear);
}

function control(f) {
  const id = `f-${f.id}`;
  const set = (v) => { state.values[f.id] = v; if (dependents.has(f.id)) renderForm(); };
  switch (f.type) {
    case 'checkbox':
      return el('label', { class: 'check' }, el('input', { id, type: 'checkbox', checked: state.values[f.id] === true, onchange: (e) => set(e.target.checked) }), f.label);
    case 'select':
      return el('select', { id, onchange: (e) => set(e.target.value) }, ...f.options.map((o) => el('option', { value: o.value, selected: state.values[f.id] === o.value }, o.label)));
    case 'textarea':
      return el('textarea', { id, placeholder: f.placeholder || '', oninput: (e) => set(e.target.value) }, state.values[f.id] || '');
    case 'file': case 'files': case 'folder': case 'savefile':
      return pickerField(f);
    default: {
      const input = el('input', { id, type: f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text', placeholder: f.placeholder || '', autocomplete: 'off', spellcheck: 'false', oninput: (e) => set(e.target.value) });
      input.value = state.values[f.id] ?? '';
      return input;
    }
  }
}

let dependents = new Set();
function renderForm() {
  const form = $('action-form');
  dependents = new Set((state.action.fields || []).filter((f) => f.showIf).map((f) => f.showIf.field));
  form.replaceChildren();
  for (const f of state.action.fields || []) {
    if (!visible(f)) continue;
    const wrap = el('div', { class: 'field', 'data-field': f.id });
    if (f.type !== 'checkbox') wrap.append(el('label', { for: `f-${f.id}` }, f.label + (f.required ? ' *' : '')));
    wrap.append(control(f));
    if (f.help) wrap.append(el('div', { class: 'help' }, f.help));
    wrap.append(el('div', { class: 'err' }));
    form.append(wrap);
  }
}

function showFieldErrors(errs) {
  for (const w of document.querySelectorAll('.field')) { w.classList.remove('invalid'); w.querySelector('.err').textContent = ''; }
  for (const e of errs) {
    const w = document.querySelector(`.field[data-field="${CSS.escape(e.field)}"]`);
    if (w) { w.classList.add('invalid'); w.querySelector('.err').textContent = e.message; }
  }
}

function clientValidate() {
  const errs = [];
  for (const f of state.action.fields || []) {
    if (!visible(f)) continue;
    const v = state.values[f.id];
    if (f.required && isEmpty(v)) errs.push({ field: f.id, message: `${f.label} is required` });
    if (f.minLength && typeof v === 'string' && v && v.length < f.minLength) errs.push({ field: f.id, message: `At least ${f.minLength} characters` });
  }
  return errs;
}

function appendOut(text, cls) {
  const out = $('output');
  const nearBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
  out.append(el('span', { class: cls || '' }, text));
  while (out.childNodes.length > 4000) out.removeChild(out.firstChild);
  if (nearBottom) out.scrollTop = out.scrollHeight;
}

function setRunning(on) {
  $('run-btn').disabled = on;
  $('cancel-btn').hidden = !on;
  for (const b of $('action-tabs').children) b.disabled = on;
}

async function run() {
  const errs = clientValidate();
  showFieldErrors(errs);
  if (errs.length) return;
  if (state.action.confirm && !window.confirm(state.action.confirm)) return;
  const t = state.tool;
  if (!t.access.ok) { openLicense(`You’ve used your 3 free tries of ${t.name}. Pro unlocks it — and every other tool — forever.`); return; }
  state.runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  $('output').replaceChildren();
  setRunning(true);
  try {
    const r = await api.run({ runId: state.runId, toolId: t.id, actionId: state.action.id, values: state.values });
    if (r.trial !== null && r.trial !== undefined) $('run-status').textContent = `Running… (${r.trial} free runs left)`;
  } catch (e) {
    setRunning(false);
    const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    if (msg === 'LOCKED') { openLicense(); return; }
    $('run-status').textContent = '';
    appendOut(`${msg}\n`, 'stderr');
  }
}

function openLicense(reason) {
  $('license-error').textContent = reason || '';
  $('license-key').value = '';
  $('buy-btn').hidden = !(state.info && state.info.checkoutUrl);
  $('license-dialog').showModal();
}

async function refreshTools() {
  state.info = await api.info();
  state.tools = await api.listTools();
  if (state.tool) state.tool = state.tools.find((t) => t.id === state.tool.id) || null;
  renderLicense();
  renderList();
  if (state.tool) {
    const a = accessLabel(state.tool);
    $('tool-access').textContent = a.text;
    $('tool-access').className = `pill ${a.cls}`;
  }
}

async function init() {
  await refreshTools();
  $('product-name').textContent = state.info.productName;
  document.title = state.info.productName;
  $('search').addEventListener('input', (e) => { state.filter = e.target.value; renderList(); });
  $('run-btn').addEventListener('click', run);
  $('cancel-btn').addEventListener('click', () => state.runId && api.cancel(state.runId));
  $('copy-out').addEventListener('click', () => navigator.clipboard.writeText($('output').textContent));
  $('license-btn').addEventListener('click', () => openLicense());
  $('buy-btn').addEventListener('click', () => api.open(state.info.checkoutUrl));
  $('deactivate-btn').addEventListener('click', async () => { await api.deactivate(); await refreshTools(); $('license-dialog').close(); });
  $('activate-btn').addEventListener('click', async () => {
    $('license-error').textContent = '';
    $('activate-btn').disabled = true;
    try {
      await api.activate($('license-key').value);
      await refreshTools();
      $('license-dialog').close();
    } catch (e) {
      $('license-error').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally { $('activate-btn').disabled = false; }
  });
  api.onStatus(({ runId, text }) => { if (runId === state.runId) $('run-status').textContent = text; });
  api.onOutput(({ runId, stream, text }) => { if (runId === state.runId) appendOut(text, stream); });
  api.onExit(async ({ runId, code, signal }) => {
    if (runId !== state.runId) return;
    setRunning(false);
    const ok = code === 0;
    $('run-status').textContent = ok ? (state.action.successMessage || 'Done.') : signal ? 'Stopped.' : `Finished with an error (exit code ${code}).`;
    appendOut(`\n${ok ? '✓ Done' : `✗ Exit code ${code ?? signal}`}\n`, 'meta');
    // Gentle, honest nudge after a successful free try of a Pro tool.
    if (ok && state.tool.tier === 'pro' && !(state.info && state.info.pro) && state.info.checkoutUrl) {
      const left = Math.max(0, (state.tool.access.left ?? 1) - 1);
      $('run-status').append(' ', el('span', { class: 'muted' }, left ? `(${left} free ${left === 1 ? 'try' : 'tries'} left)` : '(that was your last free try)'), ' ',
        el('button', { class: 'link-btn', type: 'button', onclick: () => openLicense() }, 'Get Pro — unlimited use'));
    }
    if (ok && state.action.openAfter && state.values[state.action.openAfter]) {
      const target = state.values[state.action.openAfter];
      $('run-status').append(' ', el('button', { class: 'link-btn', type: 'button', onclick: () => api.open(Array.isArray(target) ? target[0] : target) }, 'Show result'));
    }
    await refreshTools();
  });
  $('mcp-btn').addEventListener('click', async () => {
    const info = await api.mcpInfo();
    const json = JSON.stringify(info.config, null, 2);
    $('mcp-json').textContent = json;
    $('mcp-tools').replaceChildren(...info.tools.map((t) => el('li', {}, `${t.name} — ${t.title}`)));
    $('mcp-count').textContent = `The ${info.tools.length} tools your AI gets`;
    $('mcp-result').textContent = '';
    $('mcp-dialog').showModal();
    $('mcp-copy').onclick = async () => { await api.copy(json); $('mcp-result').textContent = 'Copied. Paste it into your AI app’s MCP settings.'; };
    const install = (client, label) => async () => {
      try {
        const r = await api.mcpInstall(client);
        $('mcp-result').textContent = `Added to ${label} (${r.file}). Quit and reopen ${label} to start using the tools.`;
      } catch (e) { $('mcp-result').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
    };
    $('mcp-claude').onclick = install('claude', 'Claude Desktop');
    $('mcp-cursor').onclick = install('cursor', 'Cursor');
  });
  api.onLicenseChanged(refreshTools);
  api.onCatalogChanged(refreshTools);
  $('update-btn').addEventListener('click', () => api.open(state.info.update.url));
  $('legal-btn').addEventListener('click', () => api.open(state.info.legalUrl));
  if (state.tools.length) selectTool(state.tools[0].id);
}

init().catch((e) => { document.body.prepend(el('pre', { class: 'error' }, String(e.stack || e))); });
