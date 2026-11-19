// parser.js — convierte el texto/palabras del OCR en planes y cuotas.
// Sin dependencias del navegador. Todos los importes se manejan en CENTAVOS (enteros).
// Reglas deterministas; nada de IA. Lo que no se puede leer queda en null y con alerta.

export const EJERCICIO = { desde: '2025-11-01', hasta: '2026-10-31' };
export const UMBRAL_CONF = 80; // confianza mínima (0-100) de tesseract para no marcar la celda

// ---------- formato ----------
export function fmtMonto(c) {
  if (c == null) return '';
  const neg = c < 0; const a = Math.abs(c);
  const ent = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + ent + ',' + String(a % 100).padStart(2, '0');
}
export function fmtFecha(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
/** 'dd/mm/yyyy' -> 'yyyy-mm-dd' (null si no es una fecha válida) */
export function aIso(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
/** Lee un monto escrito en formato argentino o decimal con punto (lo que tipea el usuario). */
export function leerMontoUsuario(s) {
  const t = String(s).trim().replace(/\$/g, '').replace(/\s/g, '');
  const r = /^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(t) || /^-?\d+(,\d{1,2})?$/.test(t);
  if (!r) return null;
  const [e, d = ''] = t.replace(/\./g, '').split(',');
  const neg = e.startsWith('-');
  const v = Math.abs(Number(e)) * 100 + Number(d.padEnd(2, '0'));
  return neg ? -v : v;
}

// ---------- tokens ----------
const RE_MONTO = /^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/;
const RE_FECHA = /^\d{2}\/\d{2}\/\d{4}$/;

function aCentavos(t) {
  const neg = t.startsWith('-');
  const [e, d] = t.replace('-', '').replace(/\./g, '').split(',');
  const v = Number(e) * 100 + Number(d);
  return neg ? -v : v;
}

/** Une fragmentos que el OCR separó con un espacio dentro de un importe: «596.» + «133,69», «5.297.795,» + «77». */
function unirFragmentos(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    let w = { ...words[i] };
    while (i + 1 < words.length && /^\$?[\d.,]*\d[.,]$/.test(w.text) && /^\d[\d.,]*$/.test(words[i + 1].text)) {
      w = { text: w.text + words[i + 1].text, conf: Math.min(w.conf ?? 100, words[i + 1].conf ?? 100), unido: true };
      i++;
    }
    out.push(w);
  }
  return out;
}

/** Separadores mezclados («1.334,415,83»): el último es el decimal, los demás miles. */
function normalizarSeparadores(t) {
  const m = /^(-?\d{1,3}(?:[.,]\d{3})+)[.,](\d{2})$/.exec(t);
  if (!m) return null;
  const n = m[1].replace(/[.,]/g, '.');
  const r = `${n},${m[2]}`;
  return RE_MONTO.test(r) ? r : null;
}

/** Clasifica un token del OCR. */
function clasificar(texto) {
  let t = String(texto).trim().replace(/^\$/, '').replace(/[|]+$/, '');
  if (!t) return { tipo: 'vacio' };
  if (RE_MONTO.test(t)) return { tipo: 'monto', valor: aCentavos(t) };
  if (RE_FECHA.test(t)) { const iso = aIso(t); return iso ? { tipo: 'fecha', valor: iso } : { tipo: 'fechaMala', texto: t }; }
  // confusiones típicas de dígitos (solo en tokens que parecen numéricos)
  const f = t.replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
  if (f !== t && /^[\d./,]+$/.test(f)) {
    if (RE_FECHA.test(f) && aIso(f)) return { tipo: 'fecha', valor: aIso(f), corregido: true };
    if (RE_MONTO.test(f)) return { tipo: 'monto', valor: aCentavos(f), corregido: true };
  }
  const ns = normalizarSeparadores(t);
  if (ns) return { tipo: 'monto', valor: aCentavos(ns), corregido: true };
  if (t === '-' || t === '—' || t === '–') return { tipo: 'guion' };
  if (/^\d{1,3}$/.test(t)) return { tipo: 'entero', valor: Number(t) };
  if (/^[\d.,]{3,}$/.test(t) && /\d[.,]/.test(t)) return { tipo: 'montoMalo', texto: t }; // parece importe pero no se pudo leer
  if (/^pag[o0]\.?$/i.test(t)) return { tipo: 'pago' };
  return { tipo: 'texto', texto: t };
}

// ---------- líneas ----------
export function construirLineas(words) {
  if (!words.length) return [];
  const hs = words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const med = hs[hs.length >> 1] || 10;
  const ord = [...words].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const grupos = [];
  for (const w of ord) {
    const yc = (w.y0 + w.y1) / 2;
    const g = grupos[grupos.length - 1];
    if (g && Math.abs(yc - g.yc) <= med * 0.6) { g.w.push(w); g.yc = (g.yc * (g.w.length - 1) + yc) / g.w.length; }
    else grupos.push({ yc, w: [w] });
  }
  return grupos.map((g) => {
    g.w.sort((a, b) => a.x0 - b.x0);
    return { y: g.yc, text: g.w.map((w) => w.text).join(' '), words: g.w.map((w) => ({ text: w.text, conf: w.conf ?? 100 })) };
  });
}
export function lineasDeTexto(texto) {
  return String(texto).split(/\r?\n/).filter((l) => l.trim()).map((l, i) => ({
    y: i * 10, text: l, words: l.trim().split(/\s+/).map((t) => ({ text: t, conf: 100 })),
  }));
}
/** Acepta: string | [string|{words}|{lines}|{text}] | {paginas:[...]} */
export function aLineas(entrada) {
  if (entrada && entrada.paginas) entrada = entrada.paginas;
  if (typeof entrada === 'string') return lineasDeTexto(entrada);
  const out = [];
  let offset = 0;
  for (const p of entrada) {
    let ls;
    if (typeof p === 'string') ls = lineasDeTexto(p);
    else if (p.lines) ls = p.lines;
    else if (p.words) ls = construirLineas(p.words);
    else ls = lineasDeTexto(p.text || '');
    for (const l of ls) out.push({ ...l, y: (l.y ?? 0) + offset });
    offset += 100000;
  }
  return out;
}

// ---------- nombre de archivo ----------
export function analizarNombre(nombre) {
  const base = String(nombre).split('/').pop();
  const plan = (/([A-Z]\d{6})/i.exec(base) || [])[1]?.toUpperCase() || null;
  const suf = /\.(\d+)\.pdf$/i.exec(base);
  return { plan, sufijo: suf ? Number(suf[1]) : 0, caduco: /caduc/i.test(base) };
}

// ---------- parseo de un reporte ----------
export function parseReporte(entrada, nombreArchivo = '', opc = {}) {
  const umbral = opc.umbral ?? UMBRAL_CONF;
  const lineas = aLineas(entrada);
  const texto = lineas.map((l) => l.text).join('\n');
  const nom = analizarNombre(nombreArchivo);
  const alertas = [];
  const alerta = (nivel, codigo, msg, extra = {}) => alertas.push({ nivel, codigo, texto: msg, ...extra });

  const rep = {
    archivo: nombreArchivo, nombre: nom, tipo: 'desconocido', plan: null, cuit: null, consolidacion: null,
    filas: [], cuotas: [], pie: null, saldoObligaciones: null, alertas, lineasObligaciones: [],
  };

  // encabezado
  const mPlan = /N[uúüo]mero\s+de\s+Plan:?\s*([A-Z]\d{6})/i.exec(texto) || /Plan:?\s*([A-Z]\d{6})/i.exec(texto);
  rep.plan = mPlan ? mPlan[1].toUpperCase() : null;
  const mCuit = /CUIT:?\s*(\d{2}-?\d{8}-?\d)/i.exec(texto);
  rep.cuit = mCuit ? mCuit[1].replace(/-/g, '') : null;
  const mCons = /Consolidaci[oó]n:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto);
  rep.consolidacion = mCons ? aIso(mCons[1]) : null;

  if (!rep.plan) alerta('critica', 'plan-ilegible', 'No se pudo leer el número de plan dentro del archivo.');
  else if (nom.plan && nom.plan !== rep.plan) {
    alerta('aviso', 'plan-distinto', `El nombre del archivo dice ${nom.plan} pero el contenido muestra ${rep.plan}. Se usa ${rep.plan}.`);
  }
  if (!rep.cuit) alerta('aviso', 'cuit-ilegible', 'No se pudo leer el CUIT.');
  if (!rep.consolidacion) alerta('aviso', 'consolidacion-ilegible', 'No se pudo leer la fecha de consolidación.');

  const soloObligaciones = /Obligaciones\s+(Previsionales|Impositivas|Regularizadas)|Detalle\s+de\s+Deuda\s+Impaga|Detalle\s+de\s+Obligaciones/i.test(texto)
    && !/Cuota\s*N|Capital\s*\(\$\)|Capital\(\$\)/i.test(texto);
  // filas
  const filas = [];
  const estadosSueltos = [];
  let pie = null;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    const toks = unirFragmentos(l.words).map((w) => ({ ...clasificar(w.text), conf: w.conf, raw: w.text, corregido: w.unido || undefined }));
    for (const t of toks) if (t.corregido && t.tipo === 'texto') t.corregido = undefined;

    if (/total\s*pagad/i.test(l.text)) {
      const mm = toks.filter((t) => t.tipo === 'monto' || t.tipo === 'montoMalo');
      pie = { montos: mm.map((t) => (t.tipo === 'monto' ? t.valor : null)), conf: mm.map((t) => t.conf), lineaOCR: l.text };
      continue;
    }

    const fechas = toks.filter((t) => t.tipo === 'fecha');
    const montosIdx = toks.map((t, k) => ({ t, k })).filter(({ t }) => ['monto', 'montoMalo', 'guion'].includes(t.tipo));
    // el "-" cuenta como importe solo si está entre importes (ARCA lo imprime por 0,00)
    const montos = montosIdx.filter(({ t, k }) => t.tipo !== 'guion' ||
      (montosIdx.some((o) => o.k < k && o.t.tipo !== 'guion') && montosIdx.some((o) => o.k > k && o.t.tipo !== 'guion')));

    if (!soloObligaciones && fechas.length >= 1 && montos.length >= 3) {
      const kFecha = toks.indexOf(fechas[0]);
      const antes = toks.slice(0, montos[0].k).filter((t) => t.tipo === 'entero' || (t.tipo === 'texto' && /^[Il|]$/.test(t.texto)));
      let cuotaN = null; let cuotaConf = 100;
      if (antes.length) { const t = antes[0]; cuotaN = t.tipo === 'entero' ? t.valor : 1; cuotaConf = t.tipo === 'entero' ? t.conf : 0; }
      const despues = toks.slice(kFecha + 1);
      const pago = despues.some((t) => t.tipo === 'pago');
      const txt = despues.map((t) => t.raw).join(' ');
      const estadoTxt = /cancel/i.test(txt) ? 'Cuota Cancelada' : /impag/i.test(txt) ? 'Cuota Impaga' : null;
      filas.push({
        linea: i, y: l.y, lineaOCR: l.text, cuotaN, cuotaConf,
        montos: montos.map(({ t }) => ({ v: t.tipo === 'monto' ? t.valor : t.tipo === 'guion' ? 0 : null, conf: t.tipo === 'guion' ? 100 : t.conf, corregido: !!t.corregido, ilegible: t.tipo === 'montoMalo', texto: t.texto })),
        venc: fechas[0].valor, vencConf: fechas[0].conf, vencCorregido: !!fechas[0].corregido,
        pago, estadoTxt,
      });
      continue;
    }
    if (fechas.length === 0 && /cuota\s+(cancel|impag)|cancelada|impaga/i.test(l.text) && montos.length === 0) {
      estadosSueltos.push({ y: l.y, estadoTxt: /cancel/i.test(l.text) ? 'Cuota Cancelada' : 'Cuota Impaga' });
    }
    if (fechas.length >= 1 && montos.length >= 1 && (soloObligaciones || montos.length < 3)) {
      rep.lineasObligaciones.push({ y: l.y, lineaOCR: l.text, fecha: fechas[0].valor, montos: montos.map(({ t }) => (t.tipo === 'monto' ? t.valor : null)) });
    }
    // fecha mala dentro de una línea que parece fila
    if (toks.some((t) => t.tipo === 'fechaMala') && montos.length >= 3) {
      alerta('critica', 'fecha-ilegible', `Fila con fecha ilegible: «${l.text}»`);
    }
  }

  // tipo de documento
  const esObl = /Obligaciones\s+(Previsionales|Impositivas|Regularizadas)|Detalle\s+de\s+Deuda\s+Impaga|Detalle\s+de\s+Obligaciones/i.test(texto);
  if (filas.length) rep.tipo = 'cuotas';
  else if (esObl) rep.tipo = 'obligaciones';

  if (rep.tipo === 'obligaciones') return parseObligaciones(rep, lineas, texto);
  if (rep.tipo === 'desconocido') {
    alerta('critica', 'sin-tabla', 'No se reconoció una tabla de cuotas ni un detalle de obligaciones (¿hoja en blanco, rotación incorrecta u OCR fallido?).');
    return rep;
  }

  // estados sueltos -> fila más cercana por posición vertical
  for (const e of estadosSueltos) {
    let best = null;
    for (const f of filas) if (!best || Math.abs(f.y - e.y) < Math.abs(best.y - e.y)) best = f;
    if (best && !best.estadoTxt) best.estadoTxt = e.estadoTxt;
  }

  armarCuotas(rep, filas, umbral, alerta);
  armarPie(rep, pie, umbral, alerta);
  controlarPlan(rep, alerta);
  return rep;
}

