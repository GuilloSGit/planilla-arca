// Uso: node tools/exportar-local.mjs <salida.xlsx> [carpeta-ocr]
import fs from 'node:fs'; import path from 'node:path'; import ExcelJS from 'exceljs';
import { parseReporte, consolidar } from '../parser.js'; import { generarXlsx } from '../export.js';
const [out, dir = 'tests/local/ocr'] = process.argv.slice(2);
const items = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { const j = JSON.parse(fs.readFileSync(path.join(dir, f))); return { archivo: j.archivo, reporte: parseReporte(j.paginas, j.archivo) }; });
fs.writeFileSync(out, Buffer.from(await generarXlsx(ExcelJS, consolidar(items))));
console.log('escrito', out);
