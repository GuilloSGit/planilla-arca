// Fixtures SINTÉTICOS (números inventados, sin datos reales). Imitan lo que devuelve el OCR.
// Plan de 4 cuotas: 1 y 2 pagas (la 2 con 4 filas), 3 impaga, 4 impaga con vencimiento posterior al cierre.
// Capital combinado (aparece solo en la primera fila de cada cuota), igual que en los reportes de ARCA.
export const ENCABEZADO = `CUIT: 30111111112 Nombre y Apellido: EMPRESA DE PRUEBA S. A.,
Fh. de Consolidación: 13/02/2026 Número de Plan: X000001
Cuota N* Capital($) Interés Financiero($) Interés Resarcitorio($) Total($) Fecha Venc. Pago Estado de Cuota`;

export const FILAS = `1 400.000,00 100.000,00 0,00 500.000,00 16/03/2026 [o] Cuota Cancelada
100.000,00 5.000,00 505.000,00 26/03/2026 [o]
100.000,00 30.000,00 530.000,00 14/05/2026 Pago
2 410.000,00 90.000,00 0,00 500.000,00 16/04/2026 [o] Cuota Cancelada
90.000,00 5.000,00 505.000,00 26/04/2026 [o]
90.000,00 31.000,00 531.000,00 12/06/2026 [o]
90.000,00 32.500,00 532.500,00 16/06/2026 Pago
3 420.000,00 80.000,00 0,00 500.000,00 16/09/2026 [o] Cuota Impaga
80.000,00 4.000,00 504.000,00 26/09/2026 [o]
4 430.000,00 70.000,00 0,00 500.000,00 16/11/2026 [o] Cuota Impaga
70.000,00 4.000,00 504.000,00 26/11/2026 [o]`;

// pie coherente: capital 810.000 + financiero 190.000 + resarcitorio 62.500 = 1.062.500
export const PIE_OK = 'Total Pagado: $ 810.000,00 $ 190.000,00 $ 62.500,00 $ 1.062.500,00';
export const PIE_MAL = 'Total Pagado: $ 810.000,00 $ 190.000,00 $ 61.000,00 $ 1.061.000,00';

export const texto = (pie = PIE_OK, filas = FILAS) => `${ENCABEZADO}\n${filas}\n${pie}`;
