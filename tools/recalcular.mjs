// Uso: node tools/recalcular.mjs <archivo.xlsx>
// Recalcula TODAS las fórmulas con HyperFormula y las compara con los valores guardados en el archivo.
import ExcelJS from 'exceljs'; import { HyperFormula } from 'hyperformula';
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(process.argv[2]);
const sheets = {}; const cache = [];
for (const ws of wb.worksheets) {
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    row.eachCell({ includeEmpty: false }, (cell, cn) => {
      rows[rn - 1] ??= [];
      let v = cell.value;
      if (v && typeof v === 'object' && 'formula' in v) { cache.push({ s: ws.name, r: rn - 1, c: cn - 1, res: v.result }); v = '=' + v.formula; }
      else if (v instanceof Date) v = Math.round(v.getTime() / 86400000) + 25569;
      rows[rn - 1][cn - 1] = v;
    });
  });
  sheets[ws.name] = Array.from(rows, (r) => r || []);
}
const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
let mal = 0;
for (const x of cache) {
  const id = hf.getSheetId(x.s); const v = hf.getCellValue({ sheet: id, row: x.r, col: x.c });
  const res = x.res === undefined ? 0 : x.res; const ok = typeof res === 'number' && typeof v === 'number' ? Math.abs(v - res) < 0.005 : String(v) === String(res);
  if (!ok) { mal++; if (mal < 15) console.log('DIFIERE', x.s, 'fila', x.r + 1, 'col', x.c + 1, 'guardado=', x.res, 'recalculado=', v); }
}
console.log(`${cache.length} fórmulas, ${mal} con diferencias`);
