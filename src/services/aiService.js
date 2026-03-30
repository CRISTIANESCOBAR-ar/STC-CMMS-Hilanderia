import { collection, query, where, getDocs, Timestamp, doc, getDoc, setDoc, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { normalizeSectorValue } from '../constants/organization';

// Filtra un array por sectores visibles
const filtrarPorSector = (items, sectores) => {
  if (!sectores || sectores.length === 0) return items;
  return items.filter(item => {
    const s = normalizeSectorValue(item.sector || 'HILANDERIA');
    return sectores.includes(s);
  });
};

export const aiService = {
  /**
   * Obtiene las novedades creadas en un día específico y las envía a Gemini para generar un resumen ejecutivo.
   * @param {boolean} force - Si es true, ignora el caché y vuelve a generar el reporte con IA.
   * @param {string} targetDate - Fecha objetivo tipo 'YYYY-MM-DD'. Si es nula, por defecto usa "ayer".
   * @param {string[]|null} sectores - Sectores a incluir (null = todos).
   */
  async generarResumenDiario(force = false, targetDate = null, sectores = null) {
    try {
      const fechaObjetivo = targetDate ? new Date(targetDate + 'T00:00:00') : new Date();
      if (!targetDate) {
        fechaObjetivo.setDate(fechaObjetivo.getDate() - 1);
      }
      
      const inicioDia = new Date(fechaObjetivo);
      inicioDia.setHours(0, 0, 0, 0);
      
      const finDia = new Date(fechaObjetivo);
      finDia.setDate(finDia.getDate() + 1);
      finDia.setHours(0, 0, 0, 0);

      // Usamos la fecha como ID del documento de caché (ej: "2026-03-17")
      // Extraemos YYYY-MM-DD respetando zona horaria local
      const yyyy = inicioDia.getFullYear();
      const mm = String(inicioDia.getMonth() + 1).padStart(2, '0');
      const dd = String(inicioDia.getDate()).padStart(2, '0');
      const fechaStr = `${yyyy}-${mm}-${dd}`;
      const sectorSuffix = sectores ? `_${sectores.sort().join('-')}` : '';
      const cacheRef = doc(db, 'ai_summaries', fechaStr + sectorSuffix);

      // 1. Verificar caché si no estamos forzando regeneración
      if (!force) {
        const cacheSnap = await getDoc(cacheRef);
        if (cacheSnap.exists()) {
          return {
            fromCache: true,
            text: cacheSnap.data().resumen
          };
        }
      }

      // 2. Obtener novedades del día objetivo
      const q = query(
        collection(db, 'novedades'),
        where('createdAt', '>=', Timestamp.fromDate(inicioDia)),
        where('createdAt', '<', Timestamp.fromDate(finDia))
      );

      const snapshot = await getDocs(q);
      let novedadesList = [];
      snapshot.forEach(doc => novedadesList.push({ id: doc.id, ...doc.data() }));

      // Filtrar por sector
      novedadesList = filtrarPorSector(novedadesList, sectores);

      if (novedadesList.length === 0) {
        return {
          fromCache: false,
          text: `No hubo reportes registrados en la fecha ${fechaStr}. ¡Excelente trabajo preventivo u operarios descansando! ✅`
        };
      }

      // 3. Formatear datos para la IA
      const datosParaIA = novedadesList.map(n => ({
        maquina: n.numeroMaquina,
        tipo: n.tipoMaquina,
        problema: n.observaciones,
        estado: n.estado,
        critico: n.critico,
        rubro: n.tipoProblema || 'Mecánico',
      }));

      const opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const fechaAyerFormateada = inicioDia.toLocaleDateString('es-ES', opcionesFecha);
      const fechaHoyFormateada = new Date().toLocaleString('es-ES');

      // 4. Llamada a Gemini (requiere API KEY en import.meta.env.VITE_GEMINI_API_KEY)
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        return {
          fromCache: false,
          text: `⚠️ Por favor configura 'VITE_GEMINI_API_KEY' en tu archivo .env para habilitar el análisis de Inteligencia Artificial.\n\nDatos recuperados de (${datosParaIA.length} novedades):\n${JSON.stringify(datosParaIA, null, 2)}`
        };
      }

      const prompt = `
        Eres un experto Planificador de Mantenimiento Industrial. Analiza el siguiente log de fallas ocurridas en la planta.
        
        Tu tarea es generar un reporte ejecutivo, atractivo y listo para ser copiado y enviado directamente por WhatsApp a los supervisores.
        
        REGLAS DE FORMATO (ESTRICTAS Y OBLIGATORIAS PARA WHATSAPP):
        - Usa solo *asteriscos simples* alrededor del texto para hacer **negritas** (ej: *Máquina OPEN END*). ¡Nunca uses dobles asteriscos ** !
        - Usa emojis visuales y variados que impacten, como 🚨, 🔧, ⚡, 📈, 🛑, ✅.
        - Para fallas CRÍTICAS (critico: true), añade colores vivos (emojis rojos como 🔴 o 🚨) y usa mayúsculas para llamar la atención.
        - Usa viñetas claras (puedes usar el símbolo - o emojis descriptivos en lugar del guión clásico).
        
        CONTENIDO OBLIGATORIO:
        - Inicia el mensaje con un título claro indicando el día analizado: "Análisis del Día (${fechaAyerFormateada})".
        - Añade un subtítulo pequeño con la fecha/hora de generación: "(Reporte generado el ${fechaHoyFormateada})".
        - Clasifica ágilmente los problemas encontrados (Mecánicos 🔧 vs Eléctricos ⚡).
        - Detecta máquinas o tipos de máquina repetidas (cuellos de botella).
        - Provee un plan de acción directo de 2-3 puntos accionables para el equipo.
        
        Registro de fallas de la jornada:
        ${JSON.stringify(datosParaIA)}
      `;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) {
        throw new Error('Error al contactar con la IA');
      }

      const data = await response.json();
      const resumenGenerado = data.candidates[0].content.parts[0].text;

      // 5. Guardar en caché (Firestore)
      try {
        await setDoc(cacheRef, { 
          resumen: resumenGenerado,
          generadoEn: Timestamp.now()
        });
      } catch (err) {
        console.warn("No se pudo guardar la caché en Firestore (ver permisos):", err);
      }

      return {
        fromCache: false,
        text: resumenGenerado
      };

    } catch (error) {
      console.error("Error generando resumen IA:", error);
      throw error;
    }
  },

  /**
   * Genera un resumen ejecutivo semanal con análisis profundo de novedades + intervenciones.
   * Orientado a jefes y gerencia: identifica patrones, máquinas críticas y plan de acción.
   * @param {boolean} force - Si es true, regenera ignorando caché.
   * @param {number} dias - Días a analizar (default 7).
   * @param {string[]|null} sectores - Sectores a incluir (null = todos).
   */
  async generarResumenEjecutivo(force = false, dias = 7, sectores = null) {
    try {
      const ahora = new Date();
      const desde = new Date(ahora);
      desde.setDate(desde.getDate() - dias);
      desde.setHours(0, 0, 0, 0);

      const hasta = new Date(ahora);
      hasta.setHours(23, 59, 59, 999);

      const yyyy = ahora.getFullYear();
      const mm = String(ahora.getMonth() + 1).padStart(2, '0');
      const dd = String(ahora.getDate()).padStart(2, '0');
      const sectorSuffix = sectores ? `_${sectores.sort().join('-')}` : '';
      const cacheId = `exec_${yyyy}-${mm}-${dd}_${dias}d${sectorSuffix}`;
      const cacheRef = doc(db, 'ai_summaries', cacheId);

      if (!force) {
        const cacheSnap = await getDoc(cacheRef);
        if (cacheSnap.exists()) {
          return { fromCache: true, text: cacheSnap.data().resumen };
        }
      }

      // Novedades del período
      const qNovedades = query(
        collection(db, 'novedades'),
        where('createdAt', '>=', Timestamp.fromDate(desde)),
        where('createdAt', '<=', Timestamp.fromDate(hasta))
      );
      const snapNovedades = await getDocs(qNovedades);
      let novedades = filtrarPorSector(snapNovedades.docs.map(d => ({ id: d.id, ...d.data() })), sectores);

      // Intervenciones del período
      const qIntervenciones = query(
        collection(db, 'intervenciones'),
        where('createdAt', '>=', Timestamp.fromDate(desde)),
        where('createdAt', '<=', Timestamp.fromDate(hasta))
      );
      const snapIntv = await getDocs(qIntervenciones);
      let intervenciones = filtrarPorSector(snapIntv.docs.map(d => ({ id: d.id, ...d.data() })), sectores);

      if (novedades.length === 0 && intervenciones.length === 0) {
        return {
          fromCache: false,
          text: `No se registraron novedades ni intervenciones en los últimos ${dias} días. ✅`
        };
      }

      // Pre-procesar estadísticas
      const stats = {
        totalNovedades: novedades.length,
        novedadesPendientes: novedades.filter(n => n.estado === 'pendiente').length,
        novedadesEnProceso: novedades.filter(n => n.estado === 'en proceso').length,
        novedadesResueltas: novedades.filter(n => n.estado === 'resuelto').length,
        novedadesCriticas: novedades.filter(n => n.critico).length,
        mecanicas: novedades.filter(n => (n.tipoProblema || 'Mecánico') === 'Mecánico').length,
        electricas: novedades.filter(n => n.tipoProblema === 'Eléctrico').length,
        totalIntervenciones: intervenciones.length,
        intvPendientes: intervenciones.filter(i => i.estado === 'PENDIENTE').length,
        intvEnProceso: intervenciones.filter(i => i.estado === 'EN_PROCESO').length,
        intvCompletadas: intervenciones.filter(i => i.estado === 'COMPLETADO').length,
      };

      // Top máquinas con más problemas
      const maquinaCount = {};
      novedades.forEach(n => {
        const key = `${n.tipoMaquina || '?'} #${n.numeroMaquina || '?'}`;
        if (!maquinaCount[key]) maquinaCount[key] = { total: 0, criticos: 0, problemas: [] };
        maquinaCount[key].total++;
        if (n.critico) maquinaCount[key].criticos++;
        if (n.observaciones) maquinaCount[key].problemas.push(n.observaciones.substring(0, 80));
      });
      intervenciones.forEach(i => {
        const key = `${i.tipoMaquina || '?'} #${i.numeroMaquina || '?'}`;
        if (!maquinaCount[key]) maquinaCount[key] = { total: 0, criticos: 0, problemas: [] };
        maquinaCount[key].total++;
        if (i.descripcion) maquinaCount[key].problemas.push(i.descripcion.substring(0, 80));
      });

      const topMaquinas = Object.entries(maquinaCount)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([maq, data]) => ({
          maquina: maq,
          incidencias: data.total,
          criticos: data.criticos,
          problemas: [...new Set(data.problemas)].slice(0, 5)
        }));

      const detalleNovedades = novedades.map(n => ({
        maquina: n.numeroMaquina,
        tipo: n.tipoMaquina,
        problema: n.observaciones,
        estado: n.estado,
        critico: n.critico,
        rubro: n.tipoProblema || 'Mecánico',
        sector: n.sector || 'N/A',
      }));

      const detalleIntv = intervenciones.map(i => ({
        maquina: i.numeroMaquina,
        tipo: i.tipoMaquina,
        tipoIntervencion: i.tipoIntervencion,
        descripcion: i.descripcion || i.observaciones,
        estado: i.estado,
        sector: i.sector || 'N/A',
      }));

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        return {
          fromCache: false,
          text: `⚠️ Configura 'VITE_GEMINI_API_KEY' en .env para habilitar el análisis ejecutivo.\n\n${stats.totalNovedades} novedades y ${stats.totalIntervenciones} intervenciones en los últimos ${dias} días.`
        };
      }

      const opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const desdeStr = desde.toLocaleDateString('es-ES', opcionesFecha);
      const hastaStr = ahora.toLocaleDateString('es-ES', opcionesFecha);

      const prompt = `
Eres un experto Planificador de Mantenimiento Industrial en una planta textil (Santana Textiles).
Genera un INFORME EJECUTIVO SEMANAL listo para copiar y enviar por WhatsApp a los jefes de planta.
${sectores ? `\nSECTOR: ${sectores.join(', ')}` : '\nSECTOR: TODOS (Hilandería + Tejeduría)'}

PERÍODO ANALIZADO: ${desdeStr} al ${hastaStr} (${dias} días)

ESTADÍSTICAS DEL PERÍODO:
${JSON.stringify(stats, null, 2)}

TOP MÁQUINAS CON MÁS INCIDENCIAS:
${JSON.stringify(topMaquinas, null, 2)}

DETALLE DE NOVEDADES (fallas reportadas):
${JSON.stringify(detalleNovedades)}

DETALLE DE INTERVENCIONES (órdenes de trabajo):
${JSON.stringify(detalleIntv)}

REGLAS DE FORMATO (ESTRICTAS PARA WHATSAPP):
- Usa solo *asteriscos simples* para negritas (NUNCA dobles **).
- Usa emojis visuales: 🚨 🔧 ⚡ 📊 📈 🏭 ⚠️ ✅ 🔴 🟡 🟢 🎯 📋
- Viñetas con emojis o guión.
- Separa secciones con líneas en blanco.

ESTRUCTURA DEL INFORME (OBLIGATORIA):

1. *📊 RESUMEN EJECUTIVO SEMANAL* — Título con período.
2. *🔢 NÚMEROS CLAVE* — Total novedades, intervenciones, pendientes, completadas, % resolución, críticos.
3. *🚨 MÁQUINAS CRÍTICAS* — Top 3-5 máquinas más problemáticas con detalle de fallas y frecuencia. Destacar recurrentes.
4. *🔧 ANÁLISIS POR TIPO* — Desglose mecánico vs eléctrico. Identificar tipo dominante.
5. *⚠️ PATRONES DETECTADOS* — Fallas repetidas, máquinas recurrentes, posibles causas sistémicas. Ser específico con números de máquina.
6. *🎯 PLAN DE ACCIÓN PRIORITARIO* — 4-5 acciones concretas ordenadas por urgencia. Cada una debe decir: QUÉ hacer, EN QUÉ máquina, QUIÉN debería ejecutarlo (mecánicos/electricistas/supervisores), CUÁNDO (inmediato/esta semana/programar).
7. *📈 INDICADORES DE MEJORA* — Sugerencias para reducir recurrencia. Enfocado en mantenimiento preventivo.

TONO: Profesional y directo. Orientado a la acción. El jefe debe saber exactamente qué hacer hoy.
      `;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) throw new Error('Error al contactar con la IA');

      const data = await response.json();
      const resumenGenerado = data.candidates[0].content.parts[0].text;

      try {
        await setDoc(cacheRef, {
          resumen: resumenGenerado,
          generadoEn: Timestamp.now(),
          periodo: dias,
          stats
        });
      } catch (err) {
        console.warn("No se pudo guardar caché ejecutivo:", err);
      }

      return { fromCache: false, text: resumenGenerado };

    } catch (error) {
      console.error("Error generando resumen ejecutivo:", error);
      throw error;
    }
  }
};