function armarCuotas(rep, filas, umbral, alerta) {
  // 1) asignar importes a columnas
  let grupoActual = null;
  let n = 0;
  const grupos = [];
  for (const f of filas) {
    const m = f.montos;
    const flags = {};
    let cap = null; let fin = null; let res = null; let tot = null;
    const conf = {};
    const asignar = (clave, idx) => { const x = m[idx]; conf[clave] = x; return x.ilegible ? null : x.v; };
    if (m.length >= 4) {
      if (m.length > 4) alerta('critica', 'fila-larga', `Fila con más de 4 importes: «${f.lineaOCR}»`, { cuota: f.cuotaN });
      cap = asignar('capital', 0); fin = asignar('financiero', 1); res = asignar('resarcitorio', 2); tot = asignar('total', 3);
      f.conCapital = true;
    } else if (m.length === 3 && f.cuotaN == null) {
      fin = asignar('financiero', 0); res = asignar('resarcitorio', 1); tot = asignar('total', 2); // capital combinado: se hereda
      f.conCapital = false;
    } else if (m.length === 3) {
      // con número de cuota pero falta un importe: no se inventa
      cap = asignar('capital', 0); fin = asignar('financiero', 1); tot = asignar('total', 2); res = null;
      conf.resarcitorio = { conf: 0, ilegible: true };
      f.conCapital = true; f.incompleta = true;
      alerta('critica', 'fila-incompleta', `Fila con solo 3 importes y número de cuota (falta uno, probablemente el resarcitorio): «${f.lineaOCR}»`, { cuota: f.cuotaN });
    }
    Object.assign(f, { cap, fin, res, tot, confImp: conf });

    // 2) ¿nueva cuota?
    let nueva = false;
    if (!grupoActual) nueva = true;
    else if (f.cuotaN != null && f.cuotaN !== grupoActual.n) nueva = true;
    else if (f.cuotaN == null && f.conCapital && !(f.cap === grupoActual.capital && f.fin === grupoActual.financiero)) nueva = true;
    if (nueva) {
      let numero = f.cuotaN; let inferida = false;
      if (numero == null) { numero = n + 1; inferida = true; alerta('aviso', 'cuota-inferida', `Fila sin número de cuota; se asumió la cuota ${numero} por la secuencia: «${f.lineaOCR}»`, { cuota: numero }); }
      grupoActual = { n: numero, inferida, capital: null, financiero: null, filas: [], conf: {} };
      grupos.push(grupoActual);
    }
    n = grupoActual.n;
    if (grupoActual.capital == null && f.cap != null) grupoActual.capital = f.cap;
    if (grupoActual.financiero == null && f.fin != null) grupoActual.financiero = f.fin;
    grupoActual.filas.push(f);
  }

  // 3) armar cada cuota
  for (const g of grupos) {
    const c = {
      n: g.n, numeroInferido: g.inferida, capital: null, financiero: null, filas: [], estadoTxt: null,
      pagada: false, vencPago: null, resPagado: null, totalPagado: null, resPendiente: 0,
      revisar: {}, alertas: [],
    };
    const al = (nivel, codigo, msg) => { const a = { nivel, codigo, texto: msg, cuota: g.n }; c.alertas.push(a); rep.alertas.push(a); };
    const bajo = (x) => x && (x.corregido || x.ilegible || x.conf < umbral);

    for (const f of g.filas) {
      // capital / financiero: deben ser iguales en todas las filas de la cuota
      if (f.cap != null) {
        if (c.capital == null) { c.capital = f.cap; if (bajo(f.confImp.capital)) c.revisar.capital = true; }
        else if (c.capital !== f.cap) { al('critica', 'capital-distinto', `Cuota ${g.n}: el capital cambia entre filas (${fmtMonto(c.capital)} vs ${fmtMonto(f.cap)}).`); c.revisar.capital = true; }
      } else if (f.conCapital) c.revisar.capital = true;
      if (f.fin != null) {
        if (c.financiero == null) { c.financiero = f.fin; if (bajo(f.confImp.financiero)) c.revisar.financiero = true; }
        else if (c.financiero !== f.fin) { al('critica', 'financiero-distinto', `Cuota ${g.n}: el interés financiero cambia entre filas (${fmtMonto(c.financiero)} vs ${fmtMonto(f.fin)}).`); c.revisar.financiero = true; }
      } else c.revisar.financiero = true;

      const fila = {
        venc: f.venc, capital: f.cap ?? c.capital, financiero: f.fin ?? c.financiero, resarcitorio: f.res, total: f.tot,
        pago: f.pago, estadoTxt: f.estadoTxt, lineaOCR: f.lineaOCR,
        revisar: {
          resarcitorio: !!bajo(f.confImp.resarcitorio) || f.res == null,
          total: !!bajo(f.confImp.total) || f.tot == null,
          capital: f.cap != null && !!bajo(f.confImp.capital),
          financiero: f.fin != null && !!bajo(f.confImp.financiero),
          venc: f.vencConf < umbral || f.vencCorregido,
        },
      };
      // control Total = Capital + Financiero + Resarcitorio
      if (fila.capital != null && fila.financiero != null && fila.resarcitorio != null && fila.total != null) {
        const esperado = fila.capital + fila.financiero + fila.resarcitorio;
        if (esperado !== fila.total) {
          fila.errorSuma = fila.total - esperado;
          fila.revisar.total = true;
          al('critica', 'total-no-cierra', `Cuota ${g.n}, venc. ${fmtFecha(fila.venc)}: Total ${fmtMonto(fila.total)} ≠ Capital + Financiero + Resarcitorio ${fmtMonto(esperado)} (dif. ${fmtMonto(fila.total - esperado)}).`);
        }
      }
      c.filas.push(fila);
    }

    // estado
    const estados = new Set(c.filas.map((x) => x.estadoTxt).filter(Boolean));
    if (estados.size > 1) al('critica', 'estado-contradictorio', `Cuota ${g.n}: aparecen estados contradictorios (${[...estados].join(' / ')}).`);
    c.estadoTxt = estados.has('Cuota Cancelada') ? 'Cuota Cancelada' : estados.has('Cuota Impaga') ? 'Cuota Impaga' : null;

    const filasPago = c.filas.filter((x) => x.pago);
    if (filasPago.length > 1) al('critica', 'varios-pagos', `Cuota ${g.n}: hay ${filasPago.length} filas marcadas «Pago». Se usa la última.`);
    const fp = filasPago[filasPago.length - 1] || null;
    c.pagada = !!fp || c.estadoTxt === 'Cuota Cancelada';
    if (fp && c.estadoTxt === 'Cuota Impaga') al('critica', 'pago-e-impaga', `Cuota ${g.n}: tiene fila «Pago» pero el estado dice «Cuota Impaga».`);
    if (c.pagada) {
      if (fp) {
        c.vencPago = fp.venc; c.resPagado = fp.resarcitorio; c.filaPago = fp;
        if (fp.revisar.venc) c.revisar.vencPago = true;
        if (fp.revisar.resarcitorio) c.revisar.resPagado = true;
        if (c.capital != null && c.financiero != null && fp.resarcitorio != null) c.totalPagado = c.capital + c.financiero + fp.resarcitorio;
        if (fp.resarcitorio == null) al('critica', 'pago-sin-resarcitorio', `Cuota ${g.n}: no se pudo leer el resarcitorio de la fila de pago.`);
      } else {
        al('critica', 'cancelada-sin-pago', `Cuota ${g.n}: figura «Cuota Cancelada» pero ninguna fila quedó marcada «Pago». Fecha y resarcitorio pagados quedan en blanco para revisar.`);
        c.revisar.vencPago = true; c.revisar.resPagado = true;
      }
    } else {
      // pendiente: resarcitorio del último vencimiento <= cierre
      const cand = c.filas.filter((x) => x.venc && x.venc <= EJERCICIO.hasta);
      if (cand.length) {
        cand.sort((a, b) => (a.venc < b.venc ? -1 : a.venc > b.venc ? 1 : 0));
        const ult = cand[cand.length - 1];
        c.resPendiente = ult.resarcitorio ?? 0;
        if (ult.resarcitorio == null) { c.revisar.resPendiente = true; al('critica', 'pend-sin-resarcitorio', `Cuota ${g.n}: no se pudo leer el resarcitorio pendiente.`); }
        else if (ult.revisar.resarcitorio) c.revisar.resPendiente = true;
      }
    }
    if (c.capital == null) al('critica', 'sin-capital', `Cuota ${g.n}: no se pudo leer el capital.`);
    if (c.financiero == null) al('critica', 'sin-financiero', `Cuota ${g.n}: no se pudo leer el interés financiero.`);
    rep.cuotas.push(c);
  }
}

