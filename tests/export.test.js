import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import { parseReporte, consolidar } from '../parser.js';
import { generarXlsx } from '../export.js';
import { texto, PIE_MAL } from './fixtures/plan-sintetico.js';

const col = (ws, titulo) => { let r = 0; ws.getRow(1).eachCell((c, i) => { if (String(c.value).startsWith(titulo)) r = i; }); assert.ok(r, `falta la columna «${titulo}»`); return r; };

async function libro(pie) {
  const planes = consolidar([{ archivo: 'E X000001.3.pdf', reporte: parseReporte(texto(pie), 'E X000001.3.pdf') }]);
  planes[0].cuotas[0].fechaPagoReal = '2026-05-10';
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await generarXlsx(ExcelJS, planes)); return wb;
}

test('hojas, fuente Arial, formatos y fórmulas (no valores a mano)', async () => {
  const wb = await libro();
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumen por plan', 'Detalle cuotas', 'Notas']);
  const d = wb.getWorksheet('Detalle cuotas'); const r = wb.getWorksheet('Resumen por plan');
  for (const col of [9, 11, 12, 13, 15]) assert.ok(d.getRow(2).getCell(col).value.formula, `Detalle col ${col} debe ser fórmula`);
  for (const t of ['Cuotas totales', 'Cuotas pagas', 'Cuotas impagas', 'Pagas en ejercicio cerrado', 'Capital pagado ejercicio cerrado', 'Interés financiero pagado ejercicio cerrado',
    'Interés resarcitorio pagado ejercicio cerrado', 'Total pagado ejercicio cerrado', 'Total pagado ejercicios anteriores', 'Capital pendiente', 'Financiero pendiente', 'Total deuda']) {
    assert.ok(r.getRow(2).getCell(col(r, t)).value.formula, `Resumen «${t}» debe ser fórmula`);
  }
  assert.match(r.getRow(2).getCell(col(r, 'Capital pagado ejercicio cerrado')).value.formula, /SUMIFS.*Ejercicio cerrado/);
  assert.match(r.getRow(2).getCell(col(r, 'Cuotas totales')).value.formula, /COUNTIF/);
  assert.match(r.getRow(3).getCell(col(r, 'Capital pendiente')).value.formula, /SUM\(/); // fila de totales
  assert.equal(r.getRow(3).getCell(1).value, 'TOTAL');
  assert.equal(d.getRow(2).getCell(4).font.name, 'Arial');
  assert.equal(d.getRow(2).getCell(4).numFmt, '#,##0.00;(#,##0.00)');
  assert.equal(d.getRow(2).getCell(7).numFmt, 'dd/mm/yyyy');
  assert.ok(d.getRow(2).getCell(8).value instanceof Date); // fecha de pago real editada
});

test('los datos de cantidades salen como número, no texto', async () => {
  const d = (await libro()).getWorksheet('Detalle cuotas');
  assert.equal(typeof d.getRow(2).getCell(4).value, 'number'); assert.equal(d.getRow(2).getCell(4).value, 400000);
});

test('diferencia contra el pie: columna Diferencia ≠ 0, Control REVISAR y relleno rojo', async () => {
  const r = (await libro(PIE_MAL)).getWorksheet('Resumen por plan');
  const cd = col(r, 'Diferencia'); const cc = col(r, 'Control');
  assert.equal(r.getRow(2).getCell(cd).value.result, 1500);
  assert.equal(r.getRow(2).getCell(cc).value.result, 'REVISAR');
  assert.ok(r.getRow(2).getCell(cd).fill?.fgColor?.argb);
});

test('recálculo independiente (HyperFormula) = valores guardados', async () => {
  const wb = await libro(PIE_MAL);
  const hojas = {}; const guardados = [];
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow((row, rn) => row.eachCell((cell, cn) => {
      let v = cell.value; (rows[rn - 1] ??= [])[cn - 1] = v;
      if (v && typeof v === 'object' && 'formula' in v) { guardados.push([ws.name, rn - 1, cn - 1, v.result ?? 0]); rows[rn - 1][cn - 1] = '=' + v.formula; }
      else if (v instanceof Date) rows[rn - 1][cn - 1] = Math.round(v.getTime() / 86400000) + 25569;
    }));
    hojas[ws.name] = Array.from(rows, (x) => x || []);
  }
  const hf = HyperFormula.buildFromSheets(hojas, { licenseKey: 'gpl-v3' });
  for (const [s, r, c, esperado] of guardados) {
    const v = hf.getCellValue({ sheet: hf.getSheetId(s), row: r, col: c });
    if (typeof esperado === 'number') assert.ok(Math.abs(v - esperado) < 0.005, `${s} ${r + 1},${c + 1}: ${v} ≠ ${esperado}`);
    else assert.equal(v, esperado, `${s} ${r + 1},${c + 1}`);
  }
});

test('separa lo pagado en el ejercicio cerrado de lo anterior, y la deuda del próximo ejercicio', async () => {
  const r = (await libro()).getWorksheet('Resumen por plan');
  const v = (t) => r.getRow(2).getCell(col(r, t)).value.result;
  assert.equal(v('Pagas en ejercicio cerrado'), 2);
  assert.equal(v('Capital pagado ejercicio cerrado'), 810000);
  assert.equal(v('Interés financiero pagado ejercicio cerrado'), 190000);
  assert.equal(v('Interés resarcitorio pagado ejercicio cerrado'), 62500);
  assert.equal(v('Total pagado ejercicio cerrado'), 1062500);
  assert.equal(v('Capital pendiente'), 850000); assert.equal(v('Financiero pendiente'), 150000); assert.equal(v('Resarcitorio pendiente'), 4000);
  let bloque = ''; r.eachRow((row) => { if (String(row.getCell(1).value).startsWith('Deuda que pasa')) bloque = 'ok'; });
  assert.equal(bloque, 'ok');
});
