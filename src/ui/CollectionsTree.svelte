<script lang="ts">
	import type { SvelteSet } from "svelte/reactivity";
	import type { CollectionNode } from "../core/storage/tree";
	import { icon } from "./actions";
	import { collectionRowDrop, dragSource, dropTarget, type TreeDrop } from "./drag";
	import RowActions from "./RowActions.svelte";
	import type { MenuTarget } from "./tree-types";
	import TreeNodes from "./TreeNodes.svelte";

	let {
		collections,
		expanded,
		filtering,
		activePath,
		drop,
		onOpen,
		onMenu,
		onAdd,
		onNewCollection,
	}: {
		collections: CollectionNode[];
		expanded: SvelteSet<string>;
		filtering: boolean;
		activePath: string | undefined;
		drop: TreeDrop;
		onOpen: (path: string) => void;
		onMenu: (event: MouseEvent, target: MenuTarget) => void;
		onAdd: (event: MouseEvent, target: MenuTarget) => void;
		onNewCollection: () => void;
	} = $props();

	function toggle(key: string) {
		if (expanded.has(key)) expanded.delete(key);
		else expanded.add(key);
	}
</script>

<div class="carbonwire-tree" role="tree">
	{#if collections.length === 0}
		<div class="carbonwire-empty">
			{#if filtering}
				<p>No requests match your search.</p>
			{:else}
				<p>No collections yet.</p>
				<button class="mod-cta" onclick={onNewCollection}>Create collection</button>
			{/if}
		</div>
	{/if}
	{#each collections as collection (collection.root)}
		{@const key = `collection:${collection.root}`}
		{@const open = filtering || expanded.has(key)}
		{@const target: MenuTarget = { kind: "collection", collection }}
		<div class="tree-item" class:is-collapsed={!open}>
			<div
				class="tree-item-self is-clickable mod-collapsible carbonwire-row carbonwire-collection"
				role="treeitem"
				aria-expanded={open}
				aria-selected="false"
				tabindex="0"
				onclick={() => toggle(key)}
				onkeydown={(e) => e.key === "Enter" && toggle(key)}
				oncontextmenu={(e) => onMenu(e, target)}
				use:dragSource={drop.enabled ? { kind: "collection", root: collection.root } : undefined}
				use:dropTarget={collectionRowDrop(drop, collection.root, open)}
			>
				<div class="tree-item-icon collapse-icon" class:is-collapsed={!open} use:icon={"right-triangle"}></div>
				<div class="tree-item-inner">{collection.name}</div>
				<RowActions onMore={(e) => onMenu(e, target)} onAdd={(e) => onAdd(e, target)} addLabel="Add to collection" />
			</div>
			{#if open}
				<div class="tree-item-children">
					{#if collection.children.length === 0}
						<div class="carbonwire-hint">Use + to add a request.</div>
					{/if}
					<TreeNodes nodes={collection.children} {collection} {expanded} forceOpen={filtering} {activePath} {drop} {onOpen} {onMenu} {onAdd} />
				</div>
			{/if}
		</div>
	{/each}
</div>
