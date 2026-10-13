<script lang="ts">
	import type { EnvironmentEntry } from "../main";
	import { icon } from "./actions";
	import { dragSource, dropTarget, type DropOptions } from "./drag";
	import RowActions from "./RowActions.svelte";

	let {
		environments,
		active,
		emptyHint,
		onSelect,
		onEdit,
		onMenu,
		onMove,
	}: {
		environments: EnvironmentEntry[];
		active: string;
		emptyHint: string;
		onSelect: (name: string) => void;
		onEdit: (path: string) => void;
		onMenu: (event: MouseEvent, path: string) => void;
		onMove: (path: string, anchor: string, position: "before" | "after") => void;
	} = $props();

	function dropRules(path: string): DropOptions {
		return {
			accepts: (item) => (item.kind === "environment" && item.path !== path ? ["before", "after"] : []),
			drop: (item, position) => item.kind === "environment" && position !== "inside" && onMove(item.path, path, position),
		};
	}
</script>

<div class="carbonwire-env-list" role="listbox" aria-label="Environments">
	<div
		class="tree-item-self is-clickable carbonwire-row carbonwire-env"
		class:is-active={active === ""}
		role="option"
		aria-selected={active === ""}
		tabindex="0"
		onclick={() => onSelect("")}
		onkeydown={(e) => e.key === "Enter" && onSelect("")}
	>
		<span class="carbonwire-env-mark" use:icon={active === "" ? "circle-dot" : "circle"}></span>
		<span class="tree-item-inner carbonwire-muted">No environment</span>
	</div>
	{#each environments as env (env.path)}
		<div
			class="tree-item-self is-clickable carbonwire-row carbonwire-env"
			class:is-active={active === env.name}
			class:has-color={env.color !== undefined}
			style:--cw-env-color={env.color}
			role="option"
			aria-selected={active === env.name}
			tabindex="0"
			title="Click to activate, double-click to edit, drag to reorder"
			onclick={() => onSelect(env.name)}
			ondblclick={() => onEdit(env.path)}
			onkeydown={(e) => e.key === "Enter" && onSelect(env.name)}
			oncontextmenu={(e) => onMenu(e, env.path)}
			use:dragSource={{ kind: "environment", path: env.path }}
			use:dropTarget={dropRules(env.path)}
		>
			<span class="carbonwire-env-mark" use:icon={active === env.name ? "circle-dot" : "circle"}></span>
			<span class="tree-item-inner">{env.name}</span>
			<RowActions onEdit={() => onEdit(env.path)} editLabel="Edit {env.name}" onMore={(e) => onMenu(e, env.path)} />
		</div>
	{/each}
	{#if environments.length === 0}
		<div class="carbonwire-hint">{emptyHint}</div>
	{/if}
</div>
