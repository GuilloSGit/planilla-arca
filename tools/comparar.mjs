// Uso: node tools/comparar.mjs <otra-planilla.xlsx> [carpeta-ocr]
// Compara cuota por cuota el parser contra la hoja «Detalle cuotas» de otra planilla.
import fs from 'node:fs'; import path from 'node:path'; import ExcelJS from 'exceljs';
import { parseReporte, consolidar, fmtMonto } from '../parser.js';
const [xlsx, dir = 'tests/local/ocr'] = process.argv.slice(2);
const items = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { const j = JSON.parse(fs.readFileSync(path.join(dir, f))); return { archivo: j.archivo, reporte: parseReporte(j.paginas, j.archivo) }; });
const planes = new Map(consolidar(items).map((p) => [p.numero, p]));
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsx);
const ws = wb.getWorksheet('Detalle cuotas');
const c100 = (v) => (v == null || v === '' ? null : Math.round(Number(v) * 100));
let ok = 0, dif = 0; const vistos = new Set();
ws.eachRow((r, i) => {
  if (i === 1) return;
  const [plan, , cuota, cap, fin, est, vto, , , res, , , , resPend] = r.values.slice(1).map((v) => (v && typeof v === 'object' && !(v instanceof Date) && 'result' in v ? v.result : v));
  vistos.add(plan);
  const p = planes.get(plan); const c = p?.cuotas.find((x) => x.n === cuota);
  if (!c) { if (p?.tipo === 'cuotas' || cap != null) { dif++; console.log(`${plan} c${cuota}: ausente en mi parseo (tipo=${p?.tipo})`); } return; }
  const pag = est === 'Pagada';
  const probs = [];
  if (c.capital !== c100(cap)) probs.push(`capital ${fmtMonto(c.capital)} vs ${fmtMonto(c100(cap))}`);
  if (c.financiero !== c100(fin)) probs.push(`financiero ${fmtMonto(c.financiero)} vs ${fmtMonto(c100(fin))}`);
  if (c.pagada !== pag) probs.push(`estado ${c.pagada ? 'Pagada' : 'Impaga'} vs ${est}`);
  if (pag && c.resPagado !== c100(res)) probs.push(`res.pagado ${fmtMonto(c.resPagado)} vs ${fmtMonto(c100(res))}`);
  const vs = vto instanceof Date ? vto.toISOString().slice(0, 10) : vto;
  if (pag && c.vencPago !== vs) probs.push(`vto ${c.vencPago} vs ${vs}`);
  if (!pag && c.resPendiente !== (c100(resPend) ?? 0)) probs.push(`res.pend ${fmtMonto(c.resPendiente)} vs ${fmtMonto(c100(resPend) ?? 0)}`);
  if (probs.length) { dif++; console.log(`${plan} c${cuota}: ${probs.join('; ')}`); } else ok++;
});
console.log(`\ncuotas iguales: ${ok}, con diferencias: ${dif}`);
console.log('planes míos que no están en la otra planilla:', [...planes.keys()].filter((k) => !vistos.has(k)).join(', ') || '—');
