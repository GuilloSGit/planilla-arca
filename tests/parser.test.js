import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReporte, consolidar, resumenPlan, totalesPagos, diferenciaConPie, clasificarEjercicio, analizarNombre, leerMontoUsuario, fmtMonto } from '../parser.js';
import { texto, PIE_OK, PIE_MAL, FILAS, ENCABEZADO } from './fixtures/plan-sintetico.js';

const R = (t = texto(), nombre = 'EMPRESA X000001.3.pdf') => parseReporte(t, nombre);
const codigos = (r) => r.alertas.map((a) => a.codigo);

test('encabezado: CUIT, consolidación y plan salen del contenido', () => {
  const r = R();
  assert.equal(r.plan, 'X000001'); assert.equal(r.cuit, '30111111112'); assert.equal(r.consolidacion, '2026-02-13');
});

test('cuotas, capital combinado y fila de pago', () => {
  const r = R();
  assert.equal(r.cuotas.length, 4);
  const [c1, c2, c3, c4] = r.cuotas;
  assert.equal(c1.capital, 40000000); assert.equal(c1.financiero, 10000000);
  assert.ok(c1.pagada && c2.pagada && !c3.pagada && !c4.pagada);
  assert.equal(c1.vencPago, '2026-05-14'); assert.equal(c1.resPagado, 3000000);
  // la cuota 2 tiene 4 filas: la fila de pago es la marcada, no la primera con resarcitorio
  assert.equal(c2.filas.length, 4);
  assert.equal(c2.vencPago, '2026-06-16'); assert.equal(c2.resPagado, 3250000);
});

test('Total pagado = capital + financiero + resarcitorio de la fila de pago', () => {
  const [c1, c2] = R().cuotas;
  assert.equal(c1.totalPagado, 40000000 + 10000000 + 3000000);
  assert.equal(c2.totalPagado, 41000000 + 9000000 + 3250000);
});

test('pie coherente: sin diferencia y sin alertas críticas', () => {
  const r = R();
  assert.deepEqual({ ...r.pie }, { ...r.pie, capital: 81000000, financiero: 19000000, resarcitorio: 6250000, total: 106250000, baja: false, incompleto: false });
  const d = diferenciaConPie(r.cuotas, r.pie);
  assert.deepEqual(d, { capital: 0, financiero: 0, resarcitorio: 0, total: 0 });
  assert.equal(r.alertas.filter((a) => a.nivel === 'critica').length, 0);
});

test('pie que no coincide: alerta crítica con la diferencia, sin corregir en silencio', () => {
  const r = R(texto(PIE_MAL));
  assert.ok(codigos(r).includes('dif-pie'));
  const d = diferenciaConPie(r.cuotas, r.pie);
  assert.equal(d.resarcitorio, 150000);      // suma − pie = 62.500,00 − 61.000,00... en centavos
  assert.equal(d.total, 150000);
  assert.equal(totalesPagos(r.cuotas).total, 106250000); // la suma de cuotas no se toca
});

test('Total ≠ Capital + Financiero + Resarcitorio en una fila: alerta y celda marcada', () => {
  const malas = FILAS.replace('530.000,00 14/05/2026', '530.500,00 14/05/2026');
  const r = R(texto(PIE_OK, malas));
  assert.ok(codigos(r).includes('total-no-cierra'));
  assert.equal(r.cuotas[0].filas[2].revisar.total, true);
  assert.equal(r.cuotas[0].filas[2].errorSuma, 50000);
});

test('cuota impaga: resarcitorio del último vencimiento <= cierre; 0 si no hay', () => {
  const [, , c3, c4] = R().cuotas;
  assert.equal(c3.resPendiente, 400000);   // 26/09/2026 <= 31/10/2026
  assert.equal(c4.resPendiente, 0);        // todos los vencimientos posteriores al cierre
});

test('deuda pendiente = capital + financiero + resarcitorio de impagas', () => {
  const s = resumenPlan(consolidar([{ archivo: 'a.pdf', reporte: R() }])[0]);
  assert.equal(s.pendiente.capital, 42000000 + 43000000);
  assert.equal(s.pendiente.financiero, 8000000 + 7000000);
  assert.equal(s.pendiente.resarcitorio, 400000);
  assert.equal(s.pendiente.total, 85000000 + 15000000 + 400000);
});

test('ejercicio: cerrado / anterior / próximo', () => {
  assert.equal(clasificarEjercicio({ pagada: true, vencPago: '2026-05-14' }), 'Ejercicio cerrado');
  assert.equal(clasificarEjercicio({ pagada: true, vencPago: '2025-10-31' }), 'Ejercicio anterior');
  assert.equal(clasificarEjercicio({ pagada: true, vencPago: '2025-11-01' }), 'Ejercicio cerrado');
  assert.equal(clasificarEjercicio({ pagada: true, vencPago: '2026-10-31' }), 'Ejercicio cerrado');
  assert.equal(clasificarEjercicio({ pagada: false }), 'Próximo ejercicio');
  assert.equal(clasificarEjercicio({ pagada: true, vencPago: null }), 'Revisar');
});

