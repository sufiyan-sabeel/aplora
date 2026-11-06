/**
 * Encoder for Android binary XML, used to build realistic APK fixtures for the
 * test suite. It produces the same chunk layout aapt emits, so the parser in
 * `axml.ts` is exercised against genuine binary structure rather than a mock.
 */

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;

const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;

export interface FixtureAttribute {
  name: string;
  value: string | number;
}

export interface FixtureElement {
  name: string;
  attributes: FixtureAttribute[];
  children: FixtureElement[];
}

class StringPoolBuilder {
  private readonly index = new Map<string, number>();
  readonly strings: string[] = [];

  add(value: string): number {
    const existing = this.index.get(value);
    if (existing !== undefined) return existing;
    const position = this.strings.length;
    this.strings.push(value);
    this.index.set(value, position);
    return position;
  }

  build(): Buffer {
    const headerSize = 28;
    const offsetsSize = this.strings.length * 4;
    const encoded: Buffer[] = [];
    let dataLength = 0;
    for (const value of this.strings) {
      const chars = Buffer.from(value, "utf16le");
      const lengthBuffer = Buffer.alloc(2);
      lengthBuffer.writeUInt16LE(value.length, 0);
      const terminator = Buffer.alloc(2);
      encoded.push(lengthBuffer, chars, terminator);
      dataLength += 2 + chars.length + 2;
    }

    const stringsStart = headerSize + offsetsSize;
    const size = stringsStart + dataLength;
    const header = Buffer.alloc(stringsStart);
    header.writeUInt16LE(RES_STRING_POOL_TYPE, 0);
    header.writeUInt16LE(headerSize, 2);
    header.writeUInt32LE(size, 4);
    header.writeUInt32LE(this.strings.length, 8);
    header.writeUInt32LE(0, 12); // styleCount
    header.writeUInt32LE(0, 16); // flags: UTF-16 pool
    header.writeUInt32LE(stringsStart, 20);
    header.writeUInt32LE(0, 24); // stylesStart

    let offset = 0;
    this.strings.forEach((_value, position) => {
      const chars = Buffer.from(this.strings[position] ?? "", "utf16le");
      header.writeUInt32LE(offset, headerSize + position * 4);
      offset += 2 + chars.length + 2;
    });

    return Buffer.concat([header, ...encoded]);
  }
}

function startElement(element: FixtureElement, pool: StringPoolBuilder): Buffer {
  const nameIndex = pool.add(element.name);
  const attributes = element.attributes;
  const headerSize = 16;
  const attributeStart = 20;
  const attributeSize = 20;
  const size = headerSize + attributeStart + attributes.length * attributeSize;
  const buffer = Buffer.alloc(size);

  buffer.writeUInt16LE(RES_XML_START_ELEMENT_TYPE, 0);
  buffer.writeUInt16LE(headerSize, 2);
  buffer.writeUInt32LE(size, 4);
  buffer.writeUInt32LE(1, 8); // line number
  buffer.writeUInt32LE(0xffffffff, 12); // comment

  const ext = headerSize;
  buffer.writeUInt32LE(0xffffffff, ext); // namespace
  buffer.writeUInt32LE(nameIndex, ext + 4);
  buffer.writeUInt16LE(attributeStart, ext + 8);
  buffer.writeUInt16LE(attributeSize, ext + 10);
  buffer.writeUInt16LE(attributes.length, ext + 12);
  buffer.writeUInt16LE(0, ext + 14);
  buffer.writeUInt16LE(0, ext + 16);
  buffer.writeUInt16LE(0, ext + 18);

  attributes.forEach((attribute, position) => {
    const base = ext + attributeStart + position * attributeSize;
    const attrNameIndex = pool.add(attribute.name);
    buffer.writeUInt32LE(0xffffffff, base); // namespace
    buffer.writeUInt32LE(attrNameIndex, base + 4);
    if (typeof attribute.value === "number") {
      buffer.writeUInt32LE(0xffffffff, base + 8);
      buffer.writeUInt16LE(8, base + 12);
      buffer.writeUInt8(0, base + 14);
      buffer.writeUInt8(TYPE_INT_DEC, base + 15);
      buffer.writeUInt32LE(attribute.value, base + 16);
    } else {
      const valueIndex = pool.add(attribute.value);
      buffer.writeUInt32LE(valueIndex, base + 8);
      buffer.writeUInt16LE(8, base + 12);
      buffer.writeUInt8(0, base + 14);
      buffer.writeUInt8(TYPE_STRING, base + 15);
      buffer.writeUInt32LE(valueIndex, base + 16);
    }
  });

  return buffer;
}

function endElement(nameIndex: number): Buffer {
  const size = 24;
  const buffer = Buffer.alloc(size);
  buffer.writeUInt16LE(RES_XML_END_ELEMENT_TYPE, 0);
  buffer.writeUInt16LE(16, 2);
  buffer.writeUInt32LE(size, 4);
  buffer.writeUInt32LE(1, 8);
  buffer.writeUInt32LE(0xffffffff, 12);
  buffer.writeUInt32LE(0xffffffff, 16);
  buffer.writeUInt32LE(nameIndex, 20);
  return buffer;
}

export function encodeAxml(root: FixtureElement): Buffer {
  const pool = new StringPoolBuilder();
  const chunks: Buffer[] = [];

  const walk = (element: FixtureElement) => {
    chunks.push(startElement(element, pool));
    for (const child of element.children) walk(child);
    chunks.push(endElement(pool.add(element.name)));
  };
  walk(root);

  const stringPool = pool.build();
  const bodySize = stringPool.length + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(RES_XML_TYPE, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + bodySize, 4);

  return Buffer.concat([header, stringPool, ...chunks]);
}
