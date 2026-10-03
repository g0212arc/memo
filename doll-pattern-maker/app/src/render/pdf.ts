// 原寸 PDF（A4 縦、余白 10mm）。並べた全体を A4 の印刷範囲ごとに分割する。
// 日本語・中国語の文字はフォント埋め込みを避けるため画像にして貼る（線はベクターのまま）。

import { jsPDF } from 'jspdf';
import { Cmd, STROKE_STYLE } from './draw';
import { A4_PRINT_H, A4_PRINT_W } from './layout';

const PAGE_W = 210;
const PAGE_H = 297;
const M = 10;
const PW = A4_PRINT_W * 10;
const PH = A4_PRINT_H * 10;

/** 文字を画像（PNG の data URL）にする。ブラウザでは canvas、テストでは null を返す関数を渡す */
export type TextRasterizer = (text: string, sizeMm: number) => { dataUrl: string; wMm: number; hMm: number } | null;

export function canvasRasterizer(): TextRasterizer {
  return (text, sizeMm) => {
    const pxPerMm = 8;
    const fontPx = Math.round(sizeMm * pxPerMm);
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const font = `${fontPx}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 4;
    const h = Math.ceil(fontPx * 1.3);
    c.width = w;
    c.height = h;
    ctx.font = font;
    ctx.fillStyle = '#222';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, 2, Math.round(fontPx * 1.0));
    return { dataUrl: c.toDataURL('image/png'), wMm: w / pxPerMm, hMm: h / pxPerMm };
  };
}

const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] as const;

/** pages: 出力するページ番号（1 から。左上から右へ、行ごと）。省略すると全部 */
export function buildPdf(cmds: Cmd[], widthMm: number, heightMm: number, raster: TextRasterizer, pages?: number[]): jsPDF {
  const cols = Math.max(1, Math.ceil(widthMm / PW - 1e-6));
  const rows = Math.max(1, Math.ceil(heightMm / PH - 1e-6));
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const total = rows * cols;
  const want = new Set(pages ?? Array.from({ length: total }, (_, i) => i + 1));
  let first = true;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = r * cols + c + 1;
      if (!want.has(n)) continue;
      if (!first) doc.addPage('a4', 'portrait');
      first = false;
      const ox = M - c * PW;
      const oy = M - r * PH;

      // ページの印刷範囲に切り抜いて描く
      doc.saveGraphicsState();
      doc.rect(M, M, PW, PH, null);
      doc.clip();
      doc.discardPath();
      for (const cmd of cmds) drawCmd(doc, cmd, ox, oy, raster);
      doc.restoreGraphicsState();

      // 貼り合わせ用の枠と番号
      doc.setLineDashPattern([], 0);
      doc.setDrawColor(170, 170, 170);
      doc.setLineWidth(0.15);
      doc.rect(M, M, PW, PH);
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`p.${n} / ${total}${cols > 1 ? `  (row ${r + 1}, col ${c + 1})` : ''}`, PAGE_W - M, PAGE_H - M + 5, { align: 'right' });
      doc.text('Print at 100% (actual size)', M, PAGE_H - M + 5);
    }
  }
  return doc;
}

function drawCmd(doc: jsPDF, cmd: Cmd, ox: number, oy: number, raster: TextRasterizer) {
  if (cmd.t === 'poly' || cmd.t === 'rect') {
    const st = STROKE_STYLE[cmd.stroke];
    doc.setLineWidth(st.width);
    doc.setDrawColor(...hex(st.color));
    doc.setLineDashPattern(st.dash ?? [], 0);
  }
  if (cmd.t === 'poly') {
    if (cmd.pts.length < 2) return;
    const [p0, ...rest] = cmd.pts;
    const deltas: [number, number][] = [];
    let prev = p0;
    for (const p of rest) {
      deltas.push([p.x - prev.x, p.y - prev.y]);
      prev = p;
    }
    doc.lines(deltas, p0.x + ox, p0.y + oy, [1, 1], 'S', cmd.closed);
  } else if (cmd.t === 'rect') {
    doc.rect(cmd.at.x + ox, cmd.at.y + oy, cmd.w, cmd.h, 'S');
  } else {
    // ASCII だけなら PDF の標準フォントで、それ以外は画像で
    if (/^[\x20-\x7e]*$/.test(cmd.text)) {
      doc.setFontSize(cmd.size / 0.3528);
      doc.setTextColor(34, 34, 34);
      doc.text(cmd.text, cmd.at.x + ox, cmd.at.y + oy, { align: cmd.anchor === 'middle' ? 'center' : 'left' });
      return;
    }
    const img = raster(cmd.text, cmd.size);
    if (!img) return;
    const x = cmd.anchor === 'middle' ? cmd.at.x - img.wMm / 2 : cmd.at.x;
    doc.addImage(img.dataUrl, 'PNG', x + ox, cmd.at.y + oy - cmd.size, img.wMm, img.hMm);
  }
}