function armarPie(rep, pie, umbral, alerta) {
  if (!pie) { alerta('critica', 'sin-pie', 'No se encontró la fila «Total Pagado» del pie del reporte: no se puede controlar la suma.'); return; }
  const m = pie.montos;
  if (m.length !== 4 || m.some((x) => x == null)) {
    alerta('critica', 'pie-incompleto', `No se pudieron leer los 4 importes del pie (se leyeron ${m.filter((x) => x != null).length}): «${pie.lineaOCR}»`);
    rep.pie = { capital: m[0] ?? null, financiero: m[1] ?? null, resarcitorio: m[2] ?? null, total: m[3] ?? null, incompleto: true };
    return;
  }
  rep.pie = { capital: m[0], financiero: m[1], resarcitorio: m[2], total: m[3], baja: pie.conf.some((c) => c < umbral) };
  if (m[0] + m[1] + m[2] !== m[3]) {
    alerta('critica', 'pie-no-cierra', `El pie no cierra: capital + financiero + resarcitorio = ${fmtMonto(m[0] + m[1] + m[2])} pero el total del pie es ${fmtMonto(m[3])}.`);
  }
}

/** Suma de cuotas pagas contra el pie y chequeos de secuencia. */
export function totalesPagos(cuotas) {
  let capital = 0, financiero = 0, resarcitorio = 0, completo = true;
  for (const c of cuotas) {
    if (!c.pagada) continue;
    if (c.capital == null || c.financiero == null || c.resPagado == null) { completo = false; }
    capital += c.capital ?? 0; financiero += c.financiero ?? 0; resarcitorio += c.resPagado ?? 0;
  }
  return { capital, financiero, resarcitorio, total: capital + financiero + resarcitorio, completo };
}

