import sharp from "sharp";

/** Сторона и качество картинки: для карточки на телефоне хватает 512 px; ~50–80 КБ вместо 300–600 КБ PNG. */
export const PICTURE_SIZE = 512;
const JPEG_QUALITY = 82;

/**
 * Сжимает картинку один раз — сразу после генерации (или при первой загрузке из Telegram).
 * JPEG, а не WebP: sendPhoto надёжно принимает именно его (WebP Telegram может показать стикером).
 */
export async function compressPicture(image: Buffer): Promise<Buffer> {
  try {
    return await sharp(image)
      .resize(PICTURE_SIZE, PICTURE_SIZE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    // Не смогли сжать — лучше отправить как есть, чем потерять картинку.
    console.warn("Picture compression failed, sending the original", err instanceof Error ? err.message : err);
    return image;
  }
}
