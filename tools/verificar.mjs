// Uso: node tools/verificar.mjs [carpeta-ocr=tests/local/ocr]
// Parsea los JSON de OCR (datos reales, ignorados por git) y compara contra los valores de referencia.
import fs from 'node:fs';
import path from 'node:path';
import { parseReporte, consolidar, resumenPlan, fmtMonto } from '../parser.js';

const dir = process.argv[2] || 'tests/local/ocr';
const REF = { W064433: '1.677.394,41', V934004: '2.633.897,29', V700890: '4.327.261,12', U281251: '42.514.159,79', U373777: '6.420.401,16', W317403: '1.881.295,64' };
const items = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f)));
  return { archivo: j.archivo, reporte: parseReporte(j.paginas, j.archivo) };
});
const planes = consolidar(items);
console.log(`${items.length} archivos → ${planes.length} planes\n`);
for (const p of planes) {
  const s = resumenPlan(p);
  const ref = REF[p.numero];
  const pie = p.pie?.total != null ? fmtMonto(p.pie.total) : '—';
  const dif = s.diferencia ? fmtMonto(s.diferencia.total) : '—';
  console.log(`${p.numero} ${p.tipo.padEnd(12)} v${p.version} cuotas=${s.cuotas} pagas=${s.pagas} pagado=${fmtMonto(s.pagado.total)} pie=${pie} dif=${dif} crit=${s.criticas} avisos=${s.avisos}${ref ? `  REF=${ref} ${ref === pie ? 'OK-pie' : 'PIE≠REF'}` : ''}`);
  if (process.argv.includes('-v') || ref) for (const a of p.alertas.filter((a) => a.nivel === 'critica')) console.log('    !', a.texto);
}
