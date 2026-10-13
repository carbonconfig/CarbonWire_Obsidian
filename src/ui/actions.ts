import { setIcon } from "obsidian";

/** Svelte action that renders an Obsidian (Lucide) icon into the element. */
export function icon(node: HTMLElement, name: string) {
	setIcon(node, name);
	return {
		update(next: string) {
			setIcon(node, next);
		},
	};
}
