// 画面の組み立て。状態が変わるたびに全体を描き直す（画面が小さいので単純さを優先）。

import { Body, newId, parseImport } from './model/body';
import { resolveBody, ResolvedBody } from './model/estimate';
import { DEF_BY_KEY, MEASUREMENTS, MeasurementKey } from './model/schema';
import { buildImportPrompt } from './model/prompt';
import { SAMPLE_BODIES } from './samples';
import { loadBodies, loadState, saveBodies, saveState, UiState } from './store';
import { DEFAULT_TSHIRT, draftTshirt, MissingMeasurementsError, TSHIRT_REQUIREMENTS } from './pattern/items/tshirt';
import { DraftResult } from './pattern/types';
import { layoutPieces, Layout } from './render/layout';
import { drawCommands, Cmd } from './render/draw';
import { toSvg } from './render/svg';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (x: number) => String(Math.round(x * 100) / 100);

let bodies: Body[] = [...SAMPLE_BODIES, ...loadBodies()];
const saved = loadState();
const st: UiState = {
  bodyId: saved.bodyId && bodies.some((b) => b.id === saved.bodyId) ? saved.bodyId : bodies[0].id,
  variants: saved.variants ?? {},
  tshirt: { ...DEFAULT_TSHIRT, ...saved.tshirt },
  sa: { seam: 0.5, hem: 0.8, opening: 0.8, ...saved.sa },
};
// スマホは閲覧中心なので、最初は縮小して全体を見せる
let zoom = window.innerWidth < 800 ? 0.5 : 1;

interface Current {
  body: Body;
  resolved: ResolvedBody;
  draft: DraftResult | null;
  missing: MeasurementKey[];
  layout: Layout | null;
  cmds: Cmd[];
}

function compute(): Current {
  const body = bodies.find((b) => b.id === st.bodyId) ?? bodies[0];
  const resolved = resolveBody(body, st.variants[body.id]);
  let draft: DraftResult | null = null;
  let missing: MeasurementKey[] = [];
  try {
    draft = draftTshirt(resolved, st.tshirt);
  } catch (e) {
    if (e instanceof MissingMeasurementsError) missing = e.keys;
    else throw e;
  }
  const layout = draft ? layoutPieces(draft.pieces, st.sa) : null;
  const cmds = layout ? drawCommands(layout, st.sa, `${body.name} / Tシャツ / ${new Date().toLocaleDateString('ja-JP')}`) : [];
  return { body, resolved, draft, missing, layout, cmds };
}

function persist() {
  saveBodies(bodies);
  saveState(st);
}

// ---------------- 描画 ----------------

function render() {
  const cur = compute();
  renderPanel(cur);
  renderToolbar(cur);
  renderMessages(cur);
  renderCanvas(cur);
}

