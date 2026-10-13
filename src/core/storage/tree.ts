import { basename, dirname, stem } from "./paths";

export const COLLECTION_FILE = "opencollection.yml";
export const FOLDER_FILE = "folder.yml";
export const ENVIRONMENTS_DIR = "environments";

export interface RequestNode {
	kind: "request";
	path: string;
	name: string;
	method?: string;
	seq?: number;
}

export interface FolderNode {
	kind: "folder";
	path: string;
	name: string;
	hasConfig: boolean;
	seq?: number;
	children: TreeNode[];
}

/** Light metadata read from a request, folder.yml or environment file, without a full YAML parse. */
export interface FileMeta {
	method?: string;
	seq?: number;
	/** An environment's top-level `color`. */
	color?: string;
}

/** Pulls `method:`, `seq:` and a top-level `color:` out of a file with regexes. */
export function extractMeta(text: string): FileMeta {
	const method = /^\s+method:\s*["']?([A-Za-z]+)/m.exec(text)?.[1]?.toUpperCase();
	const seqText = /^\s+seq:\s*(\d+)/m.exec(text)?.[1];
	const color = /^color:\s*["']?(#[0-9a-fA-F]{3,8})["']?\s*$/m.exec(text)?.[1];
	return { ...(method ? { method } : {}), ...(seqText ? { seq: Number(seqText) } : {}), ...(color ? { color } : {}) };
}

export type TreeNode = FolderNode | RequestNode;

export interface CollectionNode {
	root: string;
	name: string;
	children: TreeNode[];
	environments: string[];
}

const YAML = /\.ya?ml$/i;

export function isYaml(path: string): boolean {
	return YAML.test(path);
}

/**
 * Builds every collection tree from vault paths alone, without reading files, so it stays fast on
 * large vaults. Methods and ordering come from `meta` once it has been read in the background.
 */
export function buildCollections(paths: Iterable<string>, vaultName = "Vault", meta: ReadonlyMap<string, FileMeta> = new Map()): CollectionNode[] {
	const yamlPaths: string[] = [];
	const roots: string[] = [];
	for (const p of paths) {
		if (!YAML.test(p)) continue;
		yamlPaths.push(p);
		if (basename(p) === COLLECTION_FILE) roots.push(dirname(p));
	}
	if (roots.length === 0) return [];

	// Longest root first so files in a nested collection belong to the innermost one.
	roots.sort((a, b) => b.length - a.length);
	const collections = new Map<string, CollectionNode>();
	const folders = new Map<string, FolderNode>();
	for (const root of roots) {
		collections.set(root, { root, name: root ? basename(root) : vaultName, children: [], environments: [] });
	}

	const folderFor = (collection: CollectionNode, dir: string): CollectionNode | FolderNode => {
		if (dir === collection.root) return collection;
		const existing = folders.get(dir);
		if (existing) return existing;
		const folder: FolderNode = { kind: "folder", path: dir, name: basename(dir), hasConfig: false, children: [] };
		folders.set(dir, folder);
		folderFor(collection, dirname(dir)).children.push(folder);
		return folder;
	};

	for (const path of yamlPaths) {
		const root = roots.find((r) => r === "" || path.startsWith(`${r}/`));
		if (root === undefined) continue;
		const collection = collections.get(root)!;
		const dir = dirname(path);
		const name = basename(path);
		if (dir === root && name === COLLECTION_FILE) continue;
		if (dirname(dir) === root && basename(dir) === ENVIRONMENTS_DIR) {
			collection.environments.push(path);
			continue;
		}
		if (name === FOLDER_FILE) {
			const folder = folderFor(collection, dir);
			if (folder !== collection) {
				(folder as FolderNode).hasConfig = true;
				const seq = meta.get(path)?.seq;
				if (seq !== undefined) (folder as FolderNode).seq = seq;
			}
			continue;
		}
		const m = meta.get(path);
		folderFor(collection, dir).children.push({ kind: "request", path, name: stem(path), ...m });
	}

	const result = [...collections.values()];
	for (const c of result) {
		sortTree(c.children);
		c.environments.sort();
	}
	return result.sort((a, b) => compare(a.name, b.name));
}

/** Items with a `seq` keep their saved order; the rest follow, folders first, then by name. */
function sortTree(nodes: TreeNode[]): void {
	nodes.sort((a, b) => {
		const bySeq = (a.seq ?? Infinity) - (b.seq ?? Infinity);
		if (bySeq !== 0 && !Number.isNaN(bySeq)) return bySeq;
		if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
		return compare(a.name, b.name);
	});
	for (const n of nodes) if (n.kind === "folder") sortTree(n.children);
}

/**
 * Keeps requests whose name or method matches every search term, plus the folders leading to
 * them. A matching folder or collection name keeps everything inside it.
 */
export function filterCollections(collections: readonly CollectionNode[], query: string): CollectionNode[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [...collections];
	const matches = (text: string) => terms.every((t) => text.toLowerCase().includes(t));
	const filterNodes = (nodes: readonly TreeNode[]): TreeNode[] =>
		nodes.flatMap((n): TreeNode[] => {
			if (n.kind === "request") return matches(`${n.method ?? ""} ${n.name}`) ? [n] : [];
			if (matches(n.name)) return [n];
			const children = filterNodes(n.children);
			return children.length > 0 ? [{ ...n, children }] : [];
		});
	return collections.flatMap((c) => {
		if (matches(c.name)) return [c];
		const children = filterNodes(c.children);
		return children.length > 0 ? [{ ...c, children }] : [];
	});
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export function compare(a: string, b: string): number {
	return collator.compare(a, b);
}