export function diferenciaConPie(cuotas, pie) {
  if (!pie || pie.incompleto) return null;
  const t = totalesPagos(cuotas);
  return {
    capital: t.capital - pie.capital, financiero: t.financiero - pie.financiero,
    resarcitorio: t.resarcitorio - pie.resarcitorio, total: t.total - pie.total,
  };
}

function controlarPlan(rep, alerta) {
  const ns = rep.cuotas.map((c) => c.n);
  const max = Math.max(0, ...ns);
  for (let i = 1; i <= max; i++) if (!ns.includes(i)) alerta('critica', 'falta-cuota', `Falta la cuota ${i} en la secuencia (¿el OCR la omitió?).`, { cuota: i });
  const dup = ns.filter((n, i) => ns.indexOf(n) !== i);
  for (const d of new Set(dup)) alerta('critica', 'cuota-repetida', `La cuota ${d} aparece más de una vez como grupo separado.`, { cuota: d });
  const d = diferenciaConPie(rep.cuotas, rep.pie);
  if (d && (d.capital || d.financiero || d.resarcitorio || d.total)) {
    alerta('critica', 'dif-pie', `La suma de las cuotas pagas no coincide con el pie: capital ${fmtMonto(d.capital)}, financiero ${fmtMonto(d.financiero)}, resarcitorio ${fmtMonto(d.resarcitorio)}, total ${fmtMonto(d.total)} (suma − pie).`, { diferencia: d });
  }
  if (!totalesPagos(rep.cuotas).completo) alerta('critica', 'pagas-incompletas', 'Hay cuotas pagas con datos ilegibles: la suma contra el pie no es confiable.');
}

