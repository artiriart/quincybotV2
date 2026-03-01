const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const sharp = require("sharp");

function sanitizeOcrText(text) {
  let value = String(text || "").replace(/\n/g, " ").replace(/\r/g, "");
  // Keep apostrophes as requested (both ASCII and curly apostrophe).
  value = value.replace(/[^a-zA-Z'’ ]+/g, " ");
  value = value.replace(/\s+/g, " ").trim();
  return value;
}

function computeOtsuThreshold(grayData) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < grayData.length; i += 1) {
    hist[grayData[i]] += 1;
  }

  const total = grayData.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];

  let sumBg = 0;
  let weightBg = 0;
  let maxVariance = -1;
  let threshold = 127;

  for (let t = 0; t < 256; t += 1) {
    weightBg += hist[t];
    if (weightBg === 0) continue;

    const weightFg = total - weightBg;
    if (weightFg === 0) break;

    sumBg += t * hist[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sum - sumBg) / weightFg;

    const between = weightBg * weightFg * (meanBg - meanFg) ** 2;
    if (between > maxVariance) {
      maxVariance = between;
      threshold = t;
    }
  }

  return threshold;
}

function binarizeGrayscale(grayData) {
  const threshold = computeOtsuThreshold(grayData);
  const out = Buffer.allocUnsafe(grayData.length);
  for (let i = 0; i < grayData.length; i += 1) {
    out[i] = grayData[i] > threshold ? 255 : 0;
  }
  return out;
}

function cropRawRegion(rawData, imageWidth, imageHeight, x, y, width, height) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(imageWidth, x0 + Math.max(0, Math.floor(width)));
  const y1 = Math.min(imageHeight, y0 + Math.max(0, Math.floor(height)));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  if (!w || !h) return { data: Buffer.alloc(0), width: 0, height: 0 };

  const cropped = Buffer.allocUnsafe(w * h);
  for (let row = 0; row < h; row += 1) {
    const srcStart = (y0 + row) * imageWidth + x0;
    const srcEnd = srcStart + w;
    rawData.copy(cropped, row * w, srcStart, srcEnd);
  }

  return { data: cropped, width: w, height: h };
}

async function runTesseractOnPngBuffer(pngBuffer) {
  const tesseractBin = process.env.TESSERACT_PATH || "tesseract";
  const tempInput = path.join(
    os.tmpdir(),
    `karuta-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  );

  await fs.writeFile(tempInput, pngBuffer);

  try {
    const result = await new Promise((resolve, reject) => {
      const args = [tempInput, "stdout", "-l", "eng", "--psm", "6"];
      const child = spawn(tesseractBin, args, { stdio: ["ignore", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || `tesseract exited with code ${code}`));
      });
    });

    return String(result || "");
  } finally {
    await fs.unlink(tempInput).catch(() => {});
  }
}

async function recognizeKarutaCardsFromUrl(imageUrl) {
  const startedAt = Date.now();
  const startMem = process.memoryUsage().rss / 1024 ** 2;

  const response = await fetch(imageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 QuincyBot/2.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Image download failed (${response.status})`);
  }

  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  const { data: grayData, info } = await sharp(sourceBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const thresholded = binarizeGrayscale(grayData);
  const cardCount = 3;
  const names = [];
  const series = [];

  for (const y of [55, 307]) {
    for (let i = 0; i < cardCount; i += 1) {
      const x = 46 + i * 277;
      const roi = cropRawRegion(thresholded, info.width, info.height, x, y, 180, 53);
      if (!roi.width || !roi.height) {
        (y < 300 ? names : series).push("");
        continue;
      }

      const roiPng = await sharp(roi.data, {
        raw: { width: roi.width, height: roi.height, channels: 1 },
      })
        .png()
        .toBuffer();

      const ocrRaw = await runTesseractOnPngBuffer(roiPng);
      const cleaned = sanitizeOcrText(ocrRaw);
      (y < 300 ? names : series).push(cleaned);
    }
  }

  const cards = [];
  for (let i = 0; i < cardCount; i += 1) {
    cards.push({
      card_index: i,
      name: names[i] || "",
      series: series[i] || "",
    });
  }

  const elapsedSec = (Date.now() - startedAt) / 1000;
  const memAfter = process.memoryUsage().rss / 1024 ** 2;
  return {
    cards,
    load_time_sec: Number(elapsedSec.toFixed(2)),
    memory_usage_mb: Number((memAfter - startMem).toFixed(2)),
  };
}

module.exports = {
  recognizeKarutaCardsFromUrl,
};
