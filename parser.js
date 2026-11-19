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
  if (/^[\d.,#*_~'"|`]{3,}$/.test(t) && /\d[.,#*_~'"|`]|[.,]\d/.test(t) && /\d/.test(t) && /[.,]/.test(t)) return { tipo: 'montoMalo', texto: t }; // parece importe pero no se pudo leer
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

    c.base = { capital: false, financiero: false };
    for (const f of g.filas) {
      // capital / financiero: deben ser iguales en todas las filas de la cuota
      if (f.cap != null) {
        if (c.capital == null) { c.capital = f.cap; if (bajo(f.confImp.capital)) c.base.capital = true; }
        else if (c.capital !== f.cap) { al('critica', 'capital-distinto', `Cuota ${g.n}: el capital cambia entre filas (${fmtMonto(c.capital)} vs ${fmtMonto(f.cap)}).`); c.base.capital = true; }
      } else if (f.conCapital) c.base.capital = true;
      if (f.fin != null) {
        if (c.financiero == null) { c.financiero = f.fin; if (bajo(f.confImp.financiero)) c.base.financiero = true; }
        else if (c.financiero !== f.fin) { al('critica', 'financiero-distinto', `Cuota ${g.n}: el interés financiero cambia entre filas (${fmtMonto(c.financiero)} vs ${fmtMonto(f.fin)}).`); c.base.financiero = true; }
      } else c.base.financiero = true;

      c.filas.push({
        venc: f.venc, capital: f.cap, financiero: f.fin, resarcitorio: f.res, total: f.tot,
        pago: f.pago, estadoTxt: f.estadoTxt, lineaOCR: f.lineaOCR, incompleta: !!f.incompleta,
        base: {
          resarcitorio: !!bajo(f.confImp.resarcitorio), total: !!bajo(f.confImp.total),
          capital: f.cap != null && !!bajo(f.confImp.capital), financiero: f.fin != null && !!bajo(f.confImp.financiero),
          venc: f.vencConf < umbral || f.vencCorregido,
        },
        manual: {},
      });
    }
    evaluarCuota(c, al);
    rep.cuotas.push(c);
  }
}

function armarPie(rep, pie, umbral, alerta) {
  if (pie) {
    const m = pie.montos;
    rep.pie = {
      capital: m[0] ?? null, financiero: m[1] ?? null, resarcitorio: m[2] ?? null, total: m[3] ?? null,
      bajaBase: pie.conf.some((c) => c < umbral), manual: {}, lineaOCR: pie.lineaOCR, leidos: m.filter((x) => x != null).length,
    };
  }
  evaluarPie(rep, alerta);
}