test('capital repetido en todas las filas (otro layout) también se lee bien', () => {
  const rep = `1 400.000,00 100.000,00 0,00 500.000,00 16/03/2026 [o] Cuota Impaga
400.000,00 100.000,00 5.000,00 505.000,00 26/03/2026 [o]
2 410.000,00 90.000,00 0,00 500.000,00 16/04/2026 [o] Cuota Impaga`;
  const r = R(`${ENCABEZADO}\n${rep}\nTotal Pagado: $ 0,00 $ 0,00 $ 0,00 $ 0,00`);
  assert.equal(r.cuotas.length, 2); assert.equal(r.cuotas[0].filas.length, 2);
});

test('OCR: fragmentos separados por un espacio se unen y quedan marcados para revisión', () => {
  const rota = FILAS.replace('505.000,00 26/03/2026', '505. 000,00 26/03/2026');
  const r = R(texto(PIE_OK, rota));
  assert.equal(r.cuotas[0].filas[1].total, 50500000);
  assert.equal(r.cuotas[0].filas[1].revisar.total, true);
});

test('OCR: importe ilegible no se inventa: queda en blanco con alerta crítica', () => {
  const rota = FILAS.replace('30.000,00 530.000,00 14/05/2026', '3O.OOO,OO 5#0.000,00 14/05/2026');
  const r = R(texto(PIE_OK, rota));
  assert.ok(r.alertas.some((a) => a.nivel === 'critica'));
});

test('baja confianza de tesseract marca la celda', () => {
  const lineas = [{ y: 0, text: '', words: [] }];
  const palabras = '1 400.000,00 100.000,00 0,00 500.000,00 16/03/2026 Pago'.split(' ').map((t) => ({ text: t, conf: t === '100.000,00' ? 40 : 95 }));
  const r = parseReporte([{ lines: [...lineas.slice(1), { y: 10, text: palabras.map((w) => w.text).join(' '), words: palabras }] }], 'a.pdf');
  assert.equal(r.cuotas[0].revisar.financiero, true);
  assert.equal(r.cuotas[0].revisar.capital, undefined);
});

test('cuota cancelada sin fila «Pago»: pagada pero con fecha en blanco y alerta', () => {
  const sinPago = FILAS.replace(' 14/05/2026 Pago', ' 14/05/2026 [o]');
  const r = R(texto(PIE_OK, sinPago));
  assert.ok(codigos(r).includes('cancelada-sin-pago'));
  assert.equal(r.cuotas[0].vencPago, null); assert.equal(r.cuotas[0].resPagado, null);
});

test('número de plan: se usa el del contenido y se avisa si no coincide con el nombre', () => {
  const r = R(texto(), 'EMPRESA Z999999.pdf');
  assert.equal(r.plan, 'X000001');
  assert.ok(codigos(r).includes('plan-distinto'));
});

test('versiones: gana el sufijo más alto, duplicados exactos se ignoran, caduco según nombre', () => {
  const a = { archivo: 'E X000001.pdf', reporte: R(texto(), 'E X000001.pdf') };
  const b = { archivo: 'E X000001.2.pdf', reporte: R(texto(PIE_MAL), 'E X000001.2.pdf') };
  const c = { archivo: 'E X000001.3.pdf', reporte: R(texto(), 'E X000001.3.pdf') };
  const d = { archivo: 'E X000001 plan caduco.pdf', reporte: R(texto(), 'E X000001 plan caduco.pdf') };
  const [p] = consolidar([a, b, c, d]);
  assert.equal(p.archivo, 'E X000001.3.pdf'); assert.equal(p.version, 3);
  assert.equal(p.estado, 'Caduco (según archivo)');
  const cod = p.alertas.map((x) => x.codigo);
  assert.ok(cod.includes('varias-versiones')); assert.ok(cod.includes('duplicado'));
});

test('obligaciones sin cuotas: saldo del renglón, siempre a revisar', () => {
  const t = `CUIT: 30111111112
Fh. de Consolidación: 12/08/2025 Número de Plan: X000002
Obligaciones Previsionales
2025 7 Contribuciones Seg. Social Declaración Declaración 12/08/2025 335.004,32 335.004,32
2025 7 Empleador-Aportes Seg. Declaración Declaración 12/08/2025 289.211,38 289.211,38`;
  const r = parseReporte(t, 'E X000002.3.pdf');
  assert.equal(r.tipo, 'obligaciones'); assert.equal(r.saldoObligaciones, 33500432 + 28921138);
  assert.ok(codigos(r).includes('obligaciones-revisar'));
});

test('documento irreconocible: alerta crítica, sin datos inventados', () => {
  const r = parseReporte('hoja en blanco', 'x.pdf');
  assert.equal(r.tipo, 'desconocido'); assert.equal(r.cuotas.length, 0);
  assert.ok(r.alertas.some((a) => a.nivel === 'critica'));
});

test('nombre de archivo', () => {
  assert.deepEqual(analizarNombre('CELLARA   V829520 plan caduco.4.pdf'), { plan: 'V829520', sufijo: 4, caduco: true });
  assert.deepEqual(analizarNombre('CELLARA   U281251..pdf'), { plan: 'U281251', sufijo: 0, caduco: false });
});

test('formato argentino', () => {
  assert.equal(fmtMonto(123456789), '1.234.567,89'); assert.equal(fmtMonto(-5), '-0,05');
  assert.equal(leerMontoUsuario('1.234.567,89'), 123456789); assert.equal(leerMontoUsuario('abc'), null);
});
