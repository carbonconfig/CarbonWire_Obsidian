<script lang="ts">
	import { untrack } from "svelte";
	import type { Cookie } from "../core/cookies";
	import { icon } from "./actions";

	let {
		initial,
		onDelete,
		onAdd,
	}: {
		initial: Cookie[];
		/** Deletes cookies for a domain, or one cookie when a name and path are given; undefined deletes all. */
		onDelete: (domain: string | undefined, name?: string, path?: string) => void;
		/** Resolves to an error to show, or undefined when the cookie was added. */
		onAdd: (url: string, setCookie: string) => Promise<string | undefined>;
	} = $props();

	let cookies = $state.raw(untrack(() => initial));
	let filter = $state("");
	let url = $state("");
	let text = $state("");
	let problem = $state<string | undefined>();

	/** Called when the jar changes. */
	export function setCookies(next: Cookie[]) {
		cookies = next;
	}

	const groups = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		const byDomain = new Map<string, Cookie[]>();
		for (const c of cookies) {
			if (q && !c.domain.includes(q) && !c.name.toLowerCase().includes(q)) continue;
			const list = byDomain.get(c.domain) ?? [];
			list.push(c);
			byDomain.set(c.domain, list);
		}
		return [...byDomain].sort(([a], [b]) => a.localeCompare(b));
	});

	async function add(e: SubmitEvent) {
		e.preventDefault();
		problem = await onAdd(url.trim(), text.trim());
		if (!problem) text = "";
	}

	const expires = (c: Cookie) => (c.expires === undefined ? "Session" : new Date(c.expires).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
</script>

<div class="carbonwire-settings carbonwire-cookie-manager">
	<div class="carbonwire-titlebar">
		<span class="carbonwire-title-input">Cookies</span>
		<span class="carbonwire-spacer"></span>
		{#if cookies.length > 0}<button onclick={() => onDelete(undefined)}>Delete all</button>{/if}
	</div>
	<p class="carbonwire-muted">
		Cookies responses set are kept for this vault on this device and sent with later requests to the same site. Turn them off for a request, folder or
		collection in its Settings.
	</p>
	<form class="carbonwire-cookie-add" onsubmit={add}>
		<input type="text" spellcheck="false" placeholder="https://api.example.com/" aria-label="URL the cookie is for" bind:value={url} />
		<input type="text" spellcheck="false" placeholder="name=value; Path=/; Max-Age=3600" aria-label="Cookie, as a Set-Cookie header value" bind:value={text} />
		<button type="submit" disabled={!url.trim() || !text.trim()}>Add</button>
	</form>
	{#if problem}<div class="carbonwire-error">{problem}</div>{/if}
	{#if cookies.length > 0}
		<input class="carbonwire-filter-input" type="search" placeholder="Filter by domain or name" aria-label="Filter cookies" bind:value={filter} />
	{/if}
	{#each groups as [domain, list] (domain)}
		<h4 class="carbonwire-cookie-domain">
			<span>{domain}</span>
			<button class="clickable-icon" aria-label="Delete the cookies for {domain}" onclick={() => onDelete(domain)} use:icon={"trash"}></button>
		</h4>
		<table class="carbonwire-table carbonwire-cookies">
			<thead><tr><th>Name</th><th>Value</th><th>Path</th><th>Expires</th><th></th><th></th></tr></thead>
			<tbody>
				{#each list as c (`${c.name}|${c.path}`)}
					<tr>
						<td>{c.name}</td>
						<td class="carbonwire-mono">{c.value}</td>
						<td>{c.path}</td>
						<td>{expires(c)}</td>
						<td class="carbonwire-muted">{[c.secure && "Secure", c.httpOnly && "HttpOnly", !c.hostOnly && "Subdomains"].filter(Boolean).join(" · ")}</td>
						<td><button class="clickable-icon" aria-label="Delete {c.name}" onclick={() => onDelete(c.domain, c.name, c.path)} use:icon={"trash"}></button></td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="carbonwire-muted">{cookies.length === 0 ? "No cookies yet." : "No cookies match."}</p>
	{/each}
</div>