/** Valida el pie del reporte (también se usa al corregir a mano). */
function evaluarPie(plan, alerta) {
  const pie = plan.pie;
  if (!pie) { alerta('critica', 'sin-pie', 'No se encontró la fila «Total Pagado» del pie del reporte: no se puede controlar la suma.'); return; }
  const k4 = ['capital', 'financiero', 'resarcitorio', 'total'];
  const faltan = k4.filter((k) => pie[k] == null);
  pie.incompleto = faltan.length > 0;
  pie.manual ||= {};
  pie.revisar = Object.fromEntries(k4.map((k) => [k, (!!pie.bajaBase && !pie.manual[k]) || pie[k] == null]));
  pie.baja = Object.values(pie.revisar).some(Boolean);
  if (pie.incompleto) {
    alerta('critica', 'pie-incompleto', `No se pudieron leer los 4 importes del pie (se leyeron ${4 - faltan.length}${pie.lineaOCR ? `: «${pie.lineaOCR}»` : ''}). Falta: ${faltan.join(', ')}.`);
    return;
  }
  if (pie.capital + pie.financiero + pie.resarcitorio !== pie.total) {
    alerta('critica', 'pie-no-cierra', `El pie no cierra: capital + financiero + resarcitorio = ${fmtMonto(pie.capital + pie.financiero + pie.resarcitorio)} pero el total del pie es ${fmtMonto(pie.total)}.`);
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
  controlesPagos(rep, alerta);
}

/** Suma de cuotas pagas contra el pie. */
function controlesPagos(plan, alerta) {
  const d = diferenciaConPie(plan.cuotas, plan.pie);
  if (d && (d.capital || d.financiero || d.resarcitorio || d.total)) {
    alerta('critica', 'dif-pie', `La suma de las cuotas pagas no coincide con el pie: capital ${fmtMonto(d.capital)}, financiero ${fmtMonto(d.financiero)}, resarcitorio ${fmtMonto(d.resarcitorio)}, total ${fmtMonto(d.total)} (suma − pie).`, { diferencia: d });
  }
  if (!totalesPagos(plan.cuotas).completo) alerta('critica', 'pagas-incompletas', 'Hay cuotas pagas con datos ilegibles: la suma contra el pie no es confiable.');
}

// ---------- evaluación de una cuota (inicial y tras correcciones manuales) ----------
const CODIGOS_DATOS = new Set(['total-no-cierra', 'total-ilegible', 'cancelada-sin-pago', 'varios-pagos', 'pago-e-impaga', 'pago-sin-resarcitorio',
  'pend-sin-resarcitorio', 'estado-contradictorio', 'sin-capital', 'sin-financiero', 'sin-pie', 'pie-incompleto', 'pie-no-cierra', 'dif-pie', 'pagas-incompletas']);

/** Recalcula todo lo derivado de una cuota a partir de sus filas y de lo editado a mano. */
export function evaluarCuota(c, al) {
  c.manual ||= {}; c.base ||= {};
  c.revisar = {};
  c.vencPago = null; c.resPagado = null; c.totalPagado = null; c.resPendiente = 0; c.filaPago = undefined;
  if ((c.base.capital && !c.manual.capital) || c.capital == null) c.revisar.capital = true;
  if ((c.base.financiero && !c.manual.financiero) || c.financiero == null) c.revisar.financiero = true;

  for (const f of c.filas) {
    f.capital = c.capital; f.financiero = c.financiero;
    f.manual ||= {}; const b = f.base || {};
    f.revisar = {
      resarcitorio: (!!b.resarcitorio && !f.manual.resarcitorio) || f.resarcitorio == null,
      total: (!!b.total && !f.manual.total) || f.total == null,
      capital: !!b.capital && !c.manual.capital, financiero: !!b.financiero && !c.manual.financiero,
      venc: !!b.venc && !f.manual.venc,
    };
    f.errorSuma = undefined;
    if (f.total == null) al('critica', 'total-ilegible', `Cuota ${c.n}, venc. ${fmtFecha(f.venc)}: no se pudo leer el total de la fila, no se puede verificar que cierre.`);
    if (f.capital != null && f.financiero != null && f.resarcitorio != null && f.total != null) {
      const esperado = f.capital + f.financiero + f.resarcitorio;
      if (esperado !== f.total) {
        f.errorSuma = f.total - esperado; f.revisar.total = true;
        al('critica', 'total-no-cierra', `Cuota ${c.n}, venc. ${fmtFecha(f.venc)}: Total ${fmtMonto(f.total)} ≠ Capital + Financiero + Resarcitorio ${fmtMonto(esperado)} (dif. ${fmtMonto(f.total - esperado)}).`);
      }
    }
  }

  // estado
  if (c.estadoManual !== undefined) c.estadoTxt = c.estadoManual;
  else {
    const estados = new Set(c.filas.map((x) => x.estadoTxt).filter(Boolean));
    if (estados.size > 1) al('critica', 'estado-contradictorio', `Cuota ${c.n}: aparecen estados contradictorios (${[...estados].join(' / ')}).`);
    c.estadoTxt = estados.has('Cuota Cancelada') ? 'Cuota Cancelada' : estados.has('Cuota Impaga') ? 'Cuota Impaga' : null;
  }

  const filasPago = c.filas.filter((x) => x.pago);
  if (filasPago.length > 1) al('critica', 'varios-pagos', `Cuota ${c.n}: hay ${filasPago.length} filas marcadas «Pago». Se usa la última.`);
  const fp = filasPago[filasPago.length - 1] || null;
  c.pagada = !!fp || c.estadoTxt === 'Cuota Cancelada';
  if (fp && c.estadoTxt === 'Cuota Impaga') al('critica', 'pago-e-impaga', `Cuota ${c.n}: tiene fila «Pago» pero el estado dice «Cuota Impaga».`);
  if (c.pagada) {
    if (fp) {
      c.vencPago = fp.venc; c.resPagado = fp.resarcitorio; c.filaPago = fp;
      if (fp.revisar.venc || fp.venc == null) c.revisar.vencPago = true;
      if (fp.revisar.resarcitorio) c.revisar.resPagado = true;
      if (c.capital != null && c.financiero != null && fp.resarcitorio != null) c.totalPagado = c.capital + c.financiero + fp.resarcitorio;
      if (fp.resarcitorio == null) al('critica', 'pago-sin-resarcitorio', `Cuota ${c.n}: no se pudo leer el resarcitorio de la fila de pago.`);
    } else {
      al('critica', 'cancelada-sin-pago', `Cuota ${c.n}: figura «Cuota Cancelada» pero ninguna fila quedó marcada «Pago». Fecha y resarcitorio pagados quedan en blanco para revisar.`);
      c.revisar.vencPago = true; c.revisar.resPagado = true;
    }
  } else {
    // pendiente: resarcitorio del último vencimiento <= cierre
    const cand = c.filas.filter((x) => x.venc && x.venc <= EJERCICIO.hasta);
    if (cand.length) {
      cand.sort((a, b) => (a.venc < b.venc ? -1 : a.venc > b.venc ? 1 : 0));
      const ult = cand[cand.length - 1];
      c.resPendiente = ult.resarcitorio ?? 0;
      if (ult.resarcitorio == null) { c.revisar.resPendiente = true; al('critica', 'pend-sin-resarcitorio', `Cuota ${c.n}: no se pudo leer el resarcitorio pendiente.`); }
      else if (ult.revisar.resarcitorio) c.revisar.resPendiente = true;
    }
  }
  if (c.capital == null) al('critica', 'sin-capital', `Cuota ${c.n}: no se pudo leer el capital.`);
  if (c.financiero == null) al('critica', 'sin-financiero', `Cuota ${c.n}: no se pudo leer el interés financiero.`);
}

/** Recalcula las alertas de datos de un plan (después de editar a mano). Las demás (archivo, versiones…) no se tocan. */
export function revalidarPlan(plan) {
  if (plan.tipo !== 'cuotas') return plan;
  plan.alertas = plan.alertas.filter((a) => !CODIGOS_DATOS.has(a.codigo));
  const alP = (nivel, codigo, texto, extra = {}) => plan.alertas.push({ nivel, codigo, texto, ...extra });
  for (const c of plan.cuotas) {
    c.alertas = (c.alertas || []).filter((a) => !CODIGOS_DATOS.has(a.codigo));
    evaluarCuota(c, (nivel, codigo, texto) => { const a = { nivel, codigo, texto, cuota: c.n }; c.alertas.push(a); plan.alertas.push(a); });
  }
  evaluarPie(plan, alP);
  controlesPagos(plan, alP);
  return plan;
}

const ETIQUETA = { capital: 'Capital', financiero: 'Interés financiero', resarcitorio: 'Resarcitorio', total: 'Total', venc: 'Fecha de vencimiento', pago: 'Fila «Pago»', estado: 'Estado de la cuota' };
const ETIQ_PIE = { capital: 'Pie: capital', financiero: 'Pie: interés financiero', resarcitorio: 'Pie: resarcitorio', total: 'Pie: total pagado' };

function textoValor(campo, v) {
  if (v == null || v === '') return '(en blanco)';
  if (campo === 'venc') return fmtFecha(v);
  if (campo === 'pago') return v ? 'marcada' : 'sin marcar';
  if (campo === 'estado') return v;
  return fmtMonto(v);
}

/**
 * Corrige a mano un dato leído por OCR y recalcula las alertas. NO oculta inconsistencias:
 * si lo que se escribe no cierra, la alerta sigue.
 * cambio: { cuota, fila (índice), campo: capital|financiero|resarcitorio|total|venc|pago|estado|pie:<k>, valor }
 */
export function corregirCampo(plan, { cuota, fila, campo, valor }) {
  if (plan.tipo !== 'cuotas') throw new Error('Solo se corrigen planes con cuotas');
  plan.correcciones ||= [];
  const esPie = campo.startsWith('pie:');
  const c = esPie ? null : plan.cuotas.find((x) => x.n === cuota);
  if (!esPie && !c) throw new Error(`No existe la cuota ${cuota}`);
  const f = c && fila != null ? c.filas[fila] : null;
  let antes; let etiqueta; let clave;

  if (esPie) {
    const k = campo.slice(4);
    plan.pie ||= { capital: null, financiero: null, resarcitorio: null, total: null, bajaBase: false, manual: {} };
    antes = plan.pie[k]; plan.pie[k] = valor; plan.pie.manual ||= {}; plan.pie.manual[k] = valor != null;
    etiqueta = ETIQ_PIE[k]; clave = `pie|${k}`;
  } else if (campo === 'capital' || campo === 'financiero') {
    antes = c[campo]; c[campo] = valor; c.manual[campo] = valor != null;
    const cod = campo === 'capital' ? 'capital-distinto' : 'financiero-distinto';
    plan.alertas = plan.alertas.filter((a) => !(a.codigo === cod && a.cuota === c.n));
    etiqueta = `Cuota ${c.n} — ${ETIQUETA[campo]}`; clave = `${c.n}|${campo}`;
  } else if (campo === 'estado') {
    antes = c.estadoTxt; if (valor == null) delete c.estadoManual; else c.estadoManual = valor;
    etiqueta = `Cuota ${c.n} — ${ETIQUETA.estado}`; clave = `${c.n}|estado`;
  } else if (['resarcitorio', 'total', 'venc', 'pago'].includes(campo)) {
    if (!f) throw new Error('Falta la fila');
    antes = f[campo];
    if (campo === 'pago' && valor) c.filas.forEach((x) => { x.pago = false; });
    f[campo] = valor; f.manual ||= {}; f.manual[campo] = campo === 'pago' ? true : valor != null;
    if (campo === 'resarcitorio' && f.incompleta && valor != null) {
      f.incompleta = false; plan.alertas = plan.alertas.filter((a) => !(a.codigo === 'fila-incompleta' && a.cuota === c.n));
    }
    etiqueta = `Cuota ${c.n}, fila ${f.venc ? fmtFecha(f.venc) : fila + 1} — ${ETIQUETA[campo]}`;
    clave = `${c.n}|${fila}|${campo}`;
  } else throw new Error(`Campo desconocido: ${campo}`);

  // registro: se conserva el valor ORIGINAL leído por el OCR
  let reg = plan.correcciones.find((x) => x.clave === clave);
  if (!reg) { reg = { clave, etiqueta, campo, cuota: c?.n ?? null, fila: fila ?? null, original: antes, actual: valor }; plan.correcciones.push(reg); }
  reg.actual = valor;
  reg.textoOriginal = textoValor(campo.replace('pie:', ''), reg.original); reg.textoActual = textoValor(campo.replace('pie:', ''), valor);
  if (reg.original === reg.actual || (campo === 'estado' && valor == null)) plan.correcciones.splice(plan.correcciones.indexOf(reg), 1);

  return revalidarPlan(plan);
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
      correcciones: (r.correcciones ||= []),   // compartido con el reporte: se guarda junto con él
      archivos: lista.map((l) => l.archivo), alertas,
    });
    if (r.correcciones.length) revalidarPlan(planes[planes.length - 1]);
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
