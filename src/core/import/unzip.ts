import { inflateRawSync } from "node:zlib";
import { ImportError } from "./model";

/* A minimal zip reader: stored and deflated entries; no zip64, encryption or split archives. */

export interface UnzippedFile {
	name: string;
	data: Uint8Array;
}

const MAX_TOTAL = 512 * 1024 * 1024;

/** The files in `zip` whose names pass `wanted`. */
export function unzip(zip: Uint8Array, wanted: (name: string) => boolean = () => true): UnzippedFile[] {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	let end = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new ImportError("This isn't a zip file.");
	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	const decoder = new TextDecoder();
	const files: UnzippedFile[] = [];
	let total = 0;
	for (let n = 0; n < count; n++) {
		if (at + 46 > zip.length || view.getUint32(at, true) !== 0x02014b50) throw new ImportError("The zip file is damaged.");
		const flags = view.getUint16(at + 8, true);
		const method = view.getUint16(at + 10, true);
		const compressed = view.getUint32(at + 20, true);
		const size = view.getUint32(at + 24, true);
		const nameLength = view.getUint16(at + 28, true);
		const local = view.getUint32(at + 42, true);
		const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
		at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
		if (name.endsWith("/") || !wanted(name)) continue;
		if (flags & 1) throw new ImportError(`${name} in the zip file is encrypted.`);
		if (compressed === 0xffffffff || size === 0xffffffff) throw new ImportError("The zip file is too large to import.");
		total += size;
		if (total > MAX_TOTAL) throw new ImportError("The zip file is too large to import.");
		if (local + 30 > zip.length || view.getUint32(local, true) !== 0x04034b50) throw new ImportError("The zip file is damaged.");
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		const body = zip.subarray(start, start + compressed);
		if (method === 0) files.push({ name, data: body });
		else if (method === 8) files.push({ name, data: inflateRawSync(body) });
		else throw new ImportError(`${name} in the zip file uses a compression method CarbonWire can't read.`);
	}
	return files;
}
