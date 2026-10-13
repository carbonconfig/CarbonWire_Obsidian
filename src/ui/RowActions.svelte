<script lang="ts">
	import { icon } from "./actions";

	let {
		onMore,
		onAdd,
		onEdit,
		addLabel = "Add",
		editLabel = "Edit",
	}: { onMore: (e: MouseEvent) => void; onAdd?: (e: MouseEvent) => void; onEdit?: (e: MouseEvent) => void; addLabel?: string; editLabel?: string } = $props();
</script>

<!-- Clicks and key presses here must not also toggle or open the row. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="carbonwire-row-actions" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
	{#if onAdd}
		<button class="clickable-icon carbonwire-row-add" aria-label={addLabel} onclick={onAdd} use:icon={"plus"}></button>
	{/if}
	{#if onEdit}
		<button class="clickable-icon carbonwire-row-edit" aria-label={editLabel} onclick={onEdit} use:icon={"pencil"}></button>
	{/if}
	<button class="clickable-icon carbonwire-row-more" aria-label="More options" onclick={onMore} use:icon={"more-horizontal"}></button>
</div>
