// Copia las librerías del navegador desde node_modules a /vendor (se commitea para que GitHub Pages funcione sin build).
import fs from 'node:fs'; import path from 'node:path';
const nm = 'node_modules'; const out = 'vendor';
const m = {
  'pdfjs-dist/build/pdf.min.js': 'pdf.min.js', 'pdfjs-dist/build/pdf.worker.min.js': 'pdf.worker.min.js',
  'tesseract.js/dist/tesseract.min.js': 'tesseract.min.js', 'tesseract.js/dist/worker.min.js': 'tesseract-worker.min.js',
  'tesseract.js-core/tesseract-core-simd-lstm.wasm.js': 'tesseract-core-simd-lstm.wasm.js',
  'tesseract.js-core/tesseract-core-lstm.wasm.js': 'tesseract-core-lstm.wasm.js',
  'exceljs/dist/exceljs.min.js': 'exceljs.min.js', 'jszip/dist/jszip.min.js': 'jszip.min.js',
};
fs.mkdirSync(out, { recursive: true });
for (const [src, dst] of Object.entries(m)) fs.copyFileSync(path.join(nm, src), path.join(out, dst));
console.log('vendor listo (spa.traineddata.gz se descarga aparte: ver README)');
