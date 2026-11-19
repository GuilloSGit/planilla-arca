// app.js — interfaz: carga de archivos, OCR en el navegador, revisión y exportación.
import { ocrPagina } from './ocr.js';
import { parseReporte, consolidar, resumenPlan, fmtMonto, fmtFecha, clasificarEjercicio, corregirCampo, leerMontoUsuario } from './parser.js';
import { generarXlsx } from './export.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let items = [];   // [{archivo, reporte}]
let planes = [];  // consolidado
let seleccionado = null;
let procesando = false;

const abs = (p) => new URL(p, document.baseURI).href;

// ---------- carga ----------
const zona = $('#zona'); const entrada = $('#entrada');
zona.addEventListener('click', () => entrada.click());
zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.click(); } });
entrada.addEventListener('change', () => { if (entrada.files.length) procesar([...entrada.files]); entrada.value = ''; });
['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('sobre'); }));
['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('sobre'); }));
zona.addEventListener('drop', (e) => { const fs = [...e.dataTransfer.files]; if (fs.length) procesar(fs); });

async function expandir(archivos) {
  const pdfs = [];
  for (const f of archivos) {
    if (/\.zip$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      for (const [ruta, e] of Object.entries(zip.files)) {
        if (e.dir || !/\.pdf$/i.test(ruta) || /(^|\/)__MACOSX\//.test(ruta) || /(^|\/)\._/.test(ruta)) continue;
        pdfs.push({ nombre: ruta.split('/').pop(), leer: () => e.async('arraybuffer') });
      }
    } else if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      pdfs.push({ nombre: f.name, leer: () => f.arrayBuffer() });
    }
  }
  return pdfs;
}

const env0 = {
  createCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
  getPixels: (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data,
  toImage: (c) => c,
};

async function procesar(archivos) {
  if (procesando) return;
  procesando = true;
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = abs('vendor/pdf.worker.min.js');
    const pdfs = await expandir(archivos);
    if (!pdfs.length) { alert('No encontré PDF en lo que arrastraste.'); return; }
    $('#progreso').hidden = false;
    const lista = $('#lista-archivos'); lista.innerHTML = '';
    const lis = pdfs.map((p) => { const li = document.createElement('li'); li.innerHTML = `<span class="est">en cola</span><span>${esc(p.nombre)}</span>`; lista.appendChild(li); return li; });
    let hechos = 0;
    const actualizar = (msg) => { $('#barra-int').style.width = `${(hechos / pdfs.length) * 100}%`; $('#progreso-txt').textContent = msg ?? `${hechos} de ${pdfs.length} archivos`; };
    actualizar('Iniciando el motor de OCR…');

    const nW = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    let idx = 0;
    const nuevos = [];
    const trabajador = async () => {
      const worker = await Tesseract.createWorker('spa', 1, {
        workerPath: abs('vendor/tesseract-worker.min.js'),
        corePath: abs('vendor/'),
        langPath: abs('vendor'),
        gzip: true,
        cacheMethod: 'none', // no guardar nada en el navegador sin que el usuario lo pida
      });
      const env = { ...env0, worker };
      while (idx < pdfs.length) {
        const i = idx++; const p = pdfs[i]; const li = lis[i];
        li.firstChild.textContent = 'leyendo…';
        try {
          const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await p.leer()) }).promise;
          const paginas = []; let hint = 0;
          for (let n = 1; n <= doc.numPages; n++) {
            li.firstChild.textContent = `pág. ${n}/${doc.numPages}`;
            const r = await ocrPagina(await doc.getPage(n), env, { hint });
            hint = r.rotacion; paginas.push(r);
          }
          nuevos.push({ archivo: p.nombre, reporte: parseReporte(paginas, p.nombre) });
          li.className = 'ok'; li.firstChild.textContent = 'listo';
        } catch (err) {
          console.error(err);
          const rep = parseReporte('', p.nombre);
          rep.alertas.length = 0;
          rep.alertas.push({ nivel: 'critica', codigo: 'error-lectura', texto: `No se pudo procesar el archivo: ${err.message || err}` });
          nuevos.push({ archivo: p.nombre, reporte: rep });
          li.className = 'err'; li.firstChild.textContent = 'error';
        }
        hechos++; actualizar();
      }
      await worker.terminate();
    };
    await Promise.all(Array.from({ length: nW }, trabajador));
    items = items.concat(nuevos);
    planes = consolidar(items);
    $('#progreso-txt').textContent = `Listo: ${pdfs.length} archivo(s) procesados.`;
    dibujar();
  } catch (err) {
    console.error(err); alert('Ocurrió un error: ' + (err.message || err));
  } finally { procesando = false; }
}

