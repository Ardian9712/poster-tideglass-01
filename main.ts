import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(directory, 'source-image.jpg');
const outputDirectory = resolve(directory, process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const outputPath = join(outputDirectory, 'entry.png');
const maximumBytes = 1_048_576;

function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    throw new Error('Expected a JPEG with start-of-image and end-of-image markers.');
  }

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new Error(`Invalid JPEG marker at byte ${offset}.`);
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw new Error('Truncated JPEG marker.');

    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x00 || marker === 0xd8) {
      throw new Error(`Invalid JPEG header marker: 0x${marker.toString(16)}.`);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (offset + 2 > bytes.length) throw new Error('Truncated JPEG segment length.');
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) {
      throw new Error('Invalid or truncated JPEG segment.');
    }

    // Start-of-frame markers contain dimensions; C4, C8, and CC are other tables.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (length < 8) throw new Error('Truncated JPEG frame header.');
      const components = bytes[offset + 7];
      if (components === 0 || length !== 8 + 3 * components) {
        throw new Error('Invalid JPEG frame component table.');
      }
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    }
    offset += length;
  }

  throw new Error('JPEG header has no frame dimensions before the image data.');
}

async function main(): Promise<void> {
  const source = await readFile(sourcePath);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, source);

  const written = await readFile(outputPath);
  if (written.length > maximumBytes) {
    throw new Error(`Image is ${written.length} bytes; the maximum is ${maximumBytes} bytes.`);
  }
  const { width, height } = jpegDimensions(written);
  if (width !== 1024 || height !== 1024) {
    throw new Error(`Image is ${width}x${height}; expected exactly 1024x1024 pixels.`);
  }
  if (!written.equals(source)) {
    throw new Error('Written image differs from source-image.jpg.');
  }

  const sha256 = createHash('sha256').update(written).digest('hex');
  console.log(`Success: ${outputPath} | ${written.length} bytes | SHA-256 ${sha256}`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Tideglass entry failed (${outputPath}): ${message}`);
}
