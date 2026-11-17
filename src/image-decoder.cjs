'use strict';

// This pure browser function runs only in OVJ's local settings renderer. It
// decodes WebP via Chromium because nativeImage supports PNG/JPEG only.
function decodeWebPInBrowser(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(new Error('La imagen tardó demasiado en decodificarse.')), 10000);
    image.onerror = () => { clearTimeout(timer); reject(new Error('No se pudo decodificar la imagen WebP.')); };
    image.onload = () => {
      clearTimeout(timer);
      try {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('Imagen inválida o mayor que 4096 × 4096 píxeles.');
        const factor = Math.min(1, 256 / width, 256 / height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * factor));
        canvas.height = Math.max(1, Math.round(height * factor));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) { reject(error); }
    };
    image.src = dataUrl;
  });
}

function webPDecoderSource(buffer) {
  return `(${decodeWebPInBrowser.toString()})(${JSON.stringify('data:image/webp;base64,' + buffer.toString('base64'))})`;
}

module.exports = { webPDecoderSource };