// ---------- revisión ----------
const dif0 = (d) => d && (d.capital || d.financiero || d.resarcitorio || d.total);

function dibujar() {
  $('#revision').hidden = !planes.length;
  $('#btn-exportar').disabled = !planes.length;
  if (!planes.length) return;
  const soloCrit = $('#solo-criticas').checked;
  const tb = $('#tabla-planes tbody'); tb.innerHTML = '';
  let nCrit = 0;
  for (const p of planes) {
    const s = p.tipo === 'cuotas' ? resumenPlan(p) : null;
    const crit = p.alertas.filter((a) => a.nivel === 'critica').length;
    const av = p.alertas.filter((a) => a.nivel === 'aviso').length;
    if (crit) nCrit++;
    if (soloCrit && !crit) continue;
    const tr = document.createElement('tr');
    tr.className = 'plan' + (p.numero === seleccionado ? ' sel' : '');
    const d = s?.diferencia;
    tr.innerHTML = `<td><b>${esc(p.numero)}</b></td><td>${esc(p.tipo === 'cuotas' ? p.estado : p.estado + ' · obligaciones sin cuotas')}</td>
      <td class="n">${s ? s.cuotas : '—'}</td><td class="n">${s ? s.pagas : '—'}</td><td class="n">${s ? s.impagas : '—'}</td>
      <td class="n">${s ? fmtMonto(s.pagado.total) : '—'}</td><td class="n">${p.pie && p.pie.total != null ? fmtMonto(p.pie.total) : '—'}</td>
      <td class="n ${dif0(d) ? 'rojo' : ''}">${d ? fmtMonto(d.total) : '—'}</td>
      <td class="n">${s ? fmtMonto(s.pendiente.total) : p.saldoObligaciones != null ? fmtMonto(p.saldoObligaciones) : '—'}</td>
      <td>${crit ? `<span class="bad crit">${crit} crítica${crit > 1 ? 's' : ''}</span>` : ''}${av ? `<span class="bad av">${av} aviso${av > 1 ? 's' : ''}</span>` : ''}${!crit && !av ? '<span class="bad ok">sin alertas</span>' : ''}</td>`;
    tr.addEventListener('click', () => { seleccionado = p.numero; dibujar(); });
    tb.appendChild(tr);
  }
  $('#resumen-global').textContent = `${planes.length} planes · ${nCrit} con alertas críticas`;
  $('#btn-exportar').textContent = nCrit ? `Exportar Excel (${nCrit} plan(es) con alertas críticas)` : 'Exportar Excel';
  dibujarDetalle();
}

// Celda con importe editable. rev = dudoso del OCR (amarillo); man = corregido a mano (celeste).
function celdaMonto(valor, { rev, man, campo, cuota, fila, solo }) {
  const cls = `n${man ? ' man' : rev ? ' rev' : ''}`;
  if (solo) return `<td class="${cls}">${valor == null ? '?' : fmtMonto(valor)}</td>`;
  return `<td class="${cls}"><input class="ed" type="text" inputmode="decimal" placeholder="?" value="${valor == null ? '' : esc(fmtMonto(valor))}"
    data-campo="${campo}" ${cuota != null ? `data-cuota="${cuota}"` : ''} ${fila != null ? `data-fila="${fila}"` : ''} aria-label="${esc(campo)}"></td>`;
}
const cel = (valor, rev) => `<td class="n${rev ? ' rev' : ''}">${valor}</td>`;

