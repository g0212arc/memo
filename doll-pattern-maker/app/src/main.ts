// 画面の組み立て。状態が変わるたびに全体を描き直す（画面が小さいので単純さを優先）。

import { assignImportCategory, Body, measurementsOf, newId, parseImport } from './model/body';
import { resolveBody, ResolvedBody } from './model/estimate';
import { DEF_BY_KEY, MEASUREMENTS, MeasurementKey } from './model/schema';
import { buildImportPrompt } from './model/prompt';
import { SAMPLE_BODIES } from './samples';
import { CATEGORIES, Category, guessCategory, isCategory } from './model/category';
import { loadBodies, loadState, saveBodies, saveState, UiState } from './store';
import { MissingMeasurementsError } from './pattern/items/tshirt';
import { bustLarge } from './pattern/bust';
import { FieldCtx, FieldSpec, ITEMS, ITEM_BY_ID, ItemDef } from './pattern/items';
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
  types: saved.types ?? {},
  item: saved.item && ITEM_BY_ID[saved.item] ? saved.item : ITEMS[0].id,
  // 保存された設定に、新しく増えた項目の初期値を補う
  params: Object.fromEntries(
    ITEMS.map((i) => [i.id, { ...i.defaults, ...(i.id === 'tshirt' ? saved.tshirt : undefined), ...saved.params?.[i.id] }]),
  ),
  sa: { seam: 0.5, hem: 0.8, opening: 0.8, ...saved.sa },
};
// スマホは閲覧中心なので、最初は縮小して全体を見せる
let zoom = window.innerWidth < 800 ? 0.5 : 1;

interface Current {
  item: ItemDef;
  body: Body;
  resolved: ResolvedBody;
  draft: DraftResult | null;
  missing: MeasurementKey[];
  layout: Layout | null;
  cmds: Cmd[];
}

