import { normalizePath, type Vault } from "obsidian";
import { dirname } from "../core/storage/paths";
import type { VaultFiles, WriteOptions } from "../core/storage/store";

/** True for paths in dot-folders, such as .carbonwire/, which the vault doesn't list. */
export const isHidden = (path: string) => path.split("/").some((part) => part.startsWith("."));

export class ObsidianVaultFiles implements VaultFiles {
	constructor(private readonly vault: Vault) {}

	exists(path: string): boolean {
		return this.vault.getAbstractFileByPath(normalizePath(path)) !== null;
	}

	async read(path: string): Promise<string> {
		if (isHidden(path)) return this.vault.adapter.read(normalizePath(path));
		return this.vault.cachedRead(this.file(path));
	}

	async readBinary(path: string): Promise<Uint8Array> {
		return new Uint8Array(await this.vault.readBinary(this.file(path)));
	}

	async write(path: string, data: string, options: WriteOptions = {}): Promise<void> {
		const normalized = normalizePath(path);
		if (isHidden(normalized)) {
			const dir = dirname(normalized);
			if (dir && !(await this.vault.adapter.exists(dir))) await this.vault.adapter.mkdir(dir);
			await this.vault.adapter.write(normalized, data);
			return;
		}
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
