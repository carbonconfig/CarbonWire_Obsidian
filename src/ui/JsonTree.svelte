<script lang="ts">
	import { Menu } from "obsidian";
	import { untrack } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { icon } from "./actions";
	import { childPath, flattenJson, type JsonRow } from "./json-tree";

	let { value }: { value: unknown } = $props();

	/* Rows have a fixed height so only the ones in view need to exist in the DOM. */
	const ROW_HEIGHT = 22;
	const OVERSCAN = 10;
	const EXPAND_ALL_LIMIT = 10_000;

	// The root and its children start open.
	const expanded = new SvelteSet<string>(["$", ...childPaths(untrack(() => value), "$")]);
	let scrollTop = $state(0);
	let height = $state(0);

	const rows = $derived(flattenJson(value, expanded));
	const start = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
	const visible = $derived(rows.slice(start, start + Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2));

	function childPaths(node: unknown, path: string): string[] {
		if (node === null || typeof node !== "object") return [];
		return Array.isArray(node) ? node.map((_, i) => childPath(path, i)) : Object.keys(node).map((k) => childPath(path, k));
	}

	function toggle(row: JsonRow) {
		if (row.size === undefined) return;
		if (expanded.has(row.path)) expanded.delete(row.path);
		else expanded.add(row.path);
	}

	/** Opens every object and array below the row, up to a limit so huge responses stay usable. */
	function expandAll(row: JsonRow) {
		const queue: [unknown, string][] = [[row.value, row.path]];
		for (let count = 0; queue.length > 0 && count < EXPAND_ALL_LIMIT; count++) {
			const [node, path] = queue.shift()!;
			if (node === null || typeof node !== "object") continue;
			expanded.add(path);
			const entries: [string | number, unknown][] = Array.isArray(node) ? node.map((v, i) => [i, v]) : Object.entries(node);
			for (const [key, child] of entries) queue.push([child, childPath(path, key)]);
		}
	}

	function collapseAll(row: JsonRow) {
		for (const path of [...expanded]) if (path === row.path || path.startsWith(row.path + ".") || path.startsWith(row.path + "[")) expanded.delete(path);
	}

	function showMenu(e: MouseEvent, row: JsonRow) {
		e.preventDefault();
		const menu = new Menu();
		const text = typeof row.value === "string" ? row.value : JSON.stringify(row.value, null, 2);
		menu.addItem((item) => item.setTitle("Copy value").setIcon("copy").onClick(() => void navigator.clipboard.writeText(text)));
		menu.addItem((item) => item.setTitle("Copy path").setIcon("route").onClick(() => void navigator.clipboard.writeText(row.path)));
		if (row.size !== undefined) {
			menu.addSeparator();
			menu.addItem((item) => item.setTitle("Expand all").setIcon("chevrons-up-down").onClick(() => expandAll(row)));
			menu.addItem((item) => item.setTitle("Collapse all").setIcon("chevrons-down-up").onClick(() => collapseAll(row)));
		}
		menu.showAtMouseEvent(e);
	}
</script>

<div class="carbonwire-json-tree" role="tree" bind:clientHeight={height} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}>
	<div class="carbonwire-json-rows" style:height="{rows.length * ROW_HEIGHT}px">
		{#each visible as row, i (row.path)}
			<div
				class="carbonwire-json-row"
				class:is-expandable={row.size !== undefined}
				role="treeitem"
				aria-expanded={row.size === undefined ? undefined : row.open}
				aria-selected="false"
				tabindex="-1"
				style:top="{(start + i) * ROW_HEIGHT}px"
				style:height="{ROW_HEIGHT}px"
				style:padding-left="{row.depth * 16 + 4}px"
				title={row.path}
				onclick={() => toggle(row)}
				onkeydown={(e) => e.key === "Enter" && toggle(row)}
				oncontextmenu={(e) => showMenu(e, row)}
			>
				{#if row.size !== undefined}
					<span class="carbonwire-json-toggle" class:is-open={row.open} use:icon={"right-triangle"}></span>
				{:else}
					<span class="carbonwire-json-toggle"></span>
				{/if}
				{#if row.key !== undefined}
					<span class="carbonwire-json-key" class:is-index={typeof row.key === "number"}>{row.key}</span><span class="carbonwire-json-colon">:</span>
				{/if}
				{#if row.size !== undefined}
					<span class="carbonwire-json-summary">{Array.isArray(row.value) ? `[${row.size}]` : `{${row.size}}`}</span>
				{:else}
					<span class="carbonwire-json-value is-{row.value === null ? "null" : typeof row.value}">{row.preview}</span>
				{/if}
			</div>
		{/each}
	</div>
</div>