function renderPanel(cur: Current) {
  const { body, resolved } = cur;
  const opts = bodies
    .map((b) => `<option value="${esc(b.id)}"${b.id === body.id ? ' selected' : ''}>${esc(b.name)}${b.sample ? '（サンプル）' : ''}</option>`)
    .join('');

  const variantRows = (Object.entries(body.measurements) as [MeasurementKey, NonNullable<Body['measurements'][MeasurementKey]>][])
    .filter(([, m]) => m.variants && m.variants.length > 1)
    .map(([k, m]) => {
      const sel = st.variants[body.id]?.[k] ?? 0;
      const o = m.variants!.map((vr, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(vr.label)}（${fmt(vr.value)}cm）</option>`).join('');
      return `<div class="row"><label>${esc(DEF_BY_KEY[k].ja)}</label><select data-variant="${k}">${o}</select></div>`;
    })
    .join('');

  const reqKeys = TSHIRT_REQUIREMENTS.map((r) => r.key);
  const otherKeys = MEASUREMENTS.map((d) => d.key).filter((k) => !reqKeys.includes(k) && body.measurements[k]);
  const row = (k: MeasurementKey) => {
    const d = DEF_BY_KEY[k];
    const v = resolved.values[k];
    const src = resolved.sources[k];
    const missing = v === undefined;
    const badge = missing
      ? '<span class="badge missing">なし</span>'
      : `<span class="badge ${src}">${src === 'maker' ? 'メーカー' : src === 'measured' ? '実測' : '推定'}</span>`;
    const hasVariants = (body.measurements[k]?.variants?.length ?? 0) > 1;
    const help =
      missing || src === 'estimated'
        ? `<span class="help">${src === 'estimated' ? `推定: ${esc(resolved.notes[k] ?? '')}／` : ''}測り方: ${esc(d.howTo)}</span>`
        : '';
    return `<tr class="${missing ? 'missing' : src === 'estimated' ? 'estimated' : ''}">
      <td class="name">${esc(d.ja)}${help}</td>
      <td><input type="number" step="0.1" min="0" data-measure="${k}" value="${v === undefined ? '' : fmt(v)}"${hasVariants ? ' disabled title="上のバリエーションで選びます"' : ''}> cm</td>
      <td>${badge}</td></tr>`;
  };

  const t = st.tshirt;
  $('panel').innerHTML = `
    <h2>ボディ</h2>
    <div class="row"><select id="body-select">${opts}</select></div>
    <div class="row">
      <button id="open-import" class="primary">採寸を取り込む</button>
      <button id="export-body">JSONで保存</button>
      <button id="delete-body"${body.sample ? ' disabled' : ''}>削除</button>
    </div>
    ${body.sample ? '<p class="note">サンプル（参考値）です。値を書き換えると、コピーを作ってそちらを編集します。</p>' : ''}
    ${variantRows ? `<h2>パーツの選択</h2>${variantRows}` : ''}

    <h2>採寸値（Tシャツに使う項目）</h2>
    <p class="note">「推定」は他の値から計算した仮の値です。実物を測って入れると「実測」になります。</p>
    <table class="measure">${reqKeys.map(row).join('')}</table>
    ${otherKeys.length ? `<h2>その他の採寸値</h2><table class="measure">${otherKeys.map(row).join('')}</table>` : ''}

    <h2>Tシャツ</h2>
    <div class="row">
      <label><input type="radio" name="fabric" value="knit"${t.fabric === 'knit' ? ' checked' : ''}> ニット（伸びる布）</label>
      <label><input type="radio" name="fabric" value="woven"${t.fabric === 'woven' ? ' checked' : ''}> 布帛（伸びない布）</label>
    </div>
    ${t.fabric === 'knit' ? `<div class="row"><label>伸び率</label><input type="number" data-param="stretch" step="5" min="0" max="100" value="${t.stretch}"> %<span class="help">横に引っぱったとき何％伸びるか。襟ぐりの縁取り布の長さに使います。</span></div>` : ''}
    <div class="row"><label><input type="checkbox" data-param="backOpening"${t.backOpening ? ' checked' : ''}> 背中開き（面ファスナー・スナップ）</label></div>
    <div class="row"><label>着丈（ウエストから下へ）</label><input type="number" data-param="hemBelowWaist" step="0.1" value="${t.hemBelowWaist ?? ''}" placeholder="自動"> cm<span class="help">空欄なら腰丈の 8 割。マイナスで短くなります。</span></div>
    <div class="row"><label>袖丈（腕の長さに対して）</label><input type="number" data-param="sleeveRatio" step="0.05" min="0.1" max="1" value="${t.sleeveRatio}"><span class="help">0.3 で半袖。1.0 で手首まで。</span></div>
    <div class="row"><label>胸のゆとりを足す</label><input type="number" data-param="extraChestEase" step="0.1" value="${t.extraChestEase}"> cm</div>
    <div class="row"><label>前襟ぐりを下げる</label><input type="number" data-param="frontNeckDrop" step="0.1" value="${t.frontNeckDrop}"> cm</div>

    <h2>縫い代</h2>
    <div class="row"><label>縫い合わせ</label><input type="number" data-sa="seam" step="1" min="0" value="${Math.round(st.sa.seam * 10)}"> mm</div>
    <div class="row"><label>裾・袖口</label><input type="number" data-sa="hem" step="1" min="0" value="${Math.round(st.sa.hem * 10)}"> mm</div>
    <div class="row"><label>背中開き</label><input type="number" data-sa="opening" step="1" min="0" value="${Math.round(st.sa.opening * 10)}"> mm</div>
  `;
}

function renderToolbar(cur: Current) {
  const disabled = cur.layout ? '' : ' disabled';
  $('toolbar').innerHTML = `
    <button id="save-pdf" class="primary"${disabled}>PDFを保存（A4・原寸）</button>
    <button id="save-svg"${disabled}>SVGを保存</button>
    <label class="zoom">表示倍率
      <select id="zoom">${[0.5, 1, 2, 3].map((z) => `<option value="${z}"${z === zoom ? ' selected' : ''}>${z * 100}%</option>`).join('')}</select>
    </label>`;
}

function renderMessages(cur: Current) {
  const out: string[] = [];
  if (cur.missing.length) {
    out.push(
      `<div class="msg err">作図に必要な採寸値がありません。左の表で入力してください。<ul>${cur.missing
        .map((k) => `<li><b>${esc(DEF_BY_KEY[k].ja)}</b>: ${esc(DEF_BY_KEY[k].howTo)}</li>`)
        .join('')}</ul></div>`,
    );
  }
  const est = TSHIRT_REQUIREMENTS.map((r) => r.key).filter((k) => cur.resolved.sources[k] === 'estimated');
  if (est.length) {
    out.push(`<div class="msg warn">推定値を使っています: ${est.map((k) => esc(DEF_BY_KEY[k].ja)).join('、')}。実測すると精度が上がります。</div>`);
  }
  const warns = [...cur.resolved.warnings, ...(cur.draft?.warnings ?? []), ...cur.body.ambiguities.map((a) => `メモ: ${a}`)];
  if (warns.length) out.push(`<div class="msg warn"><ul>${warns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
  if (cur.draft) out.push(`<div class="msg info"><ul>${cur.draft.info.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
  $('messages').innerHTML = out.join('');
}

function renderCanvas(cur: Current) {
  if (!cur.layout) {
    $('canvas').innerHTML = '';
    return;
  }
  const w = cur.layout.width * 10;
  const h = cur.layout.height * 10;
  $('canvas').innerHTML = toSvg(cur.cmds, { widthMm: w, heightMm: h, grid: true });
  const svg = $('canvas').querySelector('svg')!;
  svg.setAttribute('width', `${w * zoom}mm`);
  svg.setAttribute('height', `${h * zoom}mm`);
}

// ---------------- 操作 ----------------

function currentBody() {
  return bodies.find((b) => b.id === st.bodyId) ?? bodies[0];
}

/** サンプルを編集しようとしたらコピーを作って切り替える */
function editableBody(): Body {
  const b = currentBody();
  if (!b.sample) return b;
  const copy: Body = { ...structuredClone(b), id: newId(), name: `${b.name}（コピー）`, sample: false };
  bodies.push(copy);
  st.variants[copy.id] = { ...st.variants[b.id] };
  st.bodyId = copy.id;
  return copy;
}

function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_');

document.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  if (el.id === 'body-select') {
    st.bodyId = el.value;
  } else if (el.id === 'zoom') {
    zoom = Number(el.value);
  } else if (el.dataset.variant) {
    const b = currentBody();
    st.variants[b.id] = { ...st.variants[b.id], [el.dataset.variant]: Number(el.value) };
  } else if (el.dataset.measure) {
    const k = el.dataset.measure as MeasurementKey;
    const b = editableBody();
    const n = Number(el.value);
    if (el.value === '' || !(n > 0)) delete b.measurements[k];
    else b.measurements[k] = { ...b.measurements[k], value: n, source: 'measured', variants: undefined };
  } else if (el.name === 'fabric') {
    st.tshirt.fabric = el.value as 'knit' | 'woven';
  } else if (el.dataset.param) {
    const p = el.dataset.param;
    const inp = el as HTMLInputElement;
    if (p === 'backOpening') st.tshirt.backOpening = inp.checked;
    else if (p === 'hemBelowWaist') st.tshirt.hemBelowWaist = inp.value === '' ? null : Number(inp.value);
    else if (p === 'stretch' || p === 'sleeveRatio' || p === 'extraChestEase' || p === 'frontNeckDrop') {
      const n = Number(inp.value);
      if (Number.isFinite(n)) st.tshirt[p] = n;
    }
  } else if (el.dataset.sa) {
    const n = Number(el.value);
    if (Number.isFinite(n) && n >= 0) st.sa[el.dataset.sa as 'seam' | 'hem' | 'opening'] = n / 10;
  } else {
    return;
  }
  persist();
  render();
});

document.addEventListener('click', async (ev) => {
  const el = (ev.target as HTMLElement).closest('button');
  if (!el) return;
  const cur = () => compute();
  switch (el.id) {
    case 'open-import':
      $('import-result').innerHTML = '';
      $<HTMLDialogElement>('import-dialog').showModal();
      break;
    case 'copy-prompt': {
      const text = buildImportPrompt();
      try {
        await navigator.clipboard.writeText(text);
        $('copy-status').textContent = 'コピーしました';
      } catch {
        $<HTMLTextAreaElement>('import-text').value = text;
        $('copy-status').textContent = 'コピーできなかったので下の欄に表示しました。選択してコピーしてください。';
      }
      break;
    }
    case 'do-import': {
      const r = parseImport($<HTMLTextAreaElement>('import-text').value);
      bodies.push(...r.bodies);
      if (r.bodies.length) st.bodyId = r.bodies[0].id;
      const parts: string[] = [];
      if (r.bodies.length) parts.push(`<div class="msg info">取り込みました: ${r.bodies.map((b) => esc(b.name)).join('、')}</div>`);
      if (r.errors.length) parts.push(`<div class="msg err"><ul>${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`);
      if (r.warnings.length) parts.push(`<div class="msg warn">確認してください<ul>${r.warnings.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`);
      $('import-result').innerHTML = parts.join('');
      if (r.bodies.length) $<HTMLTextAreaElement>('import-text').value = '';
      persist();
      render();
      break;
    }
    case 'export-body': {
      const b = currentBody();
      const { id: _id, sample: _s, ...rest } = b;
      download(`${safeName(b.name)}.json`, new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' }));
      break;
    }
    case 'delete-body': {
      const b = currentBody();
      if (b.sample || !confirm(`「${b.name}」を削除しますか？`)) return;
      bodies = bodies.filter((x) => x.id !== b.id);
      delete st.variants[b.id];
      st.bodyId = bodies[0].id;
      persist();
      render();
      break;
    }
    case 'save-svg': {
      const c = cur();
      if (!c.layout) return;
      const svg = toSvg(c.cmds, { widthMm: c.layout.width * 10, heightMm: c.layout.height * 10 });
      download(`${safeName(c.body.name)}_Tシャツ.svg`, new Blob([svg], { type: 'image/svg+xml' }));
      break;
    }
    case 'save-pdf': {
      const c = cur();
      if (!c.layout) return;
      el.setAttribute('disabled', '');
      try {
        const { buildPdf, canvasRasterizer } = await import('./render/pdf');
        const doc = buildPdf(c.cmds, c.layout.width * 10, c.layout.height * 10, canvasRasterizer());
        download(`${safeName(c.body.name)}_Tシャツ.pdf`, doc.output('blob'));
      } finally {
        el.removeAttribute('disabled');
      }
      break;
    }
  }
});

render();