function compute(): Current {
  const item = currentItem();
  const body = bodies.find((b) => b.id === st.bodyId) ?? bodies[0];
  const typeIdx = typeIndexOf(body);
  const resolved = resolveBody(body, st.variants[body.id], typeIdx);
  const typeLabel = body.types?.[typeIdx]?.label;
  let draft: DraftResult | null = null;
  let missing: MeasurementKey[] = [];
  try {
    draft = item.draft(resolved, st.params[item.id]);
  } catch (e) {
    if (e instanceof MissingMeasurementsError) missing = e.keys;
    else throw e;
  }
  const layout = draft ? layoutPieces(draft.pieces, st.sa) : null;
  const cmds = layout ? drawCommands(layout, st.sa, `${body.name}${typeLabel ? `（${typeLabel}）` : ''} / ${item.label} / ${new Date().toLocaleDateString('ja-JP')}`) : [];
  return { item, body, resolved, draft, missing, layout, cmds };
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
  // カテゴリごとに見出しを付けて並べる（カテゴリがないボディは身長からの仮のカテゴリに入れる）
  const catOf = (b: Body): { cat: Category | null; guessed: boolean } =>
    b.category ? { cat: b.category, guessed: false } : { cat: guessCategory(b), guessed: true };
  const option = (b: Body, guessed: boolean) =>
    `<option value="${esc(b.id)}"${b.id === body.id ? ' selected' : ''}>${esc(b.name)}${guessed ? '（仮）' : ''}</option>`;
  const groups = [...CATEGORIES, null].map((c) => {
    const items = bodies.filter((b) => catOf(b).cat === c);
    if (!items.length) return '';
    return `<optgroup label="${c ?? '未分類'}">${items.map((b) => option(b, catOf(b).guessed)).join('')}</optgroup>`;
  });
  const opts = groups.join('');

  const ms = measurementsOf(body, typeIndexOf(body));
  const variantRows = (Object.entries(ms) as [MeasurementKey, NonNullable<Body['measurements'][MeasurementKey]>][])
    .filter(([, m]) => m.variants && m.variants.length > 1)
    .map(([k, m]) => {
      const sel = st.variants[body.id]?.[k] ?? 0;
      const o = m.variants!.map((vr, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(vr.label)}（${fmt(vr.value)}cm）</option>`).join('');
      return `<div class="row"><label>${esc(DEF_BY_KEY[k].ja)}</label><select data-variant="${k}">${o}</select></div>`;
    })
    .join('');

  const reqKeys = cur.item.requirements.map((r) => r.key);
  const otherKeys = MEASUREMENTS.map((d) => d.key).filter((k) => !reqKeys.includes(k) && ms[k]);
  const row = (k: MeasurementKey) => {
    const d = DEF_BY_KEY[k];
    const v = resolved.values[k];
    const src = resolved.sources[k];
    const missing = v === undefined;
    const badge = missing
      ? '<span class="badge missing">なし</span>'
      : `<span class="badge ${src}">${src === 'maker' ? 'メーカー' : src === 'measured' ? '実測' : '推定'}</span>`;
    const hasVariants = (ms[k]?.variants?.length ?? 0) > 1;
    const help =
      missing || src === 'estimated'
        ? `<span class="help">${src === 'estimated' ? `推定: ${esc(resolved.notes[k] ?? '')}／` : ''}測り方: ${esc(d.howTo)}</span>`
        : '';
    return `<tr class="${missing ? 'missing' : src === 'estimated' ? 'estimated' : ''}">
      <td class="name">${esc(d.ja)}${help}</td>
      <td><input type="number" step="0.1" min="0" data-measure="${k}" value="${v === undefined ? '' : fmt(v)}"${hasVariants ? ' disabled title="上のバリエーションで選びます"' : ''}> cm</td>
      <td>${badge}</td></tr>`;
  };

  $('panel').innerHTML = `
    <h2>ボディ</h2>
    <div class="row"><select id="body-select">${opts}</select></div>
    ${body.types ? `<div class="row"><label>タイプ</label><select id="body-type">${body.types.map((t, i) => `<option value="${i}"${i === typeIndexOf(body) ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div>` : ''}
    <div class="row">
      <button id="open-import" class="primary">採寸を取り込む</button>
      <button id="export-body">JSONで保存</button>
      <button id="delete-body"${body.sample ? ' disabled' : ''}>削除</button>
    </div>
    ${body.sample ? '<p class="note">サンプル（参考値）です。値を書き換えると、コピーを作ってそちらを編集します。</p>' : ''}
    ${variantRows ? `<h2>パーツの選択</h2>${variantRows}` : ''}

    <h2>採寸値（${esc(cur.item.label)}に使う項目）</h2>
    <p class="note">「推定」は他の値から計算した仮の値です。実物を測って入れると「実測」になります。</p>
    <table class="measure">${reqKeys.map(row).join('')}</table>
    ${otherKeys.length ? `<h2>その他の採寸値</h2><table class="measure">${otherKeys.map(row).join('')}</table>` : ''}

    <h2>${esc(cur.item.label)}の設定</h2>
    ${renderFields(cur.item.fields, st.params[cur.item.id], { category: cur.resolved.category, bustLarge: bustLarge(cur.resolved.values) })}

    <h2>縫い代</h2>
    <div class="row"><label>縫い合わせ</label><input type="number" data-sa="seam" step="1" min="0" value="${Math.round(st.sa.seam * 10)}"> mm</div>
    <div class="row"><label>裾・袖口</label><input type="number" data-sa="hem" step="1" min="0" value="${Math.round(st.sa.hem * 10)}"> mm</div>
    <div class="row"><label>背中開き</label><input type="number" data-sa="opening" step="1" min="0" value="${Math.round(st.sa.opening * 10)}"> mm</div>
  `;
}

/** アイテムの設定欄を fields の定義から作る */
function renderFields(fields: FieldSpec[], p: Record<string, unknown>, ctx: FieldCtx): string {
  return fields
    .filter((f) => !f.show || f.show(p, ctx))
    .map((f) => {
      const help = f.help ? `<span class="help">${esc(f.help)}</span>` : '';
      if (f.kind === 'radio' || f.kind === 'select') {
        // ボディによって選べない選択肢は隠し、選ばれていたら先頭を選んだ表示にする
        const options = f.options.filter(([v]) => !f.available || f.available(v, ctx));
        const selected = options.some(([v]) => v === p[f.key]) ? p[f.key] : options[0]?.[0];
        if (f.kind === 'select') {
          const opts = options.map(([v, l]) => `<option value="${v}"${selected === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
          return `<div class="row"><label>${esc(f.label)}</label><select data-field="${f.key}">${opts}</select>${help}</div>`;
        }
        const opts = options
          .map(([v, l]) => `<label><input type="radio" name="field-${f.key}" data-field="${f.key}" value="${v}"${selected === v ? ' checked' : ''}> ${esc(l)}</label>`)
          .join(' ');
        return `<div class="row"><span class="field-label">${esc(f.label)}</span>${opts}${help}</div>`;
      }
      if (f.kind === 'checkbox') {
        return `<div class="row"><label><input type="checkbox" data-field="${f.key}"${p[f.key] ? ' checked' : ''}> ${esc(f.label)}</label>${help}</div>`;
      }
      const val = p[f.key] === null || p[f.key] === undefined ? '' : String(p[f.key]);
      return `<div class="row"><label>${esc(f.label)}</label><input type="number" data-field="${f.key}" step="${f.step}"${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''} value="${val}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}>${f.unit ? ` ${f.unit}` : ''}${help}</div>`;
    })
    .join('');
}

function renderToolbar(cur: Current) {
  const disabled = cur.layout ? '' : ' disabled';
  $('toolbar').innerHTML = `
    <label class="item-pick">アイテム <select id="item-select">${ITEMS.map((i) => `<option value="${i.id}"${i.id === cur.item.id ? ' selected' : ''}>${esc(i.label)}</option>`).join('')}</select></label>
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
  const est = cur.item.requirements.map((r) => r.key).filter((k) => cur.resolved.sources[k] === 'estimated');
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

function currentItem(): ItemDef {
  return ITEM_BY_ID[st.item] ?? ITEMS[0];
}

function currentBody() {
  return bodies.find((b) => b.id === st.bodyId) ?? bodies[0];
}

/** 選んでいるタイプ（タイプがないボディは 0） */
function typeIndexOf(b: Body): number {
  const i = st.types?.[b.id] ?? 0;
  return b.types && i < b.types.length ? i : 0;
}

/** サンプルを編集しようとしたらコピーを作って切り替える */
function editableBody(): Body {
  const b = currentBody();
  if (!b.sample) return b;
  const copy: Body = { ...structuredClone(b), id: newId(), name: `${b.name}（コピー）`, sample: false };
  bodies.push(copy);
  st.variants[copy.id] = { ...st.variants[b.id] };
  st.types = { ...st.types, [copy.id]: typeIndexOf(b) };
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
  } else if (el.id === 'body-type') {
    st.types = { ...st.types, [currentBody().id]: Number(el.value) };
  } else if (el.dataset.variant) {
    const b = currentBody();
    st.variants[b.id] = { ...st.variants[b.id], [el.dataset.variant]: Number(el.value) };
  } else if (el.dataset.measure) {
    const k = el.dataset.measure as MeasurementKey;
    const b = editableBody();
    const n = Number(el.value);
    // 2つ目以降のタイプを選んでいるときは、そのタイプの値として書き込む
    const ti = typeIndexOf(b);
    const target = b.types && ti > 0 ? b.types[ti].measurements : b.measurements;
    if (el.value === '' || !(n > 0)) delete target[k];
    else target[k] = { ...measurementsOf(b, ti)[k], value: n, source: 'measured', variants: undefined };
  } else if (el.id === 'item-select') {
    if (ITEM_BY_ID[el.value]) st.item = el.value;
  } else if (el.dataset.field) {
    const item = currentItem();
    const f = item.fields.find((x) => x.key === el.dataset.field);
    if (!f) return;
    const p = st.params[item.id];
    const inp = el as HTMLInputElement;
    if (f.kind === 'checkbox') p[f.key] = inp.checked;
    else if (f.kind === 'number') {
      if (inp.value === '' && f.nullable) p[f.key] = null;
      else {
        const n = Number(inp.value);
        if (inp.value === '' || !Number.isFinite(n)) return;
        p[f.key] = n;
      }
    } else p[f.key] = el.value;
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
      $('import-category').innerHTML =
        '<option value="">自動（返答の表記から）</option>' + CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
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
      const chosen = $<HTMLSelectElement>('import-category').value;
      const assigned = assignImportCategory(r.bodies, isCategory(chosen) ? chosen : null);
      const needCategory = assigned.needCategory;
      // 1体でもカテゴリ待ちがあれば全部取り込まない（選び直して押したときに二重にならないように）
      const accepted = needCategory.length ? [] : assigned.accepted;
      bodies.push(...accepted);
      if (accepted.length) st.bodyId = accepted[0].id;
      const parts: string[] = [];
      if (accepted.length) {
        parts.push(`<div class="msg info">取り込みました: ${accepted.map((b) => `${esc(b.name)}（${b.category}）`).join('、')}</div>`);
      }
      if (needCategory.length) {
        parts.push(
          `<div class="msg err">${needCategory.map((b) => esc(b.name)).join('、')} はカテゴリの表記がなかったので、まだ何も取り込んでいません。上の「カテゴリ」で選んでから、もう一度「取り込む」を押してください。</div>`,
        );
      }
      if (r.errors.length) parts.push(`<div class="msg err"><ul>${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`);
      if (r.warnings.length) parts.push(`<div class="msg warn">確認してください<ul>${r.warnings.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`);
      $('import-result').innerHTML = parts.join('');
      // カテゴリ待ちのボディがあるときは、選び直して押せるよう貼り付けた内容を残す
      if (accepted.length) $<HTMLTextAreaElement>('import-text').value = '';
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
      download(`${safeName(c.body.name)}_${c.item.label}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
      break;
    }
    case 'save-pdf': {
      const c = cur();
      if (!c.layout) return;
      el.setAttribute('disabled', '');
      try {
        const { buildPdf, canvasRasterizer } = await import('./render/pdf');
        const doc = buildPdf(c.cmds, c.layout.width * 10, c.layout.height * 10, canvasRasterizer());
        download(`${safeName(c.body.name)}_${c.item.label}.pdf`, doc.output('blob'));
      } finally {
        el.removeAttribute('disabled');
      }
      break;
    }
  }
});

render();