function parseObligaciones(rep, lineas, texto) {
  // Documentos sin cuotas: saldo = último importe de cada renglón con fecha de vencimiento.
  // El formato varía, así que siempre se marca para revisión manual.
  let saldo = 0; let n = 0; let ilegibles = 0;
  for (const l of rep.lineasObligaciones) {
    const ult = l.montos[l.montos.length - 1];
    if (ult == null) { ilegibles++; continue; }
    saldo += ult; n++;
  }
  rep.saldoObligaciones = n ? saldo : null;
  rep.cantidadRenglones = n;
  rep.alertas.push({ nivel: 'aviso', codigo: 'obligaciones-revisar', texto: `Documento sin cuotas (obligaciones): saldo estimado sumando el último importe de ${n} renglón(es). Verificar contra el PDF.` });
  if (ilegibles) rep.alertas.push({ nivel: 'critica', codigo: 'obligaciones-ilegibles', texto: `${ilegibles} renglón(es) con importes ilegibles.` });
  if (!n) rep.alertas.push({ nivel: 'critica', codigo: 'obligaciones-vacio', texto: 'No se detectaron renglones con saldo.' });
  return rep;
}

// ---------- consolidación de varios archivos ----------
function firma(r) {
  return JSON.stringify([r.tipo, r.plan, r.cuotas.map((c) => [c.n, c.capital, c.financiero, c.pagada, c.vencPago, c.resPagado, c.filas.map((f) => [f.venc, f.resarcitorio, f.total])]), r.pie, r.saldoObligaciones]);
}

