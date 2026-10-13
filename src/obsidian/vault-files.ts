import { normalizePath, type Vault } from "obsidian";
import { dirname } from "../core/storage/paths";
import type { VaultFiles, WriteOptions } from "../core/storage/store";

export class ObsidianVaultFiles implements VaultFiles {
	constructor(private readonly vault: Vault) {}

	exists(path: string): boolean {
		return this.vault.getAbstractFileByPath(normalizePath(path)) !== null;
	}

	async read(path: string): Promise<string> {
		return this.vault.cachedRead(this.file(path));
	}

	async readBinary(path: string): Promise<Uint8Array> {
		return new Uint8Array(await this.vault.readBinary(this.file(path)));
	}

	async write(path: string, data: string, options: WriteOptions = {}): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.vault.getFileByPath(normalized);
		if (existing) {
			const { ctime, mtime } = existing.stat;
			await this.vault.modify(existing, data, options.orderOnly ? { ctime, mtime: mtime + 1 } : undefined);
			return;
		}
		const dir = dirname(normalized);
		if (dir && !this.vault.getFolderByPath(dir)) await this.vault.createFolder(dir);
		await this.vault.create(normalized, data);
	}

	private file(path: string) {
		const file = this.vault.getFileByPath(normalizePath(path));
		if (!file) throw new Error(`File not found: ${path}`);
		return file;
	}
}
