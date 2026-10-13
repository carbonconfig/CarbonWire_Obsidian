import type { ResolvedBody } from "./request-builder";

export type FileReader = (path: string) => Promise<Uint8Array>;

export interface EncodedBody {
	bytes: Uint8Array;
	contentType?: string;
}

const encoder = new TextEncoder();

export async function encodeBody(body: ResolvedBody | undefined, readFile: FileReader): Promise<EncodedBody | undefined> {
	switch (body?.kind) {
		case undefined:
			return undefined;
		case "text":
			return { bytes: encoder.encode(body.text), contentType: body.contentType };
		case "file":
			return { bytes: await readFile(body.filePath), contentType: body.contentType };
		case "multipart": {
			const boundary = `----CarbonWireBoundary${crypto.randomUUID().replace(/-/g, "")}`;
			const chunks: Uint8Array[] = [];
			for (const part of body.parts) {
				const isFile = "filePath" in part;
				const filename = isFile ? basename(part.filePath) : undefined;
				let head = `--${boundary}\r\nContent-Disposition: form-data; name="${quote(part.name)}"`;
				if (filename !== undefined) head += `; filename="${quote(filename)}"`;
				head += "\r\n";
				const type = part.contentType || (isFile ? "application/octet-stream" : undefined);
				if (type) head += `Content-Type: ${type}\r\n`;
				chunks.push(encoder.encode(head + "\r\n"));
				chunks.push(isFile ? await readFile(part.filePath) : encoder.encode(part.value));
				chunks.push(encoder.encode("\r\n"));
			}
			chunks.push(encoder.encode(`--${boundary}--\r\n`));
			return { bytes: concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
		}
	}
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
	let length = 0;
	for (const c of chunks) length += c.byteLength;
	const out = new Uint8Array(length);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.byteLength;
	}
	return out;
}

function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

function quote(value: string): string {
	return value.replace(/"/g, "%22").replace(/\r|\n/g, " ");
}
