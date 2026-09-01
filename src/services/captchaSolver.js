const Jimp = require('jimp');
const { createWorker, PSM } = require('tesseract.js');

let worker = null;

/**
 * Initialize or get cached Tesseract OCR Worker
 */
async function getWorker() {
  if (!worker) {
    worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyz0123456789',
      tessedit_pageseg_mode: PSM.SINGLE_WORD,
    });
  }
  return worker;
}

/**
 * Multi-pass image preprocessor for Kemensos DTSEN captcha
 * @param {Buffer} imageBuffer 
 * @param {number} thresholdVal 
 * @returns {Promise<Buffer>}
 */
async function preprocessCaptcha(imageBuffer, thresholdVal = 180) {
  const img = await Jimp.read(imageBuffer);
  const w = img.bitmap.width;
  const h = img.bitmap.height;

  // 1. Inpaint & remove magenta lines
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = img.bitmap.data[idx + 0];
      const g = img.bitmap.data[idx + 1];
      const b = img.bitmap.data[idx + 2];

      const isMagenta = (r - g > 50) && (b - g > 50);

      if (isMagenta) {
        let topBrightness = 255;
        let botBrightness = 255;
        if (y > 2) {
          const tIdx = ((y - 2) * w + x) * 4;
          topBrightness = (img.bitmap.data[tIdx] + img.bitmap.data[tIdx + 1] + img.bitmap.data[tIdx + 2]) / 3;
        }
        if (y < h - 3) {
          const bIdx = ((y + 2) * w + x) * 4;
          botBrightness = (img.bitmap.data[bIdx] + img.bitmap.data[bIdx + 1] + img.bitmap.data[bIdx + 2]) / 3;
        }

        if (topBrightness < 185 && botBrightness < 185) {
          const avg = (topBrightness + botBrightness) / 2;
          img.bitmap.data[idx + 0] = avg;
          img.bitmap.data[idx + 1] = avg;
          img.bitmap.data[idx + 2] = avg;
        } else {
          img.bitmap.data[idx + 0] = 255;
          img.bitmap.data[idx + 1] = 255;
          img.bitmap.data[idx + 2] = 255;
        }
      }
    }
  }

  // 2. Grayscale & Contrast
  img.grayscale();
  img.contrast(0.65);

  // 3. Adaptive Thresholding
  img.scan(0, 0, w, h, function (x, y, idx) {
    const v = this.bitmap.data[idx];
    const bin = v < thresholdVal ? 0 : 255;
    this.bitmap.data[idx + 0] = bin;
    this.bitmap.data[idx + 1] = bin;
    this.bitmap.data[idx + 2] = bin;
  });

  // 4. Fill isolated 1-pixel line cuts
  const copy = img.clone();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      if (copy.bitmap.data[idx] === 255) {
        const top = copy.bitmap.data[((y - 1) * w + x) * 4];
        const bot = copy.bitmap.data[((y + 1) * w + x) * 4];
        if (top === 0 && bot === 0) {
          img.bitmap.data[idx + 0] = 0;
          img.bitmap.data[idx + 1] = 0;
          img.bitmap.data[idx + 2] = 0;
        }
      }
    }
  }

  // 5. Resize 3x for crisp Tesseract OCR resolution
  img.resize(w * 3, h * 3, Jimp.RESIZE_BICUBIC);

  // 6. Add 25px white padding
  const padded = new Jimp(img.bitmap.width + 50, img.bitmap.height + 50, 0xFFFFFFFF);
  padded.composite(img, 25, 25);

  return await padded.getBufferAsync(Jimp.MIME_PNG);
}

/**
 * Solve captcha using multi-pass adaptive OCR
 * @param {Buffer} rawBuffer 
 * @returns {Promise<string>}
 */
async function solveCaptcha(rawBuffer) {
  try {
    const ocrWorker = await getWorker();

    // Pass 1: Standard threshold (180)
    let processedBuffer = await preprocessCaptcha(rawBuffer, 180);
    let { data: { text } } = await ocrWorker.recognize(processedBuffer);
    let cleaned = (text || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    // If Pass 1 gave less than 4 chars, try Pass 2 with threshold 195 (darker stroke retention)
    if (cleaned.length < 4) {
      processedBuffer = await preprocessCaptcha(rawBuffer, 195);
      const res2 = await ocrWorker.recognize(processedBuffer);
      const cleaned2 = (res2.data.text || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      if (cleaned2.length >= cleaned.length) {
        cleaned = cleaned2;
      }
    }

    // If still less than 4 chars, try Pass 3 with threshold 165 (cleaner background)
    if (cleaned.length < 4) {
      processedBuffer = await preprocessCaptcha(rawBuffer, 165);
      const res3 = await ocrWorker.recognize(processedBuffer);
      const cleaned3 = (res3.data.text || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      if (cleaned3.length >= cleaned.length) {
        cleaned = cleaned3;
      }
    }

    return cleaned.slice(0, 4);
  } catch (err) {
    console.error('Error in solveCaptcha:', err.message);
    return '';
  }
}

module.exports = {
  getWorker,
  preprocessCaptcha,
  solveCaptcha,
};
