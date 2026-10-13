import type { VaultFiles } from "../src/core/storage/store";

export class MemoryFiles implements VaultFiles {
	readonly files = new Map<string, string>();

	constructor(initial: Record<string, string> = {}) {
		for (const [k, v] of Object.entries(initial)) this.files.set(k, v);
	}

	/** Files, or folders implied by the files inside them. */
	exists(path: string): boolean {
		if (this.files.has(path)) return true;
		for (const key of this.files.keys()) if (key.startsWith(`${path}/`)) return true;
		return false;
	}

	async read(path: string): Promise<string> {
		const data = this.files.get(path);
		if (data === undefined) throw new Error(`No such file: ${path}`);
		return data;
	}

	async write(path: string, data: string): Promise<void> {
		this.files.set(path, data);
	}

	async readBinary(path: string): Promise<Uint8Array> {
		return new TextEncoder().encode(await this.read(path));
	}
}
