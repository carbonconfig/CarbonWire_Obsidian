import { dirname } from "../core/storage/paths";

export type DragItem = { kind: "request" | "folder"; path: string } | { kind: "collection"; root: string } | { kind: "environment"; path: string };

export type DropPosition = "before" | "after" | "inside";

export interface DropOptions {
	/** Where the dragged item may land relative to this row; empty when it cannot land here. */
	accepts(item: DragItem): readonly DropPosition[];
	drop(item: DragItem, position: DropPosition): void;
}

const DROP_CLASSES = { before: "is-drop-before", after: "is-drop-after", inside: "is-drop-inside" } as const;

/* Drag events only expose their data on drop, so the item being dragged is kept here. */
let dragging: DragItem | undefined;

/** Makes a row draggable; passing undefined turns dragging off. */
export function dragSource(node: HTMLElement, item: DragItem | undefined) {
	let current = item;
	const start = (e: DragEvent) => {
		if (!current) return;
		e.stopPropagation();
		dragging = current;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", node.textContent?.trim() ?? "");
		}
		node.addClass("is-dragging");
	};
	const end = () => {
		dragging = undefined;
		node.removeClass("is-dragging");
		for (const el of Array.from(node.doc.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-inside"))) {
			el.removeClass(...Object.values(DROP_CLASSES));
		}
	};
	node.draggable = current !== undefined;
	node.addEventListener("dragstart", start);
	node.addEventListener("dragend", end);
	return {
		update(next: DragItem | undefined) {
			current = next;
			node.draggable = next !== undefined;
		},
		destroy() {
			node.removeEventListener("dragstart", start);
			node.removeEventListener("dragend", end);
		},
	};
}

/** Shows where a dragged item would land on this row and handles the drop. */
export function dropTarget(node: HTMLElement, options: DropOptions | undefined) {
	let current = options;
	let shown: DropPosition | undefined;
	const show = (position: DropPosition | undefined) => {
		if (shown === position) return;
		if (shown) node.removeClass(DROP_CLASSES[shown]);
		shown = position;
		if (position) node.addClass(DROP_CLASSES[position]);
	};
	const positionAt = (e: DragEvent): DropPosition | undefined => {
		if (!dragging || !current) return undefined;
		const allowed = current.accepts(dragging);
		if (allowed.length === 0) return undefined;
		const rect = node.getBoundingClientRect();
		const y = (e.clientY - rect.top) / rect.height;
		const before = allowed.includes("before");
		const after = allowed.includes("after");
		if (allowed.includes("inside")) return before && y < 0.25 ? "before" : after && y > 0.75 ? "after" : "inside";
		return (before && y < 0.5) || !after ? "before" : "after";
	};
	const over = (e: DragEvent) => {
		const position = positionAt(e);
		show(position);
		if (!position) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
	};
	const leave = (e: DragEvent) => {
		if (!node.contains(e.relatedTarget as Node | null)) show(undefined);
	};
	const drop = (e: DragEvent) => {
		const position = positionAt(e);
		const item = dragging;
		show(undefined);
		if (!position || !item || !current) return;
		e.preventDefault();
		e.stopPropagation();
		current.drop(item, position);
	};
	node.addEventListener("dragover", over);
	node.addEventListener("dragleave", leave);
	node.addEventListener("drop", drop);
	return {
		update(next: DropOptions | undefined) {
			current = next;
		},
		destroy() {
			node.removeEventListener("dragover", over);
			node.removeEventListener("dragleave", leave);
			node.removeEventListener("drop", drop);
		},
	};
}

/** What the collections tree can do with a drop. */
export interface TreeDrop {
	/** False while the tree is filtered. */
	enabled: boolean;
	move(path: string, dir: string, anchor: string | undefined, position: "before" | "after" | "end"): void;
	moveCollection(root: string, anchor: string, position: "before" | "after"): void;
}

/** Whether a request or folder may move into `dir`; a folder never goes into itself. */
export function canEnter(item: DragItem, dir: string): boolean {
	if (item.kind !== "request" && item.kind !== "folder") return false;
	return item.kind === "request" || (dir !== item.path && !dir.startsWith(`${item.path}/`));
}

/** Drop rules for a request or folder row. Expanded rows have their children below, so no "after". */
export function treeRowDrop(drop: TreeDrop, path: string, folder: { open: boolean } | undefined): DropOptions | undefined {
	if (!drop.enabled) return undefined;
	const parent = dirname(path);
	return {
		accepts: (item) => {
			if (item.kind === "collection" || item.kind === "environment" || item.path === path) return [];
			const out: DropPosition[] = [];
			if (canEnter(item, parent)) out.push("before", ...(folder?.open ? [] : (["after"] as const)));
			if (folder && canEnter(item, path)) out.push("inside");
			return out;
		},
		drop: (item, position) => {
			if (item.kind !== "request" && item.kind !== "folder") return;
			if (position === "inside") drop.move(item.path, path, undefined, "end");
			else drop.move(item.path, parent, path, position);
		},
	};
}

/** Drop rules for a collection row: requests and folders go inside, collections reorder. */
export function collectionRowDrop(drop: TreeDrop, root: string, open: boolean): DropOptions | undefined {
	if (!drop.enabled) return undefined;
	return {
		accepts: (item) => {
			if (item.kind === "collection") return item.root !== root ? ["before", ...(open ? [] : (["after"] as const))] : [];
			return canEnter(item, root) ? ["inside"] : [];
		},
		drop: (item, position) => {
			if (item.kind === "collection" && position !== "inside") drop.moveCollection(item.root, root, position);
			else if (item.kind === "request" || item.kind === "folder") drop.move(item.path, root, undefined, "end");
		},
	};
}
