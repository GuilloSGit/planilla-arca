import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseReporte, consolidar, corregirCampo, resumenPlan, diferenciaConPie, leerMontoUsuario } from '../parser.js';
import { generarXlsx } from '../export.js';
import { texto, PIE_OK, PIE_MAL, FILAS } from './fixtures/plan-sintetico.js';

const plan = (t = texto()) => consolidar([{ archivo: 'E X000001.3.pdf', reporte: parseReporte(t, 'E X000001.3.pdf') }])[0];
const crit = (p) => p.alertas.filter((a) => a.nivel === 'critica').map((a) => a.codigo);

test('corregir un total mal leído: la alerta desaparece, queda marcado a mano y registrado con el valor original', () => {
  const p = plan(texto(PIE_OK, FILAS.replace('530.000,00 14/05/2026', '530.500,00 14/05/2026')));
  assert.ok(crit(p).includes('total-no-cierra'));
  corregirCampo(p, { cuota: 1, fila: 2, campo: 'total', valor: 53000000 });
  assert.ok(!crit(p).includes('total-no-cierra'));
  assert.equal(p.cuotas[0].filas[2].manual.total, true);
  assert.equal(p.cuotas[0].filas[2].revisar.total, false);
  assert.equal(p.correcciones.length, 1);
  assert.equal(p.correcciones[0].original, 53050000); assert.equal(p.correcciones[0].actual, 53000000);
});

test('NO se oculta una inconsistencia: un valor que no cierra mantiene la alerta', () => {
  const p = plan();
  corregirCampo(p, { cuota: 1, fila: 2, campo: 'total', valor: 99999900 });
  assert.ok(crit(p).includes('total-no-cierra'));
  assert.ok(crit(p).includes('dif-pie') === false); // el pie compara resarcitorio pagado, no el total de la fila
  assert.equal(p.cuotas[0].filas[2].revisar.total, true);
});

test('corregir el pie mal leído elimina la diferencia contra el pie', () => {
  const p = plan(texto(PIE_MAL));
  assert.ok(crit(p).includes('dif-pie'));
  corregirCampo(p, { campo: 'pie:resarcitorio', valor: 6250000 });
  corregirCampo(p, { campo: 'pie:total', valor: 106250000 });
  assert.ok(!crit(p).includes('dif-pie')); assert.ok(!crit(p).includes('pie-no-cierra'));
  assert.deepEqual(diferenciaConPie(p.cuotas, p.pie), { capital: 0, financiero: 0, resarcitorio: 0, total: 0 });
});

test('pie corregido que no cierra consigo mismo: alerta pie-no-cierra', () => {
  const p = plan();
  corregirCampo(p, { campo: 'pie:total', valor: 1 });
  assert.ok(crit(p).includes('pie-no-cierra'));
});

test('capital ilegible: se completa a mano y se recalcula todo', () => {
  const t = texto(PIE_OK, FILAS.replace('3 420.000,00 80.000,00', '3 4#0.000,00 80.000,00'));
  const p = plan(t);
  assert.ok(crit(p).includes('sin-capital'));
  assert.equal(p.cuotas[2].capital, null);
  corregirCampo(p, { cuota: 3, campo: 'capital', valor: 42000000 });
  assert.equal(p.cuotas[2].capital, 42000000); assert.equal(p.cuotas[2].manual.capital, true);
  assert.ok(!crit(p).includes('sin-capital'));
  assert.equal(resumenPlan(p).pendiente.capital, 42000000 + 43000000);
});

test('cuota cancelada sin fila «Pago»: marcar la fila corrige el estado de pago', () => {
  const p = plan(texto(PIE_OK, FILAS.replace(' 14/05/2026 Pago', ' 14/05/2026 [o]')));
  assert.ok(crit(p).includes('cancelada-sin-pago'));
  corregirCampo(p, { cuota: 1, fila: 2, campo: 'pago', valor: true });
  assert.ok(!crit(p).includes('cancelada-sin-pago'));
  assert.equal(p.cuotas[0].vencPago, '2026-05-14'); assert.equal(p.cuotas[0].resPagado, 3000000);
  assert.equal(crit(p).length, 0);
});

test('marcar «Pago» en otra fila desmarca la anterior (una sola fila de pago)', () => {
  const p = plan();
  corregirCampo(p, { cuota: 2, fila: 1, campo: 'pago', valor: true });
  assert.equal(p.cuotas[1].filas.filter((f) => f.pago).length, 1);
  assert.equal(p.cuotas[1].filas[1].pago, true);
});

test('estado manual y restaurar lo leído', () => {
  const p = plan();
  corregirCampo(p, { cuota: 3, campo: 'estado', valor: 'Cuota Cancelada' });
  assert.equal(p.cuotas[2].pagada, true);
  assert.ok(crit(p).includes('cancelada-sin-pago'));
  corregirCampo(p, { cuota: 3, campo: 'estado', valor: null });
  assert.equal(p.cuotas[2].pagada, false); assert.equal(p.correcciones.length, 0);
  assert.ok(!crit(p).includes('cancelada-sin-pago'));
});

test('restaurar el valor original quita la corrección del registro', () => {
  const p = plan();
  corregirCampo(p, { cuota: 1, fila: 2, campo: 'resarcitorio', valor: 3100000 });
  assert.equal(p.correcciones.length, 1);
  corregirCampo(p, { cuota: 1, fila: 2, campo: 'resarcitorio', valor: 3000000 });
  assert.equal(p.correcciones.length, 0);
});

test('las correcciones sobreviven a un nuevo consolidar (por ej. al cargar más PDF o desde IndexedDB)', () => {
  const reporte = parseReporte(texto(PIE_MAL), 'E X000001.3.pdf');
  let p = consolidar([{ archivo: 'E X000001.3.pdf', reporte }])[0];
  corregirCampo(p, { campo: 'pie:resarcitorio', valor: 6250000 }); corregirCampo(p, { campo: 'pie:total', valor: 106250000 });
  const guardado = JSON.parse(JSON.stringify([{ archivo: 'E X000001.3.pdf', reporte }]));   // lo que haría IndexedDB
  p = consolidar(guardado)[0];
  assert.equal(p.correcciones.length, 2); assert.ok(!crit(p).includes('dif-pie'));
});

test('importes escritos a mano: formato argentino y rechazo de basura', () => {
  assert.equal(leerMontoUsuario('1.234,56'), 123456); assert.equal(leerMontoUsuario('0,5'), 50); assert.equal(leerMontoUsuario('12a'), null);
});

test('export: celdas corregidas en celeste y sección «Correcciones manuales» en Notas', async () => {
  const p = plan(texto(PIE_MAL));
  corregirCampo(p, { cuota: 1, fila: 2, campo: 'resarcitorio', valor: 3000000 });
  corregirCampo(p, { campo: 'pie:resarcitorio', valor: 6250000 });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await generarXlsx(ExcelJS, [p]));
  const d = wb.getWorksheet('Detalle cuotas');
  assert.equal(d.getRow(2).getCell(10).fill.fgColor.argb, 'FFBDD7EE');
  let notas = ''; wb.getWorksheet('Notas').eachRow((r) => { notas += r.values.join(' | ') + '\n'; });
  assert.match(notas, /Correcciones manuales/); assert.match(notas, /Pie: resarcitorio/);
});
