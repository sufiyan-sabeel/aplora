/**
 * Parser for Android's binary XML ("AXML") format, the compiled form of
 * AndroidManifest.xml inside an APK. Only the parts needed to read the manifest
 * are implemented: the string pool, the resource map and the element tree.
 */

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;

const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

/** Well-known android:* attribute resource ids, used when names are absent. */
export const ANDROID_ATTR_IDS: Record<number, string> = {
  0x0101020c: "minSdkVersion",
  0x0101021b: "versionCode",
  0x0101021c: "versionName",
  0x01010270: "targetSdkVersion",
  0x01010003: "name",
  0x01010010: "debuggable",
  0x0101000f: "allowBackup",
};

export interface AxmlAttribute {
  namespace: string | null;
  name: string;
  value: string;
  rawType: number;
  rawData: number;
}

export interface AxmlElement {
  name: string;
  attributes: AxmlAttribute[];
  children: AxmlElement[];
}

class StringPool {
  private strings: string[] = [];

  constructor(buffer: Buffer, chunkOffset: number, chunkSize: number) {
    const headerSize = buffer.readUInt16LE(chunkOffset + 2);
    const stringCount = buffer.readUInt32LE(chunkOffset + 8);
    const flags = buffer.readUInt32LE(chunkOffset + 16);
    const stringsStart = buffer.readUInt32LE(chunkOffset + 20);
    const isUtf8 = (flags & (1 << 8)) !== 0;
    const offsetsBase = chunkOffset + headerSize;
    const dataBase = chunkOffset + stringsStart;

    for (let index = 0; index < stringCount; index += 1) {
      const offset = buffer.readUInt32LE(offsetsBase + index * 4);
      const position = dataBase + offset;
      if (position < chunkOffset || position >= chunkOffset + chunkSize) {
        this.strings.push("");
        continue;
      }
      try {
        this.strings.push(isUtf8 ? readUtf8String(buffer, position) : readUtf16String(buffer, position));
      } catch {
        this.strings.push("");
      }
    }
  }

  get(index: number): string {
    if (index === 0xffffffff || index < 0 || index >= this.strings.length) return "";
    return this.strings[index] ?? "";
  }
}

function readUtf8String(buffer: Buffer, position: number): string {
  let cursor = position;
  let length = buffer[cursor];
  cursor += 1;
  if ((length & 0x80) !== 0) {
    length = ((length & 0x7f) << 8) | buffer[cursor];
    cursor += 1;
  }
  let byteLength = buffer[cursor];
  cursor += 1;
  if ((byteLength & 0x80) !== 0) {
    byteLength = ((byteLength & 0x7f) << 8) | buffer[cursor];
    cursor += 1;
  }
  return buffer.toString("utf8", cursor, cursor + byteLength);
}

function readUtf16String(buffer: Buffer, position: number): string {
  let cursor = position;
  let length = buffer.readUInt16LE(cursor);
  cursor += 2;
  if ((length & 0x8000) !== 0) {
    length = ((length & 0x7fff) << 16) | buffer.readUInt16LE(cursor);
    cursor += 2;
  }
  return buffer.toString("utf16le", cursor, cursor + length * 2);
}

export function parseAxml(buffer: Buffer): AxmlElement {
  if (buffer.length < 8) throw new Error("AXML file is too small");
  if (buffer.readUInt16LE(0) !== RES_XML_TYPE) throw new Error("Not a binary Android manifest (AXML)");

  const headerSize = buffer.readUInt16LE(2);
  let offset = headerSize;
  let pool: StringPool | null = null;
  const resourceIds: number[] = [];
  const root: AxmlElement = { name: "#document", attributes: [], children: [] };
  const stack: AxmlElement[] = [root];

  while (offset + 8 <= buffer.length) {
    const type = buffer.readUInt16LE(offset);
    const chunkHeaderSize = buffer.readUInt16LE(offset + 2);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkSize < 8 || offset + chunkSize > buffer.length) {
      throw new Error("Corrupt AXML chunk");
    }

    if (type === RES_STRING_POOL_TYPE) {
      pool = new StringPool(buffer, offset, chunkSize);
    } else if (type === RES_XML_RESOURCE_MAP_TYPE) {
      const count = Math.floor((chunkSize - chunkHeaderSize) / 4);
      for (let index = 0; index < count; index += 1) {
        resourceIds.push(buffer.readUInt32LE(offset + chunkHeaderSize + index * 4));
      }
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      if (!pool) throw new Error("AXML string pool missing before elements");
      const element = readStartElement(buffer, offset, chunkHeaderSize, pool, resourceIds);
      stack[stack.length - 1].children.push(element);
      stack.push(element);
    } else if (type === RES_XML_END_ELEMENT_TYPE) {
      if (stack.length > 1) stack.pop();
    }

    offset += chunkSize;
  }

  const manifest = root.children.find((child) => child.name === "manifest");
  if (!manifest) throw new Error("AndroidManifest.xml has no <manifest> element");
  return manifest;
}

function readStartElement(
  buffer: Buffer,
  chunkOffset: number,
  headerSize: number,
  pool: StringPool,
  resourceIds: number[],
): AxmlElement {
  const ext = chunkOffset + headerSize;
  const nameIndex = buffer.readUInt32LE(ext + 4);
  const attributeStart = buffer.readUInt16LE(ext + 8) || 20;
  const attributeSize = buffer.readUInt16LE(ext + 10) || 20;
  const attributeCount = buffer.readUInt16LE(ext + 12);
  const attributes: AxmlAttribute[] = [];

  for (let index = 0; index < attributeCount; index += 1) {
    const base = ext + attributeStart + index * attributeSize;
    if (base + 20 > chunkOffset + buffer.readUInt32LE(chunkOffset + 4)) break;
    const namespaceIndex = buffer.readUInt32LE(base);
    const attrNameIndex = buffer.readUInt32LE(base + 4);
    const rawValueIndex = buffer.readUInt32LE(base + 8);
    const rawType = buffer[base + 15];
    const rawData = buffer.readUInt32LE(base + 16);

    let name = pool.get(attrNameIndex);
    if (!name && attrNameIndex < resourceIds.length) {
      const resourceId = resourceIds[attrNameIndex];
      name = ANDROID_ATTR_IDS[resourceId] ?? `0x${resourceId.toString(16)}`;
    }

    let value: string;
    if (rawType === TYPE_STRING) {
      value = pool.get(rawData);
    } else if (rawType === TYPE_INT_BOOLEAN) {
      value = rawData !== 0 ? "true" : "false";
    } else if (rawType === TYPE_INT_HEX) {
      value = `0x${rawData.toString(16)}`;
    } else if (rawType === TYPE_INT_DEC) {
      value = String(rawData);
    } else {
      value = pool.get(rawValueIndex) || String(rawData);
    }

    attributes.push({
      namespace: namespaceIndex === 0xffffffff ? null : pool.get(namespaceIndex) || null,
      name,
      value,
      rawType,
      rawData,
    });
  }

  return { name: pool.get(nameIndex), attributes, children: [] };
}

export function attributeValue(element: AxmlElement, name: string): string | undefined {
  const attribute = element.attributes.find((candidate) => candidate.name === name);
  return attribute?.value;
}
