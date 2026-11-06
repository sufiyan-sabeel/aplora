import zlib from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  crc32: number;
}

/**
 * Minimal, defensive ZIP reader. It never trusts the declared entry sizes for
 * decompression (a bounded inflate is used) and refuses archives whose central
 * directory cannot be located, which is the usual shape of a malformed APK.
 */
export class ZipArchive {
  readonly entries = new Map<string, ZipEntry>();
  readonly centralDirectoryOffset: number;
  readonly totalUncompressedSize: number;
  readonly duplicateNames: string[] = [];

  constructor(private readonly buffer: Buffer) {
    if (buffer.length < 22) throw new Error("File is too small to be a ZIP archive");
    const eocd = this.findEndOfCentralDirectory();
    const entryCount = buffer.readUInt16LE(eocd + 10);
    const centralSize = buffer.readUInt32LE(eocd + 12);
    const centralOffset = buffer.readUInt32LE(eocd + 16);

    if (entryCount === 0xffff || centralOffset === 0xffffffff) {
      throw new Error("ZIP64 archives are not supported");
    }
    if (centralOffset + centralSize > buffer.length) {
      throw new Error("ZIP central directory is out of bounds");
    }
    this.centralDirectoryOffset = centralOffset;

    let offset = centralOffset;
    let total = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > buffer.length) throw new Error("Truncated ZIP central directory");
      if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
        throw new Error("Corrupt ZIP central directory entry");
      }
      const method = buffer.readUInt16LE(offset + 10);
      const crc32 = buffer.readUInt32LE(offset + 16);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

      if (nameLength === 0) throw new Error("ZIP entry with an empty name");
      if (this.entries.has(name)) this.duplicateNames.push(name);

      this.entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset, crc32 });
      total += uncompressedSize;
      offset += 46 + nameLength + extraLength + commentLength;
    }
    this.totalUncompressedSize = total;
  }

  private findEndOfCentralDirectory(): number {
    const minOffset = Math.max(0, this.buffer.length - 22 - 0xffff);
    for (let offset = this.buffer.length - 22; offset >= minOffset; offset -= 1) {
      if (this.buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
    }
    throw new Error("Not a ZIP archive (end of central directory not found)");
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** Reads one entry, inflating with a hard output cap to defuse zip bombs. */
  read(name: string, maxOutputBytes = 32 * 1024 * 1024): Buffer {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`ZIP entry not found: ${name}`);
    const header = entry.localHeaderOffset;
    if (header + 30 > this.buffer.length) throw new Error(`Truncated local header for ${name}`);
    if (this.buffer.readUInt32LE(header) !== LOCAL_SIGNATURE) {
      throw new Error(`Corrupt local header for ${name}`);
    }
    const nameLength = this.buffer.readUInt16LE(header + 26);
    const extraLength = this.buffer.readUInt16LE(header + 28);
    const dataStart = header + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > this.buffer.length) throw new Error(`Truncated data for ${name}`);
    const raw = this.buffer.subarray(dataStart, dataEnd);

    if (entry.method === 0) return Buffer.from(raw);
    if (entry.method === 8) {
      try {
        return zlib.inflateRawSync(raw, { maxOutputLength: maxOutputBytes });
      } catch (error) {
        throw new Error(`Failed to inflate ${name}: ${(error as Error).message}`);
      }
    }
    throw new Error(`Unsupported ZIP compression method ${entry.method} for ${name}`);
  }
}
