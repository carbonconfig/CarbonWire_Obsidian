<script lang="ts">
	import { untrack } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { filterCollections, type CollectionNode } from "../core/storage/tree";
	import { icon } from "./actions";
	import CollectionsTree from "./CollectionsTree.svelte";
	import type { TreeDrop } from "./drag";
	import EnvironmentsPanel from "./EnvironmentsPanel.svelte";
	import HistoryPanel from "./HistoryPanel.svelte";
	import type { HistoryEntry } from "../obsidian/history";
	import type { EnvironmentEntry } from "../main";
	import type { MenuTarget } from "./tree-types";

	let {
		initial,
		initialEnvironments,
		initialActiveEnvironment,
		onOpen,
		onMenu,
		onAdd,
		onNewCollection,
		onNewEnvironment,
		onAddMenu,
		onImportMenu,
		onSelectEnvironment,
		onEditEnvironment,
		onSortMenu,
		onMove,
		onMoveCollection,
		onMoveEnvironment,
		onShowHistory,
		onOpenHistory,
		onHistoryMenu,
		onClearHistory,
	}: {
		initial: CollectionNode[];
		/** Environments, shared by every collection. */
		initialEnvironments: EnvironmentEntry[];
		initialActiveEnvironment: string;
		onOpen: (path: string) => void;
		onMenu: (event: MouseEvent, target: MenuTarget) => void;
		onAdd: (event: MouseEvent, target: MenuTarget) => void;
		onNewCollection: () => void;
		onNewEnvironment: () => void;
		onAddMenu: (event: MouseEvent) => void;
		onImportMenu: (event: MouseEvent) => void;
		onSelectEnvironment: (name: string) => void;
		onEditEnvironment: (path: string) => void;
		onSortMenu: (event: MouseEvent) => void;
		onMove: TreeDrop["move"];
		onMoveCollection: TreeDrop["moveCollection"];
		onMoveEnvironment: (path: string, anchor: string, position: "before" | "after") => void;
		/** Called when History is first shown, so it loads only when needed. */
		onShowHistory: () => void;
		onOpenHistory: (entry: HistoryEntry) => void;
		onHistoryMenu: (event: MouseEvent, entry: HistoryEntry) => void;
		onClearHistory: () => void;
	} = $props();

	const first = untrack(() => initial);
	let collections = $state.raw(first);
	let environments = $state.raw(untrack(() => initialEnvironments));
	let activeName = $state(untrack(() => initialActiveEnvironment));
	let activePath = $state<string | undefined>();
	let query = $state("");
	let search: HTMLInputElement;
	let mode = $state<"collections" | "history">("collections");
	let history = $state.raw<readonly HistoryEntry[] | undefined>();
	const expanded = new SvelteSet<string>(first.map((c) => `collection:${c.root}`));

	const visible = $derived(filterCollections(collections, query));
	const active = $derived(environments.some((e) => e.name === activeName) ? activeName : "");
	const drop: TreeDrop = $derived({ enabled: query.trim() === "", move: onMove, moveCollection: onMoveCollection });

	export function update(next: CollectionNode[], nextEnvironments: EnvironmentEntry[]) {
		collections = next;
		environments = nextEnvironments;
	}

	export function setActive(path: string | undefined) {
		activePath = path;
	}

	export function environmentChanged(name: string) {
		activeName = name;
	}

	export function setHistory(entries: readonly HistoryEntry[]) {
		history = entries;
	}

	function showHistory() {
		mode = "history";
		if (history === undefined) onShowHistory();
	}
</script>

<div class="carbonwire-sidebar">
	<div class="carbonwire-topbar">
		<div class="search-input-container carbonwire-search">
			<input
				bind:this={search}
				type="search"
				placeholder={mode === "history" ? "Filter history…" : "Filter requests…"}
				spellcheck="false"
				aria-label="Filter requests"
				bind:value={query}
				onkeydown={(e) => e.key === "Escape" && (query = "")}
			/>
			{#if query}
				<div
					class="search-input-clear-button"
					role="button"
					tabindex="-1"
					aria-label="Clear filter"
					onclick={() => {
						query = "";
						search.focus();
					}}
					onkeydown={() => {}}
				></div>
			{/if}
		</div>
		<button class="clickable-icon" aria-label="Add" onclick={onAddMenu} use:icon={"plus"}></button>
		<button class="clickable-icon" aria-label="Import" onclick={onImportMenu} use:icon={"import"}></button>
	</div>

	<section class="carbonwire-section is-collections">
		<header class="carbonwire-section-header">
			<div class="carbonwire-section-tabs" role="tablist">
				<button role="tab" aria-selected={mode === "collections"} class:is-active={mode === "collections"} onclick={() => (mode = "collections")}>Collections</button>
				<button role="tab" aria-selected={mode === "history"} class:is-active={mode === "history"} onclick={showHistory}>History</button>
			</div>
			{#if mode === "collections"}
				<button class="clickable-icon" aria-label="Sort" onclick={onSortMenu} use:icon={"arrow-up-narrow-wide"}></button>
				<button class="clickable-icon" aria-label="Collapse all" onclick={() => expanded.clear()} use:icon={"chevrons-down-up"}></button>
			{:else}
				<button class="clickable-icon" aria-label="Clear history" disabled={!history?.length} onclick={onClearHistory} use:icon={"trash"}></button>
			{/if}
		</header>
		<div class="carbonwire-section-body">
			{#if mode === "history"}
				<HistoryPanel entries={history} {query} onOpen={onOpenHistory} onMenu={onHistoryMenu} />
			{:else}
				<CollectionsTree collections={visible} {expanded} filtering={query.trim() !== ""} {activePath} {drop} {onOpen} {onMenu} {onAdd} {onNewCollection} />
			{/if}
		</div>
	</section>

	<section class="carbonwire-section is-environments">
		<header class="carbonwire-section-header">
			<span class="carbonwire-section-title">Environments</span>
			<button class="clickable-icon" aria-label="New environment" onclick={onNewEnvironment} use:icon={"plus"}></button>
		</header>
		<div class="carbonwire-section-body">
			<EnvironmentsPanel
				{environments}
				{active}
				emptyHint="No environments yet. The active one applies to every collection."
				onSelect={onSelectEnvironment}
				onEdit={onEditEnvironment}
				onMenu={(e, path) => onMenu(e, { kind: "environment", path })}
				onMove={onMoveEnvironment}
			/>
		</div>
	</section>
</div>
