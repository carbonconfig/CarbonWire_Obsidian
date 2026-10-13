<script lang="ts">
	import type { SvelteSet } from "svelte/reactivity";
	import type { CollectionNode, TreeNode } from "../core/storage/tree";
	import { icon } from "./actions";
	import { dragSource, dropTarget, treeRowDrop, type TreeDrop } from "./drag";
	import RowActions from "./RowActions.svelte";
	import { methodLabel, type MenuTarget } from "./tree-types";
	import TreeNodes from "./TreeNodes.svelte";

	let {
		nodes,
		collection,
		expanded,
		forceOpen,
		activePath,
		drop,
		onOpen,
		onMenu,
		onAdd,
	}: {
		nodes: TreeNode[];
		collection: CollectionNode;
		expanded: SvelteSet<string>;
		forceOpen: boolean;
		activePath: string | undefined;
		drop: TreeDrop;
		onOpen: (path: string) => void;
		onMenu: (event: MouseEvent, target: MenuTarget) => void;
		onAdd: (event: MouseEvent, target: MenuTarget) => void;
	} = $props();

	function toggle(path: string) {
		if (expanded.has(path)) expanded.delete(path);
		else expanded.add(path);
	}
</script>

{#each nodes as node (node.path)}
	{#if node.kind === "folder"}
		{@const open = forceOpen || expanded.has(node.path)}
		{@const target: MenuTarget = { kind: "folder", collection, folder: node }}
		<div class="tree-item" class:is-collapsed={!open}>
			<div
				class="tree-item-self is-clickable mod-collapsible carbonwire-row"
				role="treeitem"
				aria-expanded={open}
				aria-selected="false"
				tabindex="0"
				onclick={() => toggle(node.path)}
				onkeydown={(e) => e.key === "Enter" && toggle(node.path)}
				oncontextmenu={(e) => onMenu(e, target)}
				use:dragSource={drop.enabled ? { kind: "folder", path: node.path } : undefined}
				use:dropTarget={treeRowDrop(drop, node.path, { open })}
			>
				<div class="tree-item-icon collapse-icon" class:is-collapsed={!open} use:icon={"right-triangle"}></div>
				<div class="tree-item-inner">{node.name}</div>
				<RowActions onMore={(e) => onMenu(e, target)} onAdd={(e) => onAdd(e, target)} addLabel="Add to folder" />
			</div>
			{#if open}
				<div class="tree-item-children">
					<TreeNodes nodes={node.children} {collection} {expanded} {forceOpen} {activePath} {drop} {onOpen} {onMenu} {onAdd} />
				</div>
			{/if}
		</div>
	{:else}
		{@const target: MenuTarget = { kind: "request", collection, request: node }}
		<div class="tree-item">
			<div
				class="tree-item-self is-clickable carbonwire-row"
				class:is-active={activePath === node.path}
				role="treeitem"
				aria-selected={activePath === node.path}
				tabindex="0"
				onclick={() => onOpen(node.path)}
				onkeydown={(e) => e.key === "Enter" && onOpen(node.path)}
				oncontextmenu={(e) => onMenu(e, target)}
				use:dragSource={drop.enabled ? { kind: "request", path: node.path } : undefined}
				use:dropTarget={treeRowDrop(drop, node.path, undefined)}
			>
				<span class="carbonwire-method carbonwire-method-badge" data-method={node.method ?? ""}>{node.method ? methodLabel(node.method) : ""}</span>
				<div class="tree-item-inner">{node.name}</div>
				<RowActions onMore={(e) => onMenu(e, target)} />
			</div>
		</div>
	{/if}
{/each}
