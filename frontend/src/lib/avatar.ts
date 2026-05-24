"use client";

const TARGET_SIZE = 256;
const INITIAL_QUALITY = 0.85;
/**
 * Hard cap on the produced base64 data URL (matches the backend validator).
 * If the first encode is over this, we drop quality and try again so the user
 * never sees a "too big" error.
 */
const MAX_OUTPUT_BYTES = 64 * 1024;
const MIN_QUALITY = 0.4;
const MAX_INPUT_BYTES = 20 * 1024 * 1024; // 20 MB before resize

async function fileToImage(file: File): Promise<HTMLImageElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("讀取檔案失敗"));
    reader.readAsDataURL(file);
  });
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("無法載入圖片"));
    el.src = dataUrl;
  });
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Resize the file center-cropped to TARGET_SIZE × TARGET_SIZE, encode as JPEG
 * data URL. If the result exceeds MAX_OUTPUT_BYTES, step quality down until it
 * fits (or bottom out at MIN_QUALITY).
 */
export async function resizeAvatarToDataUrl(file: File): Promise<string> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("圖片太大，請選擇 20MB 以下的圖片");
  }
  const img = await fileToImage(file);

  const canvas = document.createElement("canvas");
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("瀏覽器不支援畫布");

  // Center-crop largest square, scale to TARGET_SIZE.
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE);

  let quality = INITIAL_QUALITY;
  let dataUrl = canvasToJpegDataUrl(canvas, quality);
  while (dataUrl.length > MAX_OUTPUT_BYTES && quality > MIN_QUALITY) {
    quality -= 0.1;
    dataUrl = canvasToJpegDataUrl(canvas, quality);
  }
  if (dataUrl.length > MAX_OUTPUT_BYTES) {
    throw new Error("無法將圖片壓縮到足夠小，請換一張");
  }
  return dataUrl;
}
