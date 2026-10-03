// 描く命令を SVG 文字列にする（単位 mm、原寸）。

import { Cmd, STROKE_STYLE } from './draw';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n: number) => n.toFixed(2);

export interface SvgOptions {
  widthMm: number;
  heightMm: number;
  /** 1cm 方眼を描く（画面表示用） */
  grid?: boolean;
  /** ページの区切りと番号を描く（画面表示用）。1 ページの大きさ（mm）と並び */
  pages?: { wMm: number; hMm: number; cols: number; rows: number };
}

export function toSvg(cmds: Cmd[], o: SvgOptions): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(o.widthMm)}mm" height="${f(o.heightMm)}mm" viewBox="0 0 ${f(o.widthMm)} ${f(o.heightMm)}">`,
  );
  parts.push(`<rect x="0" y="0" width="${f(o.widthMm)}" height="${f(o.heightMm)}" fill="#ffffff"/>`);
  if (o.grid) {
    const lines: string[] = [];
    for (let x = 0; x <= o.widthMm; x += 10) lines.push(`M${x} 0V${f(o.heightMm)}`);
    for (let y = 0; y <= o.heightMm; y += 10) lines.push(`M0 ${y}H${f(o.widthMm)}`);
    parts.push(`<path d="${lines.join('')}" stroke="#e6ecf2" stroke-width="0.2" fill="none"/>`);
  }
  if (o.pages) {
    const { wMm, hMm, cols, rows } = o.pages;
    const lines: string[] = [];
    for (let c = 1; c < cols; c++) lines.push(`M${f(c * wMm)} 0V${f(o.heightMm)}`);
    for (let r = 1; r < rows; r++) lines.push(`M0 ${f(r * hMm)}H${f(o.widthMm)}`);
    if (lines.length) parts.push(`<path d="${lines.join('')}" stroke="#7a9cc6" stroke-width="0.5" stroke-dasharray="4 2" fill="none"/>`);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        parts.push(
          `<text x="${f((c + 1) * wMm - 3)}" y="${f((r + 1) * hMm - 3)}" font-size="5" text-anchor="end" font-family="sans-serif" fill="#7a9cc6">p.${r * cols + c + 1}</text>`,
        );
      }
    }
  }
  for (const c of cmds) {
    if (c.t === 'poly') {
      const st = STROKE_STYLE[c.stroke];
      const d = c.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join('') + (c.closed ? 'Z' : '');
      parts.push(
        `<path d="${d}" fill="none" stroke="${st.color}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash.join(' ')}"` : ''} stroke-linejoin="round"/>`,
      );
    } else if (c.t === 'rect') {
      const st = STROKE_STYLE[c.stroke];
      parts.push(`<rect x="${f(c.at.x)}" y="${f(c.at.y)}" width="${f(c.w)}" height="${f(c.h)}" fill="none" stroke="${st.color}" stroke-width="${st.width}"/>`);
    } else {
      parts.push(
        `<text x="${f(c.at.x)}" y="${f(c.at.y)}" font-size="${c.size}" text-anchor="${c.anchor}" font-family="sans-serif" fill="#222">${esc(c.text)}</text>`,
      );
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}
