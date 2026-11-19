// export.js — arma el .xlsx con ExcelJS (fórmulas reales, Arial, celdas en amarillo para revisión).
// `ExcelJS` se inyecta: en el navegador es el global de /vendor, en Node el paquete.
import { EJERCICIO, resumenPlan, clasificarEjercicio, fmtMonto, fmtFecha } from './parser.js';

const FUENTE = { name: 'Arial', size: 10 };
const NUM = '#,##0.00;(#,##0.00)';
const FECHA = 'dd/mm/yyyy';
const AMARILLO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF200' } };
const ROJO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8C9C9' } };
const CELESTE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } }; // corregido a mano
const GRIS = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };

const dt = (iso) => (iso ? new Date(iso + 'T00:00:00Z') : null);
const n = (c) => (c == null ? null : c / 100);

function encabezado(ws, fila, titulos) {
  const r = ws.getRow(fila);
  titulos.forEach((t, i) => {
    const c = r.getCell(i + 1);
    c.value = t; c.font = { ...FUENTE, bold: true }; c.fill = GRIS;
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    c.border = { bottom: { style: 'thin' } };
  });
  r.height = 42;
}

export async function generarXlsx(ExcelJS, planes) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'planilla-arca'; wb.created = new Date();
  const wsR = wb.addWorksheet('Resumen por plan', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  const wsD = wb.addWorksheet('Detalle cuotas', { views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }] });
  const wsN = wb.addWorksheet('Notas');

  // ---------- Notas: parámetros (las fórmulas de Ejercicio los leen) ----------
  wsN.getCell('A1').value = 'Notas, supuestos y alertas';
  wsN.getCell('A3').value = 'Parámetros del ejercicio';
  wsN.getCell('A4').value = 'Inicio del ejercicio'; wsN.getCell('B4').value = dt(EJERCICIO.desde);
  wsN.getCell('A5').value = 'Cierre del ejercicio'; wsN.getCell('B5').value = dt(EJERCICIO.hasta);
  wsN.getCell('B4').numFmt = FECHA; wsN.getCell('B5').numFmt = FECHA;
  const D0 = EJERCICIO.desde; const D1 = EJERCICIO.hasta;

  // ---------- Detalle cuotas ----------
  const colsD = ['Plan', 'Estado del plan', 'Cuota', 'Capital', 'Interés financiero', 'Estado de la cuota',
    'Fecha vto. con la que se pagó', 'Fecha de pago real', 'Ejercicio', 'Resarcitorio pagado', 'Total pagado',
    'Capital pendiente', 'Financiero pendiente', 'Resarcitorio pendiente', 'Total pendiente'];
  encabezado(wsD, 1, colsD);
  let f = 2;
  const filaDe = new Map();
  for (const p of planes) {
    if (p.tipo !== 'cuotas') continue;
    filaDe.set(p.numero, [f, f + p.cuotas.length - 1]);
    for (const c of p.cuotas) {
      const pag = c.pagada;
      const r = wsD.getRow(f);
      const val = (col, v, fmt) => { const cell = r.getCell(col); cell.value = v; if (fmt) cell.numFmt = fmt; return cell; };
      val(1, p.numero); val(2, p.estado); val(3, c.n);
      val(4, n(c.capital), NUM); val(5, n(c.financiero), NUM);
      val(6, pag ? 'Pagada' : 'Impaga');
      val(7, dt(c.vencPago), FECHA);
      val(8, dt(c.fechaPagoReal), FECHA);
      const ej = clasificarEjercicio(c);
      val(9, { formula: `IF(F${f}="Impaga","Próximo ejercicio",IF(G${f}="","Revisar",IF(G${f}<Notas!$B$4,"Ejercicio anterior",IF(G${f}<=Notas!$B$5,"Ejercicio cerrado","Posterior al ejercicio"))))`, result: ej });
      val(10, pag ? n(c.resPagado) : null, NUM);
      const totPag = pag && c.totalPagado != null ? c.totalPagado / 100 : 0;
      val(11, { formula: `IF(F${f}="Pagada",D${f}+E${f}+J${f},0)`, result: totPag }, NUM);
      const cp = !pag ? (c.capital ?? 0) / 100 : 0; const fp = !pag ? (c.financiero ?? 0) / 100 : 0; const rp = !pag ? (c.resPendiente ?? 0) / 100 : 0;
      val(12, { formula: `IF(F${f}="Impaga",D${f},0)`, result: cp }, NUM);
      val(13, { formula: `IF(F${f}="Impaga",E${f},0)`, result: fp }, NUM);
      val(14, !pag ? n(c.resPendiente ?? 0) : 0, NUM);
      val(15, { formula: `L${f}+M${f}+N${f}`, result: cp + fp + rp }, NUM);
      // celdas en amarillo: baja confianza del OCR o dato ilegible/en blanco
      const rv = c.revisar || {};
      const marcar = (col, cond) => { if (cond) r.getCell(col).fill = AMARILLO; };
      marcar(4, rv.capital || c.capital == null); marcar(5, rv.financiero || c.financiero == null);
      marcar(7, rv.vencPago || (pag && !c.vencPago)); marcar(10, rv.resPagado || (pag && c.resPagado == null));
      marcar(14, rv.resPendiente); marcar(8, false);
      // celeste = corregido a mano (tiene prioridad sobre el amarillo)
      const mn = c.manual || {}; const fm = c.filaPago?.manual || {};
      if (mn.capital) r.getCell(4).fill = CELESTE; if (mn.financiero) r.getCell(5).fill = CELESTE;
      if (fm.venc) r.getCell(7).fill = CELESTE; if (fm.resarcitorio) r.getCell(10).fill = CELESTE;
      if (c.estadoManual !== undefined) r.getCell(6).fill = CELESTE;
      r.eachCell({ includeEmpty: true }, (cell) => { cell.font = FUENTE; });
      f++;
    }
  }
  const ultimaD = Math.max(f - 1, 2);
  [4, 5, 7, 8, 10].forEach((i) => {}); // (formatos ya aplicados por celda)
  wsD.columns.forEach((c, i) => { c.width = [11, 30, 7, 16, 16, 14, 18, 16, 20, 16, 16, 16, 16, 16, 16][i] || 14; });
  // las celdas vacías también en Arial
  for (let rr = 2; rr <= ultimaD; rr++) for (let cc = 1; cc <= 15; cc++) wsD.getRow(rr).getCell(cc).font = FUENTE;
  wsD.autoFilter = { from: 'A1', to: `O${ultimaD}` };

  // ---------- Resumen por plan ----------
  // Columnas definidas por clave; las fórmulas usan la letra que corresponde.
  const defR = [
    ['plan', 'Plan', 11], ['estado', 'Estado del plan', 34], ['cuotas', 'Cuotas totales', 9], ['pagas', 'Cuotas pagas', 9], ['impagas', 'Cuotas impagas', 9],
    ['pagasEj', 'Pagas en ejercicio cerrado (al 31/10/2026)', 14], ['capEj', 'Capital pagado ejercicio cerrado', 16], ['finEj', 'Interés financiero pagado ejercicio cerrado', 16],
    ['resEj', 'Interés resarcitorio pagado ejercicio cerrado', 16], ['totEj', 'Total pagado ejercicio cerrado', 17], ['totAnt', 'Total pagado ejercicios anteriores', 17],
    ['capPag', 'Capital pagado (todos los ejercicios)', 16], ['finPag', 'Financiero pagado (todos)', 16], ['resPag', 'Resarcitorio pagado (todos)', 16], ['totPag', 'Total pagado (suma de cuotas)', 17],
    ['pieCap', 'Pie ARCA: capital', 16], ['pieFin', 'Pie ARCA: interés financiero', 16], ['pieRes', 'Pie ARCA: resarcitorio', 16], ['pieTot', 'Pie ARCA: total pagado', 17],
    ['dif', 'Diferencia (suma − pie)', 15], ['control', 'Control', 14],
    ['capPend', 'Capital pendiente próx. ejercicio', 16], ['finPend', 'Financiero pendiente próx. ejercicio', 16], ['resPend', 'Resarcitorio pendiente (último vto. informado)', 17],
    ['totPend', 'Total deuda próx. ejercicio (cuotas)', 17], ['saldoObl', 'Saldo de obligaciones sin cuotas', 17], ['totGen', 'Total pendiente general', 17], ['alertas', 'Alertas', 36],
  ];
  const colLetra = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const K = {}; defR.forEach(([k], i) => { K[k] = { i: i + 1, L: colLetra(i) }; });
  encabezado(wsR, 1, defR.map((d) => d[1]));
  wsR.columns.forEach((c, i) => { c.width = defR[i][2]; });
  const NCOL = defR.length;
  const rngD = (col) => `'Detalle cuotas'!$${col}:$${col}`;
  const EJC = '"Ejercicio cerrado"'; const EJA = '"Ejercicio anterior"';
  const nums = ['capEj', 'finEj', 'resEj', 'totEj', 'totAnt', 'capPag', 'finPag', 'resPag', 'totPag', 'pieCap', 'pieFin', 'pieRes', 'pieTot', 'dif', 'capPend', 'finPend', 'resPend', 'totPend', 'saldoObl', 'totGen'];
  let g = 2;
  const acum = Object.fromEntries(defR.map(([k]) => [k, 0]));
  const sumif = (colD, A, ...crit) => `SUMIFS(${rngD(colD)},${rngD('A')},${A}${crit.map(([c, v]) => `,${rngD(c)},${v}`).join('')})`;
  for (const p of planes) {
    const s = p.tipo === 'cuotas' ? resumenPlan(p) : null;
    const r = wsR.getRow(g);
    const set = (k, v, fmt) => { const cell = r.getCell(K[k].i); cell.value = v; if (fmt || nums.includes(k)) cell.numFmt = NUM; return cell; };
    const A = `$A${g}`;
    set('plan', p.numero); set('estado', p.tipo === 'cuotas' ? p.estado : `${p.estado} — obligaciones sin cuotas`);
    if (s) {
      // por ejercicio (según la columna Ejercicio de Detalle, que sale de la fecha de vencimiento con la que se pagó)
      const porEj = { ec: { n: 0, cap: 0, fin: 0, res: 0, tot: 0 }, ea: 0 };
      for (const c of p.cuotas) {
        if (!c.pagada) continue;
        const ej = clasificarEjercicio(c);
        if (ej === 'Ejercicio cerrado') { porEj.ec.n++; porEj.ec.cap += c.capital ?? 0; porEj.ec.fin += c.financiero ?? 0; porEj.ec.res += c.resPagado ?? 0; porEj.ec.tot += c.totalPagado ?? 0; }
        else if (ej === 'Ejercicio anterior') porEj.ea += c.totalPagado ?? 0;
      }
      set('cuotas', { formula: `COUNTIF(${rngD('A')},${A})`, result: s.cuotas });
      set('pagas', { formula: `COUNTIFS(${rngD('A')},${A},${rngD('F')},"Pagada")`, result: s.pagas });
      set('impagas', { formula: `COUNTIFS(${rngD('A')},${A},${rngD('F')},"Impaga")`, result: s.impagas });
      set('pagasEj', { formula: `COUNTIFS(${rngD('A')},${A},${rngD('I')},${EJC})`, result: porEj.ec.n });
      set('capEj', { formula: sumif('D', A, ['I', EJC]), result: porEj.ec.cap / 100 });
      set('finEj', { formula: sumif('E', A, ['I', EJC]), result: porEj.ec.fin / 100 });
      set('resEj', { formula: sumif('J', A, ['I', EJC]), result: porEj.ec.res / 100 });
      set('totEj', { formula: sumif('K', A, ['I', EJC]), result: porEj.ec.tot / 100 });
      set('totAnt', { formula: sumif('K', A, ['I', EJA]), result: porEj.ea / 100 });
      set('capPag', { formula: sumif('D', A, ['F', '"Pagada"']), result: s.pagado.capital / 100 });
      set('finPag', { formula: sumif('E', A, ['F', '"Pagada"']), result: s.pagado.financiero / 100 });
      set('resPag', { formula: sumif('J', A, ['F', '"Pagada"']), result: s.pagado.resarcitorio / 100 });
      set('totPag', { formula: sumif('K', A), result: s.pagado.total / 100 });
      const pie = p.pie && !p.pie.incompleto ? p.pie : null;
      if (p.pie) {
        set('pieCap', n(p.pie.capital)); set('pieFin', n(p.pie.financiero)); set('pieRes', n(p.pie.resarcitorio)); set('pieTot', n(p.pie.total));
        for (const [k, kk] of [['pieCap', 'capital'], ['pieFin', 'financiero'], ['pieRes', 'resarcitorio'], ['pieTot', 'total']]) {
          if (p.pie.manual?.[kk]) r.getCell(K[k].i).fill = CELESTE; else if (p.pie.revisar?.[kk] ?? p.pie.baja) r.getCell(K[k].i).fill = AMARILLO;
        }
      }
      if (pie) {
        const d = s.diferencia; const ok = !d.capital && !d.financiero && !d.resarcitorio && !d.total;
        set('dif', { formula: `IF(${K.pieTot.L}${g}="","",${K.totPag.L}${g}-${K.pieTot.L}${g})`, result: d.total / 100 });
        set('control', { formula: `IF(${K.pieTot.L}${g}="","Sin pie",IF(AND(ROUND(${K.capPag.L}${g}-${K.pieCap.L}${g},2)=0,ROUND(${K.finPag.L}${g}-${K.pieFin.L}${g},2)=0,ROUND(${K.resPag.L}${g}-${K.pieRes.L}${g},2)=0,ROUND(${K.totPag.L}${g}-${K.pieTot.L}${g},2)=0),"OK","REVISAR"))`, result: ok ? 'OK' : 'REVISAR' });
        if (!ok) { r.getCell(K.dif.i).fill = ROJO; r.getCell(K.control.i).fill = ROJO; }
        acum.dif += d.total;
      } else { set('control', 'Sin pie legible'); r.getCell(K.control.i).fill = AMARILLO; }
      set('capPend', { formula: sumif('L', A), result: s.pendiente.capital / 100 });
      set('finPend', { formula: sumif('M', A), result: s.pendiente.financiero / 100 });
      set('resPend', { formula: sumif('N', A), result: s.pendiente.resarcitorio / 100 });
      set('totPend', { formula: sumif('O', A), result: s.pendiente.total / 100 });
      set('saldoObl', 0);
      set('totGen', { formula: `${K.totPend.L}${g}+${K.saldoObl.L}${g}`, result: s.pendiente.total / 100 });
      Object.assign(acum, {
        cuotas: acum.cuotas + s.cuotas, pagas: acum.pagas + s.pagas, impagas: acum.impagas + s.impagas, pagasEj: acum.pagasEj + porEj.ec.n,
        capEj: acum.capEj + porEj.ec.cap, finEj: acum.finEj + porEj.ec.fin, resEj: acum.resEj + porEj.ec.res, totEj: acum.totEj + porEj.ec.tot, totAnt: acum.totAnt + porEj.ea,
        capPag: acum.capPag + s.pagado.capital, finPag: acum.finPag + s.pagado.financiero, resPag: acum.resPag + s.pagado.resarcitorio, totPag: acum.totPag + s.pagado.total,
        capPend: acum.capPend + s.pendiente.capital, finPend: acum.finPend + s.pendiente.financiero, resPend: acum.resPend + s.pendiente.resarcitorio,
        totPend: acum.totPend + s.pendiente.total, totGen: acum.totGen + s.pendiente.total,
      });
      if (pie) for (const [k, v] of [['pieCap', p.pie.capital], ['pieFin', p.pie.financiero], ['pieRes', p.pie.resarcitorio], ['pieTot', p.pie.total]]) acum[k] += v;
    } else {
      set('control', 'Obligación sin cuotas');
      set('totPend', 0);
      set('saldoObl', n(p.saldoObligaciones)); r.getCell(K.saldoObl.i).fill = AMARILLO; // siempre a verificar a mano
      set('totGen', { formula: `${K.totPend.L}${g}+${K.saldoObl.L}${g}`, result: (p.saldoObligaciones ?? 0) / 100 });
      acum.saldoObl += p.saldoObligaciones ?? 0; acum.totGen += p.saldoObligaciones ?? 0;
    }
    const crit = p.alertas.filter((a) => a.nivel === 'critica').length; const av = p.alertas.filter((a) => a.nivel === 'aviso').length;
    set('alertas', crit || av ? `${crit} crítica(s), ${av} aviso(s) — ver hoja Notas` : '');
    for (let cc = 1; cc <= NCOL; cc++) r.getCell(cc).font = FUENTE;
    g++;
  }
  const ultimaR = g - 1;
  const rt = wsR.getRow(g);
  rt.getCell(1).value = 'TOTAL';
  const filaTotal = g;
  for (const k of ['cuotas', 'pagas', 'impagas', 'pagasEj', ...nums.filter((x) => x !== 'dif' || true)]) {
    if (!K[k]) continue;
    const cell = rt.getCell(K[k].i);
    const res = ['cuotas', 'pagas', 'impagas', 'pagasEj'].includes(k) ? acum[k] : acum[k] / 100;
    cell.value = { formula: `SUM(${K[k].L}2:${K[k].L}${Math.max(ultimaR, 2)})`, result: res };
    if (!['cuotas', 'pagas', 'impagas', 'pagasEj'].includes(k)) cell.numFmt = NUM;
  }
  for (let cc = 1; cc <= NCOL; cc++) { const c = rt.getCell(cc); c.font = { ...FUENTE, bold: true }; c.border = { top: { style: 'thin' } }; }
  wsR.addConditionalFormatting({
    ref: `${K.dif.L}2:${K.dif.L}${g}`,
    rules: [{ type: 'expression', formulae: [`AND(ISNUMBER(${K.dif.L}2),ROUND(${K.dif.L}2,2)<>0)`], style: { font: { color: { argb: 'FFC00000' }, bold: true } } }],
  });
  // bloque: deuda que pasa al próximo ejercicio
  let b = filaTotal + 2;
  wsR.getCell(b, 1).value = `Deuda que pasa al próximo ejercicio (01/11/2026)`; wsR.getCell(b, 1).font = { ...FUENTE, bold: true }; b++;
  for (const [txt, k, res] of [
    ['Capital pendiente', 'capPend', acum.capPend], ['Interés financiero pendiente', 'finPend', acum.finPend],
    ['Resarcitorio devengado (último vto. informado)', 'resPend', acum.resPend], ['Total deuda de las cuotas', 'totPend', acum.totPend],
    ['Saldo de obligaciones sin cuotas (a verificar)', 'saldoObl', acum.saldoObl], ['Total pendiente general', 'totGen', acum.totGen],
  ]) {
    wsR.getCell(b, 1).value = txt; wsR.getCell(b, 1).font = FUENTE;
    const c = wsR.getCell(b, 3); c.value = { formula: `${K[k].L}${filaTotal}`, result: res / 100 }; c.numFmt = NUM; c.font = FUENTE;
    b++;
  }
  wsR.getCell(b, 1).value = 'El resarcitorio sigue devengándose: al 31/10/2026 puede ser mayor que el último informado en ARCA. Confirmarlo en ARCA.';
  wsR.getCell(b, 1).font = { ...FUENTE, italic: true };

  // ---------- Notas ----------
  let k = 7;
  const nota = (a, b, c, fuente) => { wsN.getCell(k, 1).value = a; if (b !== undefined) wsN.getCell(k, 2).value = b; if (c !== undefined) wsN.getCell(k, 3).value = c; if (fuente) for (let i = 1; i <= 3; i++) wsN.getCell(k, i).font = fuente; k++; };
  wsN.getCell('A1').font = { ...FUENTE, size: 14, bold: true };
  wsN.getCell('A3').font = { ...FUENTE, bold: true };
  nota('Supuestos', undefined, undefined, { ...FUENTE, bold: true });
  for (const t of [
    'Los datos salen de un OCR sobre los PDF de ARCA: todo número debe contrastarse con el PDF. Las celdas amarillas son las que el OCR leyó con baja confianza o no pudo leer. Las celestes fueron corregidas a mano (ver abajo).',
    'Cuota paga: tiene una fila con «Pago» o figura como «Cuota Cancelada». «Fecha vto. con la que se pagó» es el vencimiento aplicado al pago, NO la fecha real de pago.',
    'Resarcitorio pagado: el de la fila marcada «Pago». Total pagado = Capital + Interés financiero + Resarcitorio pagado.',
    'Cuota impaga: Capital + Financiero + resarcitorio del último vencimiento con fecha ≤ cierre del ejercicio que figure para esa cuota (0 si no hay ninguno).',
    'Ejercicio: pagos con vencimiento dentro del rango de los parámetros (B4:B5) = «Ejercicio cerrado»; anteriores = «Ejercicio anterior»; impagas = «Próximo ejercicio».',
    'Si hay varias versiones de un plan se usa la de sufijo más alto (.3 > .2 > sin sufijo). Los duplicados exactos se ignoran. Siempre se usa el número de plan que figura dentro del archivo.',
    'Los planes «caduco» lo son según el nombre del archivo; el PDF no lo informa.',
    'Obligaciones sin cuotas: el saldo es la suma del último importe de cada renglón con fecha de vencimiento. Verificar a mano.',
    'La columna «Diferencia» compara la suma de las cuotas pagas con el pie «Total Pagado» del reporte. No se corrige en silencio: si no es cero, es un hallazgo.',
  ]) nota(t, undefined, undefined, FUENTE);
  k++;
  nota('Alertas por plan', undefined, undefined, { ...FUENTE, bold: true });
  nota('Plan', 'Nivel', 'Detalle', { ...FUENTE, bold: true });
  for (const p of planes) for (const a of p.alertas) {
    nota(p.numero, a.nivel === 'critica' ? 'CRÍTICA' : 'Aviso', a.texto, FUENTE);
    if (a.nivel === 'critica') wsN.getCell(k - 1, 2).fill = ROJO;
  }
  const conCorr = planes.filter((p) => p.correcciones?.length);
  if (conCorr.length) {
    k++;
    nota('Correcciones manuales (estos valores NO vienen del PDF: celdas celestes)', undefined, undefined, { ...FUENTE, bold: true });
    nota('Plan', '', 'Dato: valor leído por el OCR → valor corregido', { ...FUENTE, bold: true });
    for (const p of conCorr) for (const x of p.correcciones) nota(p.numero, '', `${x.etiqueta}: ${x.textoOriginal} → ${x.textoActual}`, FUENTE);
  }
  wsN.getColumn(1).width = 28; wsN.getColumn(2).width = 14; wsN.getColumn(3).width = 120;
  for (const c of ['A4', 'A5', 'B4', 'B5']) wsN.getCell(c).font = FUENTE;
  for (let rr = 7; rr < k; rr++) for (let cc = 1; cc <= 3; cc++) { const cell = wsN.getCell(rr, cc); if (!cell.font || cell.font.name !== 'Arial') cell.font = FUENTE; }

  return wb.xlsx.writeBuffer();
}
