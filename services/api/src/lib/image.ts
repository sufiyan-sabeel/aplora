/**
 * Minimal image sniffing: the declared MIME type and file extension are never
 * trusted, so the real container format is read from the bytes.
 */
export interface ImageMeta {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
}

export function detectImage(buffer: Buffer): ImageMeta | null {
  if (buffer.length < 24) return null;

  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
    return { mimeType: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          mimeType: "image/jpeg",
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
    return null;
  }

  // WebP
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const format = buffer.toString("ascii", 12, 16);
    if (format === "VP8X") {
      return {
        mimeType: "image/webp",
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (format === "VP8 ") {
      return {
        mimeType: "image/webp",
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (format === "VP8L") {
      const bits = buffer.readUInt32LE(21);
      return {
        mimeType: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
  }

  return null;
}
