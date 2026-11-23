<script lang="ts">
	import { untrack } from "svelte";
	import { icon } from "./actions";
	import { formatBytes, formatMs, statusClass } from "./format";
	import type { ConsoleEntry } from "./types";

	/* Every request as it went out (variables, auth, cookies and redirects applied) and what came back. */
	let {
		initial,
		onClear,
		onCopy,
	}: {
		initial: ConsoleEntry[];
		onClear: () => void;
		onCopy: (text: string) => void;
	} = $props();

	let entries = $state.raw(untrack(() => initial));
	let open = $state<number | undefined>();
	let filter = $state("");
	let list: HTMLDivElement;

	export function add(entry: ConsoleEntry) {
		const atEnd = list && list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
		entries = [...entries.slice(-199), entry];
		// Keeps following new sends unless the list was scrolled up.
		if (atEnd) requestAnimationFrame(() => list?.scrollTo({ top: list.scrollHeight }));
	}

	export function clear() {
		entries = [];
		open = undefined;
	}

	const shown = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		return q ? entries.filter((e) => `${e.method} ${e.url} ${e.status ?? ""} ${e.name}`.toLowerCase().includes(q)) : entries;
	});

	const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour12: false });
	const headerText = (headers: readonly (readonly [string, string])[] | undefined) => (headers ?? []).map(([n, v]) => `${n}: ${v}`).join("\n");

	function asText(e: ConsoleEntry): string {
		let out = `${e.method} ${e.url}\n${headerText(e.requestHeaders)}`;
		if (e.requestBody) out += `\n\n${e.requestBody}`;
		if (e.error) return `${out}\n\nError: ${e.error}`;
		out += `\n\nHTTP/${e.httpVersion ?? "1.1"} ${e.status ?? ""} ${e.statusText ?? ""}\n${headerText(e.responseHeaders)}`;
		if (e.responseBody) out += `\n\n${e.responseBody}`;
		return out;
	}
</script>

<div class="carbonwire-console">
	<div class="carbonwire-console-bar">
		<input type="search" placeholder="Filter by method, URL or status" aria-label="Filter the console" bind:value={filter} />
		<span class="carbonwire-spacer"></span>
		<span class="carbonwire-muted">{entries.length === 0 ? "" : `${entries.length} ${entries.length === 1 ? "request" : "requests"}`}</span>
		<button class="clickable-icon" aria-label="Clear the console" onclick={() => (onClear(), clear())} use:icon={"trash"}></button>
	</div>
	<div class="carbonwire-console-list" bind:this={list}>
		{#each shown as e (e.id)}
			<div class="carbonwire-console-entry" class:is-open={open === e.id}>
				<button class="carbonwire-console-row" aria-expanded={open === e.id} onclick={() => (open = open === e.id ? undefined : e.id)}>
					<span class="carbonwire-muted carbonwire-console-time">{time(e.time)}</span>
					<span class="carbonwire-method" data-method={e.method}>{e.method}</span>
					{#if e.error}
						<span class="carbonwire-status is-server-error">Error</span>
					{:else}
						<span class="carbonwire-status {statusClass(e.status ?? 0)}">{e.status}</span>
					{/if}
					<span class="carbonwire-console-url">{e.url}</span>
					<span class="carbonwire-muted">{e.durationMs === undefined ? "" : formatMs(e.durationMs)}</span>
				</button>
				{#if open === e.id}
					<div class="carbonwire-console-detail">
						<div class="carbonwire-console-actions">
							<span class="carbonwire-muted">{e.name}{e.proxy ? ` · through ${e.proxy}` : ""}{e.remoteAddress ? ` · ${e.remoteAddress}` : ""}{e.tls?.protocol ? ` · ${e.tls.protocol}` : ""}</span>
							<span class="carbonwire-spacer"></span>
							<button class="clickable-icon" aria-label="Copy as text" onclick={() => onCopy(asText(e))} use:icon={"copy"}></button>
						</div>
						{#each e.redirects ?? [] as r, i (i)}
							<div class="carbonwire-mono carbonwire-muted">{r.status} {r.url}</div>
						{/each}
						<h4>Request</h4>
						<pre class="carbonwire-mono">{e.method} {e.url}
{headerText(e.requestHeaders)}{e.requestBody ? `\n\n${e.requestBody}` : ""}{e.requestBytes > (e.requestBody?.length ?? 0) && e.requestBytes > 0 ? `\n\n(${formatBytes(e.requestBytes)} body)` : ""}</pre>
						{#if e.error}
							<div class="carbonwire-error">{e.error}</div>
						{:else}
							<h4>Response</h4>
							<pre class="carbonwire-mono">HTTP/{e.httpVersion} {e.status} {e.statusText}
{headerText(e.responseHeaders)}{e.responseBody ? `\n\n${e.responseBody}` : e.responseBytes ? `\n\n(${formatBytes(e.responseBytes)} body)` : ""}</pre>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<p class="carbonwire-muted carbonwire-console-empty">{entries.length === 0 ? "Requests you send show here as they went out: variables, auth, cookies and redirects applied." : "No requests match."}</p>
		{/each}
	</div>
</div>
