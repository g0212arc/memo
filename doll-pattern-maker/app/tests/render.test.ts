import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftTshirt, DEFAULT_TSHIRT } from '../src/pattern/items/tshirt';
import { layoutPieces, A4_PRINT_W } from '../src/render/layout';
import { drawCommands } from '../src/render/draw';
import { toSvg } from '../src/render/svg';
import { buildPdf } from '../src/render/pdf';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };

describe('出力', () => {
  for (const body of SAMPLE_BODIES) {
    it(`${body.name}: 並べた幅が A4 の印刷幅の倍数で、SVG と PDF が作れる`, () => {
      const res = draftTshirt(resolveBody(body), DEFAULT_TSHIRT);
      const layout = layoutPieces(res.pieces, sa);
      expect(layout.width % A4_PRINT_W).toBeCloseTo(0, 6);
      const cmds = drawCommands(layout, sa, body.name);
      const svg = toSvg(cmds, { widthMm: layout.width * 10, heightMm: layout.height * 10 });
      expect(svg).toContain('<path');
      expect(svg).toContain('3cm');
      const pdf = buildPdf(cmds, layout.width * 10, layout.height * 10, () => null);
      expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
      expect(pdf.output('arraybuffer').byteLength).toBeGreaterThan(1000);
    });
  }
});
