// Valores de referencia con PDF reales. Requiere tests/local/ocr/*.json (generado con tools/ocr-folder.mjs).
// Esa carpeta está en .gitignore: son datos reales. Sin ella, estos tests se saltean.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { parseReporte, consolidar, resumenPlan, fmtMonto } from '../parser.js';

const dir = new URL('./local/ocr/', import.meta.url).pathname;
const hay = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.json'));
const REF = { W064433: '1.677.394,41', V934004: '2.633.897,29', V700890: '4.327.261,12', U281251: '42.514.159,79', U373777: '6.420.401,16', W317403: '1.881.295,64' };

test('totales de referencia = suma de cuotas = pie del reporte', { skip: !hay && 'sin tests/local/ocr' }, () => {
  const items = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f))); return { archivo: j.archivo, reporte: parseReporte(j.paginas, j.archivo) };
  });
  const planes = consolidar(items);
  for (const [plan, total] of Object.entries(REF)) {
    const p = planes.find((x) => x.numero === plan);
    assert.ok(p, `falta el plan ${plan}`);
    assert.equal(fmtMonto(p.pie.total), total, `${plan}: pie`);
    assert.equal(fmtMonto(resumenPlan(p).pagado.total), total, `${plan}: suma de cuotas`);
    assert.equal(p.alertas.filter((a) => a.nivel === 'critica').length, 0, `${plan}: alertas críticas`);
  }
});
