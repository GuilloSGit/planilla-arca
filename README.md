# Planilla ARCA

Convierte los PDF descargados de **Mis Facilidades (ARCA)** en una planilla Excel con el resumen por plan, el detalle de cuotas y las notas de control.

- **Todo corre en tu navegador.** No hay servidor ni backend: los PDF y los resultados no salen de tu computadora.
- **Sin IA.** El OCR es [tesseract.js](https://github.com/naptha/tesseract.js) (idioma español) y el resto son reglas fijas y controles aritméticos.
- Funciona en Chrome, Edge, Firefox y Safari (Mac y Windows). Sitio estático: HTML + JavaScript + CSS, sin build.

## Cómo usarla

1. Abrí el sitio (ver «Activar GitHub Pages»).
2. Arrastrá los PDF (o un `.zip` con ellos). El OCR de ~80 PDF tarda varios minutos: dejá la pestaña abierta.
3. Revisá cada plan en la tabla. Clic en un plan para ver sus cuotas fila por fila, con la fila «Pago» marcada.
   - **Rojo**: diferencias y totales que no cierran. **Amarillo**: celdas que el OCR leyó con baja confianza o no pudo leer → contrastar con el PDF.
   - Completá **Fecha de pago real** de cada cuota paga (los PDF solo informan el vencimiento con el que se aplicó el pago).
4. **Exportar Excel.** Si hay planes con alertas críticas pide confirmación; las alertas quedan en la hoja «Notas».
5. Opcional: «Guardar resultados» los deja en IndexedDB de ese navegador. Por defecto todo queda en memoria.

### Qué trae el Excel

| Hoja | Contenido |
|---|---|
| **Resumen por plan** | Una fila por plan: cuotas, pagas, impagas; pagado en el **ejercicio cerrado** (capital, financiero, resarcitorio, total) y en ejercicios anteriores; control contra el pie de ARCA (columna **Diferencia**); **deuda que pasa al próximo ejercicio** (capital, financiero, resarcitorio). Fila de totales. Todo con `COUNTIFS`/`SUMIFS`/`SUM` sobre la hoja de detalle. |
| **Detalle cuotas** | Una fila por cuota con capital, financiero, estado, fecha de vencimiento con la que se pagó, fecha de pago real, ejercicio, resarcitorio pagado, total pagado y pendientes. Las columnas calculadas son fórmulas. Filtrá por «Pagada» para registrar cada pago con su fecha e intereses. |
| **Notas** | Parámetros del ejercicio (01/11/2025 – 31/10/2026, editables: las fórmulas los leen), supuestos y todas las alertas. |

Arial, `#,##0.00` con negativos entre paréntesis, fechas `dd/mm/yyyy`. En pantalla los números van en formato argentino (1.234.567,89); en Excel son números.

## Reglas que aplica

- Cuota paga: fila con «Pago» o estado «Cuota Cancelada». La fecha de esa fila es el vencimiento aplicado, **no** la fecha real de pago.
- Total de cada fila = capital + financiero + resarcitorio; si no, alerta.
- Suma de cuotas pagas vs. pie «Total Pagado» del reporte: si no coincide, se muestra la diferencia (nunca se corrige en silencio).
- Deuda pendiente = capital + financiero de las impagas + resarcitorio del último vencimiento ≤ 31/10/2026 (0 si no hay).
- Siempre se usa el número de plan que figura **dentro** del PDF (se avisa si el nombre no coincide). Con varias versiones, sufijo más alto (.3 > .2 > sin sufijo); duplicados exactos se ignoran. «caduco» se toma del nombre del archivo.
- Archivos de «Obligaciones» / «Detalle de deuda impaga»: se informan como obligaciones sin cuotas, con un saldo estimado **siempre a verificar a mano**.
- Lo que el OCR no puede leer queda en blanco y marcado; no se inventa.

## Activar GitHub Pages

1. Subí el repo a GitHub (público).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, carpeta `/ (root)`. Guardar.
3. En un minuto queda en `https://<usuario>.github.io/planilla-arca/`.

Las librerías (pdf.js, tesseract.js y su modelo de español, ExcelJS, JSZip) están en `/vendor`, así que no depende de ningún CDN. No hace falta build.
Para probar local hay que servirlo por HTTP (los módulos ES no cargan desde `file://`), por ejemplo `python3 -m http.server` y abrir `http://localhost:8000`.

## Desarrollo

```bash
npm install
npm test                      # tests del parser y del export (fixtures sintéticos)
npm run vendor                # recopia las librerías a /vendor
node tools/ocr-folder.mjs <carpeta-con-pdf>      # OCR en Node → tests/local/ocr (ignorado por git)
node tools/verificar.mjs                          # totales vs valores de referencia
node tools/comparar.mjs <otra-planilla.xlsx>      # compara cuota por cuota contra otra planilla
node tools/exportar-local.mjs salida.xlsx && node tools/recalcular.mjs salida.xlsx   # verifica las fórmulas
```

`tests/local/` está en `.gitignore`: ahí van los datos reales. El repo no contiene PDF, Excel ni ZIP (`.gitignore` los excluye).
`vendor/spa.traineddata.gz` (modelo `tessdata_fast` de español) se baja de `https://tessdata.projectnaptha.com/4.0.0_fast/spa.traineddata.gz`.

## Estructura

`index.html` · `app.js` (interfaz) · `ocr.js` (render, rotación y OCR) · `parser.js` (texto → planes y cuotas) · `export.js` (Excel) · `styles.css` · `tests/` · `tools/` · `vendor/`

## Límites conocidos

- El OCR puede equivocarse: por eso están los controles contra el pie y las celdas amarillas. Los importes mal leídos todavía no se pueden corregir desde la pantalla (solo la fecha de pago real).
- Se usa ExcelJS y no SheetJS para exportar, porque SheetJS Community no escribe estilos (Arial, celdas amarillas).
