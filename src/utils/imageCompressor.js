/**
 * Comprime una imagen usando createImageBitmap (baja RAM) con fallback a Canvas
 * @param {File|Blob} file - El archivo original
 * @param {Object} options - Opciones de compresión (maxWidth, quality)
 * @returns {Promise<File>} - El archivo comprimido
 */
export const compressImage = async (file, { maxWidth = 1024, quality = 0.7 } = {}) => {
  // Intentar ruta eficiente: createImageBitmap escala en decode nativo sin cargar toda la imagen en RAM
  if (typeof createImageBitmap === 'function') {
    try {
      // Primer paso: obtener dimensiones originales con bitmap mínimo
      const probeBitmap = await createImageBitmap(file);
      const origW = probeBitmap.width;
      const origH = probeBitmap.height;
      probeBitmap.close();

      let targetW = origW;
      let targetH = origH;
      if (origW > maxWidth) {
        targetH = Math.round((origH * maxWidth) / origW);
        targetW = maxWidth;
      }

      // Segundo paso: decodificar + escalar en un solo paso nativo (bajo consumo de RAM)
      const bitmap = await createImageBitmap(file, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'medium',
      });

      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      return new File([blob], file.name || 'photo.jpg', { type: 'image/jpeg', lastModified: Date.now() });
    } catch {
      // Si falla (ej: OffscreenCanvas no disponible), caer al método clásico
    }
  }

  // Fallback: método clásico con Image + Canvas (más uso de RAM)
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(img.src);

      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Canvas to Blob failed')); return; }
          resolve(new File([blob], file.name || 'photo.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = (err) => reject(err);
  });
};

/**
 * Convierte bytes a una cadena legible (KB/MB)
 */
export const formatSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
