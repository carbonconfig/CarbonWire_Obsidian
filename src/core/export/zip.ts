import { deflateRawSync } from "node:zlib";

/* A minimal zip writer: deflated entries, UTF-8 names, no zip64 (exports stay far below 4 GB). */

export interface ZipEntry {
	name: string;
	data: Uint8Array;
}

let table: Uint32Array | undefined;

function crc32(data: Uint8Array): number {
	if (!table) {
		table = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date and time for the entries, so archives built from the same files are identical. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

export function zip(entries: readonly ZipEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const local: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const deflated = deflateRawSync(entry.data);
		const stored = deflated.length >= entry.data.length;
		const body = stored ? entry.data : deflated;
		const crc = crc32(entry.data);

		const head = new DataView(new ArrayBuffer(30));
		head.setUint32(0, 0x04034b50, true);
		head.setUint16(4, 20, true);
		head.setUint16(6, 0x0800, true);
		head.setUint16(8, stored ? 0 : 8, true);
		head.setUint16(10, DOS_TIME, true);
		head.setUint16(12, DOS_DATE, true);
		head.setUint32(14, crc, true);
		head.setUint32(18, body.length, true);
		head.setUint32(22, entry.data.length, true);
		head.setUint16(26, name.length, true);
		head.setUint16(28, 0, true);
		local.push(new Uint8Array(head.buffer), name, body);

		const dir = new DataView(new ArrayBuffer(46));
		dir.setUint32(0, 0x02014b50, true);
		dir.setUint16(4, 20, true);
		dir.setUint16(6, 20, true);
		dir.setUint16(8, 0x0800, true);
		dir.setUint16(10, stored ? 0 : 8, true);
		dir.setUint16(12, DOS_TIME, true);
		dir.setUint16(14, DOS_DATE, true);
		dir.setUint32(16, crc, true);
		dir.setUint32(20, body.length, true);
		dir.setUint32(24, entry.data.length, true);
		dir.setUint16(28, name.length, true);
		dir.setUint32(42, offset, true);
		central.push(new Uint8Array(dir.buffer), name);

		offset += 30 + name.length + body.length;
	}
	const centralSize = central.reduce((n, c) => n + c.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, entries.length, true);
	end.setUint16(10, entries.length, true);
	end.setUint32(12, centralSize, true);
	end.setUint32(16, offset, true);
	const parts = [...local, ...central, new Uint8Array(end.buffer)];
	const out = new Uint8Array(offset + centralSize + 22);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