function dibujarDetalle() {
  const cont = $('#detalle');
  const p = planes.find((x) => x.numero === seleccionado);
  if (!p) { cont.hidden = true; return; }
  cont.hidden = false;
  const alertas = p.alertas.map((a) => `<li class="${a.nivel === 'critica' ? 'crit' : ''}"><b>${a.nivel === 'critica' ? 'Crítica' : 'Aviso'}:</b> ${esc(a.texto)}</li>`).join('');
  let html = `<h3>Plan ${esc(p.numero)} — ${esc(p.estado)}</h3>
    <p class="meta">Archivo usado: ${esc(p.archivo)} · CUIT ${esc(p.cuit || '?')} · Consolidación ${esc(fmtFecha(p.consolidacion) || '?')} · Archivos del plan: ${p.archivos.length}</p>
    ${alertas ? `<ul class="alertas">${alertas}</ul>` : ''}`;
  if (p.tipo !== 'cuotas') {
    html += `<p>Documento sin cuotas. Saldo estimado: <b>${p.saldoObligaciones != null ? fmtMonto(p.saldoObligaciones) : 'no determinado'}</b> (verificar contra el PDF).</p>`;
    cont.innerHTML = html; return;
  }
  const s = resumenPlan(p);
  const pie = p.pie || { revisar: { capital: true, financiero: true, resarcitorio: true, total: true }, manual: {} };
  const d = s.diferencia;
  html += `<p class="nota">Podés escribir en las celdas para corregir lo que leyó el OCR (formato 1.234,56). <span class="bad av">amarillo</span> = dudoso del OCR, <span class="bad man">celeste</span> = corregido a mano. Las alertas se recalculan y <b>no</b> se ocultan si lo que escribís no cierra.</p>
    <div class="tabla-scroll"><table class="tabla"><thead><tr><th></th><th class="n">Capital</th><th class="n">Financiero</th><th class="n">Resarcitorio</th><th class="n">Total</th></tr></thead><tbody>
    <tr><td>Suma de cuotas pagas</td><td class="n">${fmtMonto(s.pagado.capital)}</td><td class="n">${fmtMonto(s.pagado.financiero)}</td><td class="n">${fmtMonto(s.pagado.resarcitorio)}</td><td class="n">${fmtMonto(s.pagado.total)}</td></tr>
    <tr><td>Pie del reporte</td>${['capital', 'financiero', 'resarcitorio', 'total'].map((k) => celdaMonto(p.pie ? p.pie[k] : null, { rev: pie.revisar?.[k], man: pie.manual?.[k], campo: `pie:${k}` })).join('')}</tr>
    <tr><td>Diferencia</td>${d ? ['capital', 'financiero', 'resarcitorio', 'total'].map((k) => `<td class="n ${d[k] ? 'rojo' : ''}">${fmtMonto(d[k])}</td>`).join('') : '<td colspan="4">no calculable (falta leer el pie)</td>'}</tr></tbody></table></div>`;
  html += `<div class="tabla-scroll"><table class="tabla"><thead><tr><th>Cuota / vencimiento</th><th class="n">Capital</th><th class="n">Financiero</th><th class="n">Resarcitorio</th><th class="n">Total</th><th>Estado</th><th>Ejercicio</th><th>Fecha de pago real</th></tr></thead><tbody>`;
  for (const c of p.cuotas) {
    const rv = c.revisar || {}; const mn = c.manual || {};
    const estSel = c.estadoManual === undefined ? '' : c.estadoManual;
    html += `<tr class="cuota"><td>Cuota ${c.n}${c.numeroInferido ? ' (nº inferido)' : ''}</td>
      ${celdaMonto(c.capital, { rev: rv.capital, man: mn.capital, campo: 'capital', cuota: c.n })}${celdaMonto(c.financiero, { rev: rv.financiero, man: mn.financiero, campo: 'financiero', cuota: c.n })}
      <td></td><td></td>
      <td>${c.pagada ? 'Pagada' : 'Impaga'}<br><select class="ed${c.estadoManual !== undefined ? ' man' : ''}" data-campo="estado" data-cuota="${c.n}" aria-label="Estado de la cuota ${c.n}">
        <option value="" ${estSel === '' ? 'selected' : ''}>según lectura${c.estadoManual === undefined && c.estadoTxt ? ` (${esc(c.estadoTxt)})` : ''}</option>
        <option value="Cuota Cancelada" ${estSel === 'Cuota Cancelada' ? 'selected' : ''}>Cuota Cancelada</option>
        <option value="Cuota Impaga" ${estSel === 'Cuota Impaga' ? 'selected' : ''}>Cuota Impaga</option></select></td>
      <td>${esc(clasificarEjercicio(c))}</td>
      <td>${c.pagada ? `<input type="date" data-fpr="1" data-plan="${esc(p.numero)}" data-cuota="${c.n}" value="${esc(c.fechaPagoReal || '')}" aria-label="Fecha real de pago cuota ${c.n}">` : ''}</td></tr>`;
    c.filas.forEach((f, i) => {
      const fm = f.manual || {};
      html += `<tr class="fila${f.pago ? ' pago' : ''}"><td><input class="ed${fm.venc ? ' man' : f.revisar.venc ? ' rev' : ''}" type="date" data-campo="venc" data-cuota="${c.n}" data-fila="${i}" value="${esc(f.venc || '')}" aria-label="Vencimiento">
        <label class="chk"><input type="checkbox" data-campo="pago" data-cuota="${c.n}" data-fila="${i}" ${f.pago ? 'checked' : ''}> <b>Pago</b></label></td>
        ${cel(fmtMonto(f.capital), f.revisar.capital)}${cel(fmtMonto(f.financiero), f.revisar.financiero)}
        ${celdaMonto(f.resarcitorio, { rev: f.revisar.resarcitorio, man: fm.resarcitorio, campo: 'resarcitorio', cuota: c.n, fila: i })}
        ${celdaMonto(f.total, { rev: f.revisar.total, man: fm.total, campo: 'total', cuota: c.n, fila: i }).replace('class="n', `class="n${f.errorSuma ? ' rojo' : ''}`)}
        <td colspan="3"></td></tr>`;
    });
  }
  html += '</tbody></table></div>';
  if (p.correcciones?.length) {
    html += `<h3>Correcciones manuales (${p.correcciones.length})</h3><ul class="alertas corr">${p.correcciones.map((x, i) =>
      `<li><b>${esc(x.etiqueta)}</b>: ${esc(x.textoOriginal)} → <b>${esc(x.textoActual)}</b> ${x.campo === 'pago' ? '' : `<button data-restaurar="${i}" type="button">Restaurar lo leído</button>`}</li>`).join('')}</ul>`;
  }
  cont.innerHTML = html;
  cont.querySelectorAll('input[data-fpr]').forEach((inp) => inp.addEventListener('change', () => {
    const pl = planes.find((x) => x.numero === inp.dataset.plan);
    const c = pl.cuotas.find((x) => x.n === Number(inp.dataset.cuota));
    c.fechaPagoReal = inp.value || null;
  }));
}

// Edición a mano: un solo listener para todas las celdas editables del detalle.
$('#detalle').addEventListener('change', (e) => {
  const t = e.target; const campo = t.dataset?.campo;
  if (!campo) return;
  const p = planes.find((x) => x.numero === seleccionado); if (!p) return;
  let valor;
  if (t.type === 'checkbox') valor = t.checked;
  else if (campo === 'venc') valor = t.value || null;
  else if (campo === 'estado') valor = t.value || null;
  else {
    const txt = t.value.trim();
    if (txt === '') valor = null;
    else {
      valor = leerMontoUsuario(txt);
      if (valor == null) { t.classList.add('invalido'); t.title = 'Importe no válido. Usá el formato 1.234,56'; return; }
    }
  }
  const cuota = t.dataset.cuota != null ? Number(t.dataset.cuota) : undefined;
  const fila = t.dataset.fila != null ? Number(t.dataset.fila) : undefined;
  try { corregirCampo(p, { cuota, fila, campo, valor }); } catch (err) { alert(err.message); }
  dibujar();
});
$('#detalle').addEventListener('click', (e) => {
  const i = e.target.dataset?.restaurar; if (i == null) return;
  const p = planes.find((x) => x.numero === seleccionado); const r = p?.correcciones[Number(i)]; if (!r) return;
  corregirCampo(p, { cuota: r.cuota ?? undefined, fila: r.fila ?? undefined, campo: r.campo, valor: r.campo === 'estado' ? null : r.original });
  dibujar();
});
$('#solo-criticas').addEventListener('change', dibujar);

// ---------- exportar ----------
$('#btn-exportar').addEventListener('click', async () => {
  const nCrit = planes.filter((p) => p.alertas.some((a) => a.nivel === 'critica')).length;
  if (nCrit && !confirm(`Hay ${nCrit} plan(es) con alertas críticas (por ejemplo, diferencias contra el pie del reporte). Van a figurar en la hoja «Notas» y en rojo/amarillo en el Excel.\n\n¿Exportar igual?`)) return;
  try {
    const buf = await generarXlsx(ExcelJS, planes);
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = `planilla-arca-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { console.error(e); alert('No se pudo generar el Excel: ' + e.message); }
});

// ---------- IndexedDB (solo si el usuario lo pide) ----------
function abrirDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('planilla-arca', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('estado');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const idb = async (modo, fn) => { const db = await abrirDB(); return new Promise((res, rej) => { const t = db.transaction('estado', modo); const rq = fn(t.objectStore('estado')); t.oncomplete = () => { db.close(); res(rq?.result); }; t.onerror = () => rej(t.error); }); };
const msg = (t) => { $('#guardado-estado').textContent = t; };
$('#btn-guardar').addEventListener('click', async () => { try { await idb('readwrite', (s) => s.put(JSON.stringify({ items, guardado: new Date().toISOString() }), 'ultimo')); msg('Guardado en este navegador.'); } catch (e) { msg('No se pudo guardar: ' + e.message); } });
$('#btn-cargar').addEventListener('click', async () => {
  try {
    const v = await idb('readonly', (s) => s.get('ultimo'));
    if (!v) { msg('No hay nada guardado.'); return; }
    items = JSON.parse(v).items; planes = consolidar(items); dibujar(); msg('Cargado.');
  } catch (e) { msg('No se pudo cargar: ' + e.message); }
});
$('#btn-borrar').addEventListener('click', async () => { try { await idb('readwrite', (s) => s.delete('ultimo')); msg('Guardado borrado.'); } catch (e) { msg('No se pudo borrar: ' + e.message); } });
