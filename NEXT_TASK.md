# NEXT_TASK — Prompt para la próxima sesión

Última actualización: 2026-11-19

```
Proyecto: planilla-arca (~/Projects/planilla-arca). Web estática (GitHub Pages) que convierte PDF de «Mis Facilidades» (ARCA)
en Excel. Todo en el navegador, sin backend, sin IA (OCR = tesseract.js + reglas fijas). Repo GuilloSGit/planilla-arca (público).

ESTADO: publicada en https://guillosgit.github.io/planilla-arca/ (repo GuilloSGit/planilla-arca). npm test: 38 OK. Probada en Chromium con PDF
sintético (carga, OCR, edición a mano, exportación).

COMPLETADO: parser.js, ocr.js, export.js (ExcelJS), app.js/index.html/styles.css, vendor/ (libs + spa.traineddata.gz), tests, tools/,
favicon y metadatos, README, y EDICIÓN A MANO de importes/fechas/pie/fila de pago/estado (parser.js: corregirCampo + revalidarPlan;
celestes en pantalla y Excel; registro de correcciones en la hoja Notas; persiste con IndexedDB porque se guarda en el reporte). Con los 62 PDF reales (tests/local/ocr, ignorado por git) los 6 planes de referencia dan suma = pie.

PRÓXIMAS PRIORIDADES:
1. Probar con la carpeta real en el navegador (Chrome, Safari, Firefox): carga de ~80 PDF, de un .zip, tiempos, celdas amarillas.
2. Verificar el sitio publicado en https://guillosgit.github.io/planilla-arca/ (Console sin errores).
3. Si hace falta: agregar/borrar filas o cuotas a mano (hoy solo se corrige lo leído).
4. Decidir licencia (hoy UNLICENSED; el usuario no eligió).
5. Revisar a mano saldos de obligaciones (U991298, W789172): son una estimación.

CONTEXTO TÉCNICO / DECISIONES YA TOMADAS (no re-discutir):
- ExcelJS y no SheetJS: SheetJS Community no escribe estilos.
- V700890: NO hay diferencia de 1.082,98. La planilla de otro soft (planilla_planes_ARCA.xlsx) se equivocó (tomó la fila 12/06 en la
  cuota 2). El PDF y el pie confirman la lectura de la app. 113/118 cuotas coinciden con esa planilla; tools/comparar.mjs la compara.
- U858642 es plan propio (consolidación 11/07/2025, pie 1.292.489,65); hay dos grupos de archivos con ese nombre (2 vs 3 espacios).
- Parser trabaja en centavos; el OCR a veces parte importes («596. 133,69») y los une marcándolos amarillos; nunca inventa datos.
- Datos reales: ~/Desktop/planilla-pdfs/ (cliente CELLARA). NUNCA al repo (.gitignore: *.pdf *.xlsx *.zip tests/local/).
- Antes de cada push: git ls-files | grep -Eci '\.(pdf|xlsx|zip)$|tests/local/' debe dar 0.
- Sin Co-Authored-By de Claude en commits.
- Herramientas: node tools/ocr-folder.mjs <carpeta>, verificar.mjs, comparar.mjs, exportar-local.mjs + recalcular.mjs.
- Archivos a leer primero: README.md, parser.js (reglas), export.js (columnas), tests/*.test.js.
```
