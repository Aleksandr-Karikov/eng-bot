import type { Api } from "grammy";
import type { Message } from "grammy/types";
import type { ImageInput } from "../llm/enricher";

/** Больше Claude не примет; фото Telegram и так сжимает до нескольких сотен КБ. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export interface ImageRef {
  fileId: string;
  mediaType: ImageInput["mediaType"];
  size?: number;
}

/** Картинка в сообщении: фото (самый крупный размер) или картинка, отправленная файлом. */
export function imageOf(m: Message | undefined): ImageRef | undefined {
  const photo = m?.photo?.at(-1);
  if (photo) return { fileId: photo.file_id, mediaType: "image/jpeg", size: photo.file_size };
  const doc = m?.document;
  const type = IMAGE_TYPES.find((t) => t === doc?.mime_type);
  return doc && type ? { fileId: doc.file_id, mediaType: type, size: doc.file_size } : undefined;
}

export class ImageTooBigError extends Error {}

export async function downloadImage(api: Api, ref: ImageRef): Promise<ImageInput> {
  if ((ref.size ?? 0) > MAX_IMAGE_BYTES) throw new ImageTooBigError();
  const data = await downloadFile(api, ref.fileId);
  if (data.length > MAX_IMAGE_BYTES) throw new ImageTooBigError();
  return { data, mediaType: ref.mediaType };
}

/** Файл из сообщения (картинка, голосовое) по file_id. */
export async function downloadFile(api: Api, fileId: string): Promise<Buffer> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error(`No file_path for ${fileId}`);
  const response = await fetch(`https://api.telegram.org/file/bot${api.token}/${file.file_path}`);
  if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
