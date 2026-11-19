// Uso: node tools/ocr-folder.mjs <carpeta-con-pdfs> [salida=tests/local/ocr] [--only=texto]
// Hace OCR de cada PDF con el mismo pipeline que el navegador y guarda un JSON por archivo.
// La salida queda en tests/local/ (ignorada por git: son datos reales).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as napi from '@napi-rs/canvas';
const { createCanvas } = napi;
globalThis.DOMMatrix ??= napi.DOMMatrix;
globalThis.Path2D ??= napi.Path2D;
globalThis.ImageData ??= napi.ImageData;
import { ocrPagina } from '../ocr.js';

const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const Tesseract = require('tesseract.js');
const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const pos = args.filter((a) => !a.startsWith('--'));
const carpeta = pos[0];
const salida = pos[1] || path.join(raiz, 'tests/local/ocr');
const nWorkers = Math.max(1, Math.min(os.cpus().length - 1, 6));
fs.mkdirSync(salida, { recursive: true });

class NodeCanvasFactory {
  create(w, h) { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext('2d') }; }
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; }
}
const canvasFactory = new NodeCanvasFactory();

async function nuevoWorker() {
  return Tesseract.createWorker('spa', 1, {
    langPath: path.join(raiz, 'vendor'), gzip: true, cacheMethod: 'none',
  });
}

const archivos = fs.readdirSync(carpeta).filter((f) => /\.pdf$/i.test(f) && f.includes(only)).sort();
console.log(`${archivos.length} PDF, ${nWorkers} workers`);
let idx = 0;
async function proceso(n) {
  const worker = await nuevoWorker();
  const env = {
    worker, canvasFactory,
    createCanvas: (w, h) => createCanvas(w, h),
    getPixels: (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data,
    toImage: (c) => c.toBuffer('image/png'),
  };
  while (idx < archivos.length) {
    const nombre = archivos[idx++];
    const destino = path.join(salida, nombre.replace(/\.pdf$/i, '.json'));
    if (fs.existsSync(destino)) continue;
    const t0 = Date.now();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(carpeta, nombre))), canvasFactory, useSystemFonts: true }).promise;
    const paginas = [];
    let hint = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const r = await ocrPagina(page, env, { hint });
      hint = r.rotacion;
      paginas.push(r);
    }
    fs.writeFileSync(destino, JSON.stringify({ archivo: nombre, paginas }));
    console.log(`[w${n}] ${nombre} — ${doc.numPages} pág, ${((Date.now() - t0) / 1000).toFixed(1)}s, rot=${paginas.map((p) => p.rotacion).join(',')}`);
  }
  await worker.terminate();
}
await Promise.all(Array.from({ length: nWorkers }, (_, i) => proceso(i)));
console.log('listo');
