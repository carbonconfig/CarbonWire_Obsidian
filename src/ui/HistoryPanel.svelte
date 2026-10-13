<script lang="ts">
	import type { HistoryEntry } from "../obsidian/history";
	import { dayLabel, formatClock, statusClass } from "./format";
	import { methodLabel } from "./tree-types";

	let {
		entries,
		query,
		onOpen,
		onMenu,
	}: {
		/** Undefined while history loads. */
		entries: readonly HistoryEntry[] | undefined;
		query: string;
		onOpen: (entry: HistoryEntry) => void;
		onMenu: (event: MouseEvent, entry: HistoryEntry) => void;
	} = $props();

	const filtered = $derived.by(() => {
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (!entries || terms.length === 0) return entries ?? [];
		return entries.filter((e) => {
			const text = `${e.request.http?.method ?? "GET"} ${e.name} ${e.request.http?.url ?? ""} ${e.response?.status ?? ""} ${e.environment ?? ""}`.toLowerCase();
			return terms.every((t) => text.includes(t));
		});
	});

	const groups = $derived.by(() => {
		const out: { label: string; entries: HistoryEntry[] }[] = [];
		for (const entry of filtered) {
			const label = dayLabel(entry.time);
			if (out.at(-1)?.label !== label) out.push({ label, entries: [] });
			out.at(-1)!.entries.push(entry);
		}
		return out;
	});
</script>

<div class="carbonwire-history">
	{#if entries === undefined}
		<div class="carbonwire-hint">Loading…</div>
	{:else if entries.length === 0}
		<div class="carbonwire-hint">Requests you send appear here, saved or not.</div>
	{:else if filtered.length === 0}
		<div class="carbonwire-hint">No history matches your search.</div>
	{/if}
	{#each groups as group (group.label)}
		<div class="carbonwire-history-day">{group.label}</div>
		{#each group.entries as entry (entry.id)}
			{@const method = (entry.request.http?.method ?? "GET").toUpperCase()}
			<div
				class="tree-item-self is-clickable carbonwire-row carbonwire-history-row"
				role="button"
				tabindex="0"
				title={`${method} ${entry.request.http?.url ?? ""}${entry.environment ? `\nEnvironment: ${entry.environment}` : ""}${entry.error ? `\n${entry.error}` : ""}`}
				onclick={() => onOpen(entry)}
				onkeydown={(e) => e.key === "Enter" && onOpen(entry)}
				oncontextmenu={(e) => onMenu(e, entry)}
			>
				<span class="carbonwire-method carbonwire-method-badge" data-method={method}>{methodLabel(method)}</span>
				<div class="tree-item-inner">{entry.name}</div>
				{#if entry.response}
					<span class="carbonwire-history-status carbonwire-status {statusClass(entry.response.status)}">{entry.response.status}</span>
				{:else}
					<span class="carbonwire-history-status carbonwire-status is-server-error">Error</span>
				{/if}
				<span class="carbonwire-history-time">{formatClock(entry.time)}</span>
			</div>
		{/each}
	{/each}
</div>
