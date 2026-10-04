import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { ITEM_BY_ID } from '../src/pattern/items';
import { layoutPieces } from '../src/render/layout';
import { drawCommands } from '../src/render/draw';
import { buildPdf, headerLines } from '../src/render/pdf';
import { wrapEntries } from '../src/pattern/settings-text';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };

describe('PDF の各ページの見出し', () => {
  it('設定は 2 行まで。入りきらない分は続きは1ページ目', () => {
    expect(headerLines(['布：布帛', '丈：普通'], wrapEntries)).toEqual(['布：布帛 ／ 丈：普通']);
    const many = Array.from({ length: 40 }, (_, i) => `項目${i}：とても長い設定の値です`);
    const lines = headerLines(many, wrapEntries);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…（続きは1ページ目）')).toBe(true);
  });
  it('どのページにもタイトルと設定を書く', () => {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name.startsWith('松柏'))!);
    const item = ITEM_BY_ID.trench;
    const res = item.draft(r, item.defaults);
    const layout = layoutPieces(res.pieces, sa);
    const cmds = drawCommands(layout, sa, 'T');
    const texts: string[] = [];
    const raster = (t: string) => {
      texts.push(t);
      return null;
    };
    const total = layout.cols * layout.rows;
    expect(total).toBeGreaterThan(1);
    buildPdf(cmds, layout.width * 10, layout.height * 10, raster, undefined, { title: '松柏体 / トレンチ', lines: ['布：布帛', '丈：ロング'] });
    expect(texts.filter((t) => t.startsWith('松柏体 / トレンチ'))).toHaveLength(total);
    expect(texts.filter((t) => t === '丈：ロング')).toHaveLength(total);
  });
});
