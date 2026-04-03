/**
 * Motivos de intervención por tipo de máquina + tipo de problema.
 * Basado en los manuales BENNINGER (Diálogo INDIGO, Plegadora S800, S150, etc.)
 * y en el conocimiento de cada proceso textil.
 *
 * Estructura: MOTIVOS_POR_TIPO[tipo][tipoProblema] → string[]
 *   tipo        → coincide con el campo `tipo` en Firestore (mayúsculas)
 *   tipoProblema → 'Mecánico' | 'Eléctrico'
 */
export const MOTIVOS_POR_TIPO = {

  // ── APERTURA ────────────────────────────────────────────────────────────────
  // Basado en manuales Trutzschler BO-A / CL-C3 / BR-F/FD / FD-S / FD-T
  APERTURA: {
    'Mecánico': [
      // ★ Más frecuentes
      'ATASCO / OBSTRUCCIÓN DUCTO ASPIRACIÓN',
      'ROTURA CORREA TRAPEZOIDAL',
      'DESGASTE PALETA VENTILADOR',
      'FALLA BARRERA DE LUZ',
      'ROTURA CABLE ELEVACIÓN (BO-A)',
      // Otros mecánicos
      'ROTURA CADENA RODILLOS',
      'AJUSTE TENSIÓN CORREA',
      'DESGASTE TIRA ESTANQUIDAD',
      'ROTURA CADENA TRANSPORTE BALAS',
      'FALLA RODILLO EXTRACTOR',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      // ★ Más frecuentes
      'DISPARO TÉRMICO MOTOR',
      'ERROR VARIADOR',
      'FALLA BARRERA DE LUZ',
      // Otros eléctricos
      'FALLA MÓDULO MEMORIA / EEPROM',
      'CAMBIO FUSIBLE ARMARIO',
      'CAMBIO PILA ZPB4',
      'FALLA SENSOR PRESENCIA BALA',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },

  // ── CARDA ───────────────────────────────────────────────────────────────────
  CARDA: {
    'Mecánico': [
      // ★ Más frecuentes
      'ROTURA GUARNICIÓN TAMBOR',
      'DESGASTE CHAPONES',
      'ROTURA CINTA',
      'ATASCO LICKER-IN',
      'ROTURA CORREA DENTADA',
      // Otros mecánicos
      'DESGASTE GUARNICIÓN DOFFER',
      'FALLA APILADORA CBA',
      'DESAJUSTE GALGA CHAPÓN/TAMBOR',
      'DESGASTE RODILLOS CALANDRA',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      // ★ Más frecuentes
      'ERROR VARIADOR TAMBOR',
      'DISPARO TÉRMICO MOTOR',
      'FALLA AUTOLEVELER',
      // Otros eléctricos
      'FALLA SENSOR CINTA (ITOR)',
      'ALARMA VELOCIDAD TAMBOR',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },

  // ── MANUAR ──────────────────────────────────────────────────────────────────
  MANUAR: {
    'Mecánico': [
      'ROTURA DE CINTA',
      'DESGASTE CILINDROS ESTIRAJE',
      'ATASCO DE FIBRA',
      'ROTURA DE CORREA',
      'DESAJUSTE ESTIRAJE',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      'DISPARO TÉRMICO MOTOR',
      'ERROR DE VARIADOR',
      'FALLA SENSOR PESO CINTA',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },

  // ── OPEN END ─────────────────────────────────────────────────────────────────
  'OPEN END': {
    'Mecánico': [
      'DESGASTE DE ROTOR',
      'DESGASTE ABERTURA',
      'ATASCO DE FIBRA',
      'ROTURA DE CORREA',
      'FALLA TOBERA',
      'DESGASTE DE COJINETES',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      'DISPARO TÉRMICO MOTOR',
      'ERROR DE VARIADOR',
      'FALLA SENSOR ROTURA HILO',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },

  // ── FILTRO ──────────────────────────────────────────────────────────────────
  FILTRO: {
    'Mecánico': [
      'OBSTRUCCIÓN DE FILTRO',
      'ROTURA MANGA FILTRANTE',
      'FUGA DE DUCTO',
      'DESGASTE DE VENTILADOR',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      'DISPARO TÉRMICO MOTOR',
      'SENSOR DE PRESIÓN',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },

  // ── URDIDORA ─────────────────────────────────────────────────────────────────
  URDIDORA: {
    'Mecánico': [
      'ROTURA DE HILO',
      'FALLA SISTEMA TENSIÓN',
      'DESGASTE DE CILINDROS',
      'DESAJUSTE DE PEINE',
      'ROTURA DE CORREA',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      'ERROR DE VARIADOR',
      'FALLA SENSOR TENSIÓN',
      'FALLA DE ENCODER',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },

  // ── INDIGO ───────────────────────────────────────────────────────────────────
  // (Manuales BENNINGER: Diálogo INDIGO, Plegadora S800, Acumulador S150, etc.)
  INDIGO: {
    'Mecánico': [
      'FUGA SELLO MECÁNICO',
      'PÉRDIDA DE PRESIÓN',
      'OBSTRUCCIÓN DE FILTRO',
      'FUGA CILINDRO NEUMÁTICO',
      'ROTURA / ALARG. CADENA',
      'DESGASTE GUARNICIÓN FRENO',
      'DESINCRONIZACIÓN CILINDRO',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      'ERROR DE VARIADOR',
      'ALARMA DE NIVEL',
      'DISPARO TERMOSTATO',
      'ERROR DE ENCODER',
      'FALLA COMUNICACIÓN BUS',
      'SENSOR FUERA DE RANGO',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },

  // ── TELAR ────────────────────────────────────────────────────────────────────
  TELAR: {
    'Mecánico': [
      'ROTURA DE URDIMBRE',
      'ROTURA DE TRAMA',
      'DESGASTE DE LEVA',
      'FALLA MECANISMO LIZOS',
      'DESGASTE DE PEINE',
      'FALLA SISTEMA DE FRENO',
      'DESAJUSTE TENSOR',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      'ERROR DE VARIADOR',
      'FALLA SENSOR TRAMA',
      'FALLA DE ENCODER',
      'DISPARO TÉRMICO MOTOR',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },

  // ── REVISADORA ───────────────────────────────────────────────────────────────
  REVISADORA: {
    'Mecánico': [
      'ROTURA DE CORREA',
      'DESGASTE DE CILINDROS',
      'FALLA SISTEMA TENSIÓN',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      'FALLA ILUMINACIÓN',
      'DISPARO TÉRMICO MOTOR',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },

  // ── MERCERIZADORA ─────────────────────────────────────────────────────────────
  MERCERIZADORA: {
    'Mecánico': [
      'FUGA DE LÍQUIDO',
      'OBSTRUCCIÓN BOQUILLAS',
      'DESGASTE CILINDROS',
      'FALLA BOMBA CIRCULACIÓN',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      'DISPARO TERMOSTATO',
      'ERROR DE VARIADOR',
      'SENSOR CONCENTRACIÓN',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },

  // ── INTEGRADA ─────────────────────────────────────────────────────────────────
  INTEGRADA: {
    'Mecánico': [
      'FUGA SELLO MECÁNICO',
      'OBSTRUCCIÓN DE FILTRO',
      'ROTURA / ALARG. CADENA',
      'DESGASTE CILINDROS',
      'FALLA BOMBA CIRCULACIÓN',
      'AJUSTE',
      'LIMPIEZA',
      'LUBRICACIÓN',
      'CAMBIO',
      'VERIFICACIÓN',
    ],
    'Eléctrico': [
      'ERROR DE VARIADOR',
      'DISPARO TERMOSTATO',
      'FALLA DE ENCODER',
      'VERIFICACIÓN ELÉCTRICA',
      'AJUSTE PARÁMETROS',
    ],
  },
};

/** Motivos genéricos para tipos sin definición específica o tipo 'OTRO' */
export const MOTIVOS_DEFAULT = {
  'Mecánico':  ['VERIFICACIÓN', 'LIMPIEZA', 'AJUSTE', 'LUBRICACIÓN', 'CAMBIO'],
  'Eléctrico': ['VERIFICACIÓN ELÉCTRICA', 'AJUSTE PARÁMETROS', 'LIMPIEZA', 'CAMBIO'],
};

/**
 * Devuelve la lista de motivos para el tipo + problema dados.
 * @param {string} tipo       - Tipo de máquina (ej. 'INDIGO', 'TELAR')
 * @param {string} problema   - 'Mecánico' | 'Eléctrico'
 * @returns {string[]}
 */
export function getMotivos(tipo, problema) {
  return MOTIVOS_POR_TIPO[tipo]?.[problema]
    ?? MOTIVOS_DEFAULT[problema]
    ?? MOTIVOS_DEFAULT['Mecánico'];
}
