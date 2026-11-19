// ocr.js — render de páginas PDF, detección de rotación y OCR.
// Funciona igual en el navegador y en Node: las dependencias dependientes del
// entorno (canvas, imagen para tesseract) se inyectan en `env`.

const CLAVES = [
  'cuota', 'capital', 'financiero', 'resarcitorio', 'total', 'venc', 'estado',
  'pago', 'plan', 'cuit', 'consolidacion', 'arca', 'pagado', 'obligaciones',
  'deuda', 'impaga', 'cancelada', 'previsionales', 'detalle', 'saldo',
];

export function sinAcentos(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Cuántas palabras clave distintas aparecen en el texto (para elegir rotación). */
export function puntajeTexto(texto) {
  const t = sinAcentos(texto).toLowerCase();
  let n = 0;
  for (const k of CLAVES) if (t.includes(k)) n++;
  return n;
}

/** Normaliza una palabra de tesseract a nuestro formato plano. */
function palabra(w) {
  return {
    text: w.text,
    conf: w.confidence,
    x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1,
  };
}

/**
 * Orden sugerido de rotaciones a probar, según la proyección de tinta:
 * texto horizontal => las filas alternan mucho entre tinta y blanco.
 */
export function ordenRotaciones(canvas, env, ultima) {
  const w = canvas.width, h = canvas.height;
  const data = env.getPixels(canvas);
  const filas = new Float64Array(h), cols = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (g < 140) { filas[y]++; cols[x]++; }
    }
  }
  const cv = (a) => {
    let m = 0; for (const v of a) m += v; m /= a.length || 1;
    if (!m) return 0;
    let s = 0; for (const v of a) s += (v - m) * (v - m);
    return Math.sqrt(s / a.length) / m;
  };
  const horizontal = cv(filas) >= cv(cols); // true: la orientación actual ya es horizontal
  return { horizontal, cvF: cv(filas), cvC: cv(cols) };
}

async function renderizar(page, escala, rotacion, env) {
  const base = page.rotate || 0;
  const viewport = page.getViewport({ scale: escala, rotation: (base + rotacion) % 360 });
  const canvas = env.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvasFactory: env.canvasFactory }).promise;
  return canvas;
}

/**
 * OCR de una página. `env`:
 *  - createCanvas(w,h), getPixels(canvas) -> Uint8ClampedArray RGBA, toImage(canvas)
 *  - worker: worker de tesseract ya inicializado
 *  - hint: rotación que funcionó en la página anterior
 * Devuelve { words, text, rotacion, escala, ancho, alto, puntaje }.
 */
export async function ocrPagina(page, env, opciones = {}) {
  const escalaPrueba = opciones.escalaPrueba ?? 1.4;
  const escala = opciones.escala ?? 3.2;
  const hint = opciones.hint ?? 0;

  // 1) vista previa chica para decidir la orientación
  const prev = await renderizar(page, escalaPrueba, 0, env);
  const { horizontal } = ordenRotaciones(prev, env);
  const candidatos = horizontal ? [0, 180, 90, 270] : [90, 270, 0, 180];
  // si la página anterior usó una rotación compatible, probarla primero
  const orden = candidatos.includes(hint) && (hint === candidatos[0] || hint === candidatos[1])
    ? [hint, ...candidatos.filter((r) => r !== hint)] : candidatos;

  let mejor = { rot: orden[0], puntaje: -1 };
  for (const rot of orden) {
    const c = rot === 0 ? prev : await renderizar(page, escalaPrueba, rot, env);
    const r = await env.worker.recognize(env.toImage(c));
    const p = puntajeTexto(r.data.text);
    if (p > mejor.puntaje) mejor = { rot, puntaje: p };
    if (p >= 5) break;            // suficientemente claro
    if (p >= 3 && orden.indexOf(rot) >= 1) break;
  }

  // 2) OCR a resolución completa con la rotación elegida
  const canvas = await renderizar(page, escala, mejor.rot, env);
  const r = await env.worker.recognize(env.toImage(canvas));
  return {
    words: (r.data.words || []).filter((w) => w.text && w.text.trim()).map(palabra),
    text: r.data.text,
    rotacion: mejor.rot,
    escala,
    ancho: canvas.width,
    alto: canvas.height,
    puntaje: mejor.puntaje,
  };
}
