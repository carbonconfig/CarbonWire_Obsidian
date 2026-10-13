import { compare, type CollectionNode, type TreeNode } from "./tree";

export type SortOrder = "manual" | "name-asc" | "name-desc" | "modified-desc" | "modified-asc" | "created-desc" | "created-asc";

export interface FileTimes {
	ctime: number;
	mtime: number;
}

export type InsertPosition = "before" | "after" | "end";

/**
 * Returns the trees in the chosen order. Manual order is the saved `seq` order that
 * buildCollections produces, plus `collectionOrder` for the collections themselves. Folders
 * always come first, and stay alphabetical when sorting by date, as in Obsidian's file explorer.
 */
export function sortCollections(
	collections: readonly CollectionNode[],
	order: SortOrder,
	times: (path: string) => FileTimes | undefined,
	collectionOrder: readonly string[] = [],
): CollectionNode[] {
	if (order === "manual") {
		const rank = new Map(collectionOrder.map((root, i) => [root, i]));
		return [...collections].sort((a, b) => (rank.get(a.root) ?? Infinity) - (rank.get(b.root) ?? Infinity) || compare(a.name, b.name));
	}
	const byName = (a: { name: string }, b: { name: string }) => (order === "name-desc" ? -1 : 1) * compare(a.name, b.name);
	const byDate = !order.startsWith("name");
	const sign = order.endsWith("-desc") ? -1 : 1;
	const time = (path: string) => {
		const t = times(path);
		return (order.startsWith("created") ? t?.ctime : t?.mtime) ?? 0;
	};
	const sortNodes = (nodes: readonly TreeNode[]): TreeNode[] =>
		nodes
			.map((n) => (n.kind === "folder" ? { ...n, children: sortNodes(n.children) } : n))
			.sort((a, b) => {
				if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
				if (byDate && a.kind === "request") return sign * (time(a.path) - time(b.path)) || compare(a.name, b.name);
				return byName(a, b);
			});
	return collections.map((c) => ({ ...c, children: sortNodes(c.children) })).sort(byName);
}

/** `keys` with `moving` taken out and put back before or after `anchor`, or at the end. */
export function insertKey(keys: readonly string[], moving: string, anchor: string | undefined, position: InsertPosition): string[] {
	const rest = keys.filter((k) => k !== moving);
	const at = anchor === undefined || position === "end" ? -1 : rest.indexOf(anchor);
	if (at < 0) return [...rest, moving];
	rest.splice(position === "after" ? at + 1 : at, 0, moving);
	return rest;
}

/** The direct children of a collection root or folder in the given trees. */
export function childrenAt(collections: readonly CollectionNode[], dir: string): TreeNode[] | undefined {
	const find = (nodes: readonly TreeNode[]): TreeNode[] | undefined => {
		for (const n of nodes) {
			if (n.kind !== "folder") continue;
			if (n.path === dir) return n.children;
			if (dir.startsWith(`${n.path}/`)) return find(n.children);
		}
		return undefined;
	};
	for (const c of collections) {
		if (c.root === dir) return c.children;
		if (c.root === "" || dir.startsWith(`${c.root}/`)) {
			const found = find(c.children);
			if (found) return found;
		}
	}
	return undefined;
}

export function findNode(collections: readonly CollectionNode[], path: string): TreeNode | undefined {
	const find = (nodes: readonly TreeNode[]): TreeNode | undefined => {
		for (const n of nodes) {
			if (n.path === path) return n;
			if (n.kind === "folder" && path.startsWith(`${n.path}/`)) return find(n.children);
		}
		return undefined;
	};
	for (const c of collections) {
		if (c.root !== "" && !path.startsWith(`${c.root}/`)) continue;
		const found = find(c.children);
		if (found) return found;
	}
	return undefined;
}

/** Every list of siblings in the trees, keyed by the collection root or folder that holds it. */
export function siblingLists(collections: readonly CollectionNode[]): Map<string, TreeNode[]> {
	const lists = new Map<string, TreeNode[]>();
	const walk = (dir: string, nodes: TreeNode[]) => {
		lists.set(dir, nodes);
		for (const n of nodes) if (n.kind === "folder") walk(n.path, n.children);
	};
	for (const c of collections) walk(c.root, c.children);
	return lists;
}

/** The `seq` each item needs so that the list reads in this order, skipping those already right. */
export function seqUpdates(ordered: readonly { path: string; seq?: number }[]): { path: string; seq: number }[] {
	return ordered.flatMap((n, i) => (n.seq === i + 1 ? [] : [{ path: n.path, seq: i + 1 }]));
}
