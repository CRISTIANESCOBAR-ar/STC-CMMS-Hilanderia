import { collection, query, where, getDocs, Timestamp, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export const aiService = {
  /**
   * Obtiene las novedades creadas en un día específico y las envía a Gemini para generar un resumen ejecutivo.
   * @param {boolean} force - Si es true, ignora el caché y vuelve a generar el reporte con IA.
   * @param {string} targetDate - Fecha objetivo tipo 'YYYY-MM-DD'. Si es nula, por defecto usa "ayer".
   */
  async generarResumenDiario(force = false, targetDate = null) {
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
      const cacheRef = doc(db, 'ai_summaries', fechaStr);

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
      const novedadesList = [];
      snapshot.forEach(doc => novedadesList.push({ id: doc.id, ...doc.data() }));

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
  }
};
