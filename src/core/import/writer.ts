import type { Environment, SecretVariable, Variable } from "../model";
import { stem } from "../storage/paths";
import type { CollectionStore } from "../storage/store";
import { countItems, ImportError, type ImportedCollection, type ImportedEnvironment, type ImportedItem, type ImportedVariable, type ImportResult } from "./model";

/** "environments" is for files that contain only environments. */
export type ImportTarget = { kind: "new"; dir: string } | { kind: "existing"; root: string } | { kind: "environments" };

/** What to do when an imported environment has the same name as an existing one. */
export type EnvironmentResolution = { action: "rename"; name: string } | { action: "merge"; prefer: "imported" | "existing" };

export interface WriteOptions {
	/** Where every imported environment goes; environments are shared by all collections. */
	environmentsDir: string;
	/** Stores a secret variable's value outside the vault, keyed by its environment file. */
	setSecret?: (environmentPath: string, name: string, value: string) => void;
	/** Keyed by imported environment name. Conflicts without a resolution get a numbered name. */
	resolutions?: ReadonlyMap<string, EnvironmentResolution>;
}

export interface WriteSummary {
	roots: string[];
	requests: number;
	folders: number;
	/** Environment files written or merged into, by display name. */
	environments: string[];
}

export async function writeImport(store: CollectionStore, result: ImportResult, target: ImportTarget, options: WriteOptions): Promise<WriteSummary> {
	const summary: WriteSummary = { roots: [], requests: 0, folders: 0, environments: [] };
	const allEnvironments = [...result.collections.flatMap((c) => c.environments), ...result.environments];

	if (target.kind === "environments") {
		if (result.collections.length > 0) throw new ImportError("This file contains requests; import it as a collection.");
	} else if (result.collections.length === 0) {
		throw new ImportError("This file only contains environments; import it as environments.");
	}

	for (const collection of result.collections) {
		if (target.kind === "new") {
			const root = await store.createCollection(target.dir, collection.name, collection.defaults, collection.docs);
			await writeItems(store, root, collection.items);
			summary.roots.push(root);
		} else if (target.kind === "existing") {
			const root = target.root;
			if (isSingleRequest(collection)) {
				await writeItems(store, root, collection.items);
			} else {
				// Collection-level settings become the defaults of a folder inside the existing collection.
				const dir = await store.createFolder(root, collection.name, { ...collection.defaults, auth: collection.defaults.auth ?? "inherit" }, undefined, collection.docs);
				await writeItems(store, dir, collection.items);
				summary.folders++;
			}
		}
		const { requests, folders } = countItems(collection.items);
		summary.requests += requests;
		summary.folders += folders;
	}
	if (target.kind === "existing") summary.roots.push(target.root);
	summary.environments.push(...(await writeEnvironments(store, options.environmentsDir, allEnvironments, options)));
	return summary;
}

function isSingleRequest(collection: ImportedCollection): boolean {
	const { requests, folders } = countItems(collection.items);
	return requests === 1 && folders === 0 && Object.keys(collection.defaults).length === 0;
}

async function writeItems(store: CollectionStore, dir: string, items: readonly ImportedItem[]): Promise<void> {
	let seq = 1;
	for (const item of items) {
		if (item.kind === "request") {
			await store.createRequest(dir, item.name, item.request, seq++);
		} else {
			const folderDir = await store.createFolder(dir, item.name, item.defaults, seq++, item.docs);
			await writeItems(store, folderDir, item.items);
		}
	}
}

function toVariable(v: ImportedVariable): Variable | SecretVariable {
	const disabled = v.disabled ? { disabled: true } : {};
	return v.secret ? { secret: true, name: v.name, ...disabled } : { name: v.name, value: v.value, ...disabled };
}

async function writeEnvironments(store: CollectionStore, dir: string, environments: readonly ImportedEnvironment[], options: WriteOptions): Promise<string[]> {
	const written: string[] = [];
	for (const env of environments) {
		const resolution = options.resolutions?.get(env.name);
		const existing = store.environmentPath(dir, env.name);
		if (resolution?.action === "merge" && store.exists(existing)) {
			await mergeEnvironment(store, existing, env, resolution.prefer, options);
			written.push(stem(existing));
			continue;
		}
		const name = resolution?.action === "rename" ? resolution.name : env.name;
		const path = await store.createEnvironmentIn(dir, name, { name, variables: env.variables.map(toVariable) });
		for (const v of env.variables) if (v.secret && v.value) options.setSecret?.(path, v.name, v.value);
		written.push(stem(path));
	}
	return written;
}

/** Adds imported variables to an environment file, creating it if needed. */
export async function mergeEnvironment(store: CollectionStore, path: string, env: ImportedEnvironment, prefer: "imported" | "existing", options: WriteOptions): Promise<void> {
	const doc = store.exists(path) ? await store.loadDocument<Environment>(path) : ({ name: stem(path) } as Environment);
	const variables = [...(doc.variables ?? [])];
	for (const v of env.variables) {
		const i = variables.findIndex((x) => x.name === v.name);
		if (i >= 0 && prefer === "existing") continue;
		if (i >= 0) variables[i] = toVariable(v);
		else variables.push(toVariable(v));
		if (v.secret && v.value) options.setSecret?.(path, v.name, v.value);
	}
	await store.saveDocument(path, { ...doc, name: doc.name || stem(path), variables });
}