/**
 * Une los reportes de varios archivos en planes (uno por número de plan del CONTENIDO).
 * @param {Array<{archivo:string, reporte:object}>} items
 */
export function consolidar(items) {
  const porPlan = new Map();
  for (const it of items) {
    const r = it.reporte;
    const clave = r.plan || r.nombre.plan || `sin-plan:${it.archivo}`;
    if (!porPlan.has(clave)) porPlan.set(clave, []);
    porPlan.get(clave).push(it);
  }
  const planes = [];
  for (const [numero, lista] of porPlan) {
    const alertas = [];
    const alerta = (nivel, codigo, texto, extra = {}) => alertas.push({ nivel, codigo, texto, ...extra });
    // duplicados exactos
    const vistos = new Map(); const unicos = [];
    // primero el de sufijo más alto: si hay copias idénticas, se conserva esa y se ignoran las otras
    const ordenada = [...lista].sort((a, b) => b.reporte.nombre.sufijo - a.reporte.nombre.sufijo || a.archivo.localeCompare(b.archivo));
    for (const it of ordenada) {
      const f = firma(it.reporte);
      if (vistos.has(f)) { alerta('aviso', 'duplicado', `«${it.archivo}» es idéntico a «${vistos.get(f)}»: se ignoró.`); continue; }
      vistos.set(f, it.archivo); unicos.push(it);
    }
    // versión: mayor sufijo; a igual sufijo, el que tenga más filas
    unicos.sort((a, b) => b.reporte.nombre.sufijo - a.reporte.nombre.sufijo ||
      (b.reporte.cuotas.length - a.reporte.cuotas.length) || a.archivo.localeCompare(b.archivo));
    const elegido = unicos[0];
    const r = elegido.reporte;
    if (unicos.length > 1) {
      const otros = unicos.slice(1).map((u) => u.archivo).join(', ');
      alerta('aviso', 'varias-versiones', `Hay ${unicos.length} versiones distintas del plan. Se usó «${elegido.archivo}» (sufijo más alto). Se ignoraron: ${otros}.`);
      if (unicos.slice(1).some((u) => u.reporte.nombre.sufijo === r.nombre.sufijo)) {
        alerta('aviso', 'sufijo-empatado', 'Dos versiones tienen el mismo sufijo; se eligió la que tiene más cuotas leídas. Verificar cuál corresponde.');
      }
      const tipos = new Set(unicos.map((u) => u.reporte.tipo));
      if (tipos.size > 1) alerta('aviso', 'tipos-mezclados', `Las versiones del plan son de tipos distintos (${[...tipos].join(', ')}); se usó el de «${elegido.archivo}».`);
    }
    const caducos = lista.filter((it) => it.reporte.nombre.caduco).map((it) => it.archivo);
    if (caducos.length && !r.nombre.caduco) alerta('aviso', 'caduco-otra-version', `El archivo elegido no dice «caduco», pero sí: ${caducos.join(', ')}.`);
    // alertas del reporte elegido
    for (const a of r.alertas) alertas.push(a);
    planes.push({
      numero, tipo: r.tipo, estado: caducos.length ? 'Caduco (según archivo)' : 'Sin marca de caducidad en el archivo',
      caduco: !!caducos.length, archivo: elegido.archivo, version: r.nombre.sufijo, cuit: r.cuit, consolidacion: r.consolidacion,
      cuotas: r.cuotas, pie: r.pie, saldoObligaciones: r.saldoObligaciones,
      archivos: lista.map((l) => l.archivo), alertas,
    });
  }
  planes.sort((a, b) => a.numero.localeCompare(b.numero));
  return planes;
}

