import type { HttpRequest, RequestDefaults } from "../model";

export interface ImportedRequest {
	kind: "request";
	name: string;
	request: HttpRequest;
}

export interface ImportedFolder {
	kind: "folder";
	name: string;
	/** Folder defaults. Importers set `auth: "inherit"` explicitly where the source inherits. */
	defaults: RequestDefaults;
	docs?: string;
	items: ImportedItem[];
}

export type ImportedItem = ImportedRequest | ImportedFolder;

export interface ImportedVariable {
	name: string;
	value: string;
	disabled?: boolean;
	/** Secret values go to Obsidian's secret storage instead of the vault. */
	secret?: boolean;
}

export interface ImportedEnvironment {
	name: string;
	variables: ImportedVariable[];
}

export interface ImportedCollection {
	name: string;
	defaults: RequestDefaults;
	docs?: string;
	items: ImportedItem[];
	environments: ImportedEnvironment[];
}

export interface ImportResult {
	format: string;
	collections: ImportedCollection[];
	/** Environments that arrived without a collection, e.g. a Postman environment file. */
	environments: ImportedEnvironment[];
	warnings: string[];
}

export class ImportError extends Error {
	override name = "ImportError";
}

/** Collects warnings once each, with how often they occurred. */
export class Warnings {
	private readonly counts = new Map<string, number>();

	add(message: string): void {
		this.counts.set(message, (this.counts.get(message) ?? 0) + 1);
	}

	list(): string[] {
		return [...this.counts].map(([message, n]) => (n > 1 ? `${message} (${n}×)` : message));
	}
}

export function countItems(items: readonly ImportedItem[]): { requests: number; folders: number } {
	let requests = 0;
	let folders = 0;
	for (const item of items) {
		if (item.kind === "request") {
			requests++;
		} else {
			folders++;
			const nested = countItems(item.items);
			requests += nested.requests;
			folders += nested.folders;
		}
	}
	return { requests, folders };
}
