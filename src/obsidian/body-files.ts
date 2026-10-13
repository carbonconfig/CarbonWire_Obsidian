import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { Vault } from "obsidian";
import { joinPath } from "../core/storage/paths";

/** Reads a body file: relative paths are inside the collection, absolute paths are read from disk. */
export async function readBodyFile(vault: Vault, collectionRoot: string, file: string): Promise<Uint8Array> {
	if (isAbsolute(file)) return readFile(file);
	const vaultFile = vault.getFileByPath(joinPath(collectionRoot, file));
	if (!vaultFile) throw new Error(`Body file not found: ${file}`);
	return new Uint8Array(await vault.readBinary(vaultFile));
}