/** Totales calculados de un plan (para pantalla y para verificar el Excel). */
export function resumenPlan(p) {
  const tp = totalesPagos(p.cuotas);
  let capPend = 0, finPend = 0, resPend = 0;
  for (const c of p.cuotas) if (!c.pagada) { capPend += c.capital ?? 0; finPend += c.financiero ?? 0; resPend += c.resPendiente ?? 0; }
  const pagas = p.cuotas.filter((c) => c.pagada).length;
  return {
    cuotas: p.cuotas.length, pagas, impagas: p.cuotas.length - pagas,
    pagado: tp, pendiente: { capital: capPend, financiero: finPend, resarcitorio: resPend, total: capPend + finPend + resPend },
    diferencia: diferenciaConPie(p.cuotas, p.pie),
    criticas: p.alertas.filter((a) => a.nivel === 'critica').length,
    avisos: p.alertas.filter((a) => a.nivel === 'aviso').length,
  };
}

export function clasificarEjercicio(c) {
  if (!c.pagada) return 'Próximo ejercicio';
  if (!c.vencPago) return 'Revisar';
  if (c.vencPago < EJERCICIO.desde) return 'Ejercicio anterior';
  if (c.vencPago <= EJERCICIO.hasta) return 'Ejercicio cerrado';
  return 'Posterior al ejercicio';
}
