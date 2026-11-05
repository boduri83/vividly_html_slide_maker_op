/** Native clipboard access is available only through the trusted editor IPC. */
export const MAX_CLIPBOARD_TEXT_BYTES = 32 * 1024 * 1024;
export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_CLIPBOARD_IMAGE_PIXELS = 64 * 1024 * 1024;

export class NativeClipboardService {
  constructor({ clipboard, maxTextBytes = MAX_CLIPBOARD_TEXT_BYTES, maxImageBytes = MAX_CLIPBOARD_IMAGE_BYTES,
    maxImagePixels = MAX_CLIPBOARD_IMAGE_PIXELS } = {}) {
    if (!clipboard || typeof clipboard.read !== 'function' || typeof clipboard.writeText !== 'function') throw new TypeError('Async native clipboard provider is required');
    this.clipboard = clipboard; this.maxTextBytes = maxTextBytes; this.maxImageBytes = maxImageBytes; this.maxImagePixels = maxImagePixels;
  }
  validateText(text) {
    if (typeof text !== 'string') throw new TypeError('클립보드 텍스트가 올바르지 않습니다.');
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > this.maxTextBytes) throw new Error('클립보드 텍스트가 32MiB를 초과했습니다. 내용을 나눠 복사해 주세요.');
    return bytes;
  }
  async writeText(text) {
    const bytes = this.validateText(text);
    // Do not touch the clipboard until the complete payload passed validation.
    await this.clipboard.writeText(text);
    return { written: true, bytes };
  }
  async read() {
    // Electron 45 follows the W3C API: ClipboardItems contain asynchronous Blob
    // payloads. Read one snapshot, and never request URI lists or raw OS formats.
    const items = await this.clipboard.read();
    if (!Array.isArray(items)) throw new Error('클립보드 항목을 읽지 못했습니다.');
    const find = type => items.find(item => Array.isArray(item.types) && item.types.includes(type));
    let text = '';
    const textItem = find('text/plain');
    if (textItem) {
      const blob = await textItem.getType('text/plain');
      if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0 || typeof blob.text !== 'function') throw new Error('클립보드 텍스트 형식을 읽지 못했습니다.');
      if (blob.size > this.maxTextBytes) throw new Error('클립보드 텍스트가 32MiB를 초과했습니다. 내용을 나눠 복사해 주세요.');
      text = await blob.text(); this.validateText(text);
    }
    const imageItem = find('image/png');
    if (!imageItem) return { text };
    const image = await imageItem.getType('image/png');
    if (!image || !Number.isSafeInteger(image.size) || image.size <= 0 || typeof image.arrayBuffer !== 'function') throw new Error('클립보드 이미지를 PNG로 읽지 못했습니다.');
    if (image.size > this.maxImageBytes) throw new Error('클립보드 PNG 이미지가 20MiB를 초과했습니다.');
    const bytes = Buffer.from(await image.arrayBuffer());
    if (!bytes.length || bytes.length > this.maxImageBytes) throw new Error('클립보드 PNG 이미지가 20MiB를 초과했거나 비어 있습니다.');
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('클립보드 이미지를 PNG로 읽지 못했습니다.');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
        || width * height > this.maxImagePixels) throw new Error('클립보드 이미지의 크기가 허용 범위를 초과했습니다.');
    return { text, image: { mimeType: 'image/png', dataBase64: bytes.toString('base64'), width, height } };
  }
}
