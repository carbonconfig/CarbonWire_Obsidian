<script lang="ts">
	import { Platform } from "obsidian";
	import { tick } from "svelte";
	import { findHeader } from "../core/headers";
	import type { SendResult } from "../core/sender";
	import type { SendProgress } from "../core/transport/types";
	import { icon } from "./actions";
	import CodeEditor from "./CodeEditor.svelte";
	import { formatBytes, formatMs, formatTime, statusClass } from "./format";
	import { formatJson, prettyJson } from "./json-format";
	import JsonTree from "./JsonTree.svelte";
	import PdfView from "./PdfView.svelte";

	let {
		result,
		error,
		sending,
		progress,
		restoredAt,
		wrap,
		onWrapChange,
	}: {
		result: SendResult | undefined;
		error: string | undefined;
		sending: boolean;
		progress: SendProgress | undefined;
		wrap: boolean;
		onWrapChange: (wrap: boolean) => void;
		/** When the response was reopened from history, the time it was received. */
		restoredAt?: number;
	} = $props();

	// Larger bodies are formatted in a worker; past PRETTY_LIMIT they're shown as received.
	const SYNC_FORMAT_LIMIT = 256 * 1024;
	const PRETTY_LIMIT = 50_000_000;
	// The tree parses on the main thread, so it's limited to what parses quickly.
	const TREE_LIMIT = 10_000_000;

	let tab = $state<"body" | "headers" | "timeline">("body");
	let view = $state<"text" | "tree" | "preview">("text");
	let pretty = $state(true);
	let viewer = $state<ReturnType<typeof CodeEditor>>();
	let formatted = $state.raw<{ source: string; pretty: string | undefined }>();

	/** Opens find in the response body; returns false when there is no text response to search. */
	export function openSearch(): boolean {
		if (!shown || isBinary) return false;
		tab = "body";
		view = "text";
		// The viewer mounts on the next tick when switching from another tab or view.
		void tick().then(() => viewer?.openSearch());
		return true;
	}

	const shown = $derived(result?.response);

	const contentType = $derived(shown ? (findHeader(shown.headers, "content-type") ?? "").toLowerCase() : "");
	const isImage = $derived(contentType.startsWith("image/"));
	const isPdf = $derived(contentType.includes("application/pdf"));
	/** Shown as media rather than decoded as text. */
	const isBinary = $derived(isImage || isPdf);
	const isHtml = $derived(contentType.includes("html"));
	const text = $derived(shown && !isBinary ? new TextDecoder().decode(shown.body) : "");
	const looksJson = $derived(contentType.includes("json") || (!isHtml && /^\s*[[{]/.test(text)));
	const shownView = $derived((view === "tree" && !looksJson) || (view === "preview" && !isHtml) ? "text" : view);

	const wantPretty = $derived(pretty && looksJson && text.length > 0 && text.length <= PRETTY_LIMIT);
	const prettyText = $derived.by(() => {
		if (!wantPretty) return undefined;
		if (text.length <= SYNC_FORMAT_LIMIT) return prettyJson(text);
		return formatted?.source === text ? formatted.pretty : undefined;
	});
	const formatting = $derived(wantPretty && text.length > SYNC_FORMAT_LIMIT && formatted?.source !== text);

	$effect(() => {
		if (!wantPretty || text.length <= SYNC_FORMAT_LIMIT) return;
		const source = text;
		let current = true;
		void formatJson(source).then((p) => {
			if (current) formatted = { source, pretty: p };
		});
		return () => {
			current = false;
		};
	});

	const shownText = $derived(prettyText ?? text);
	const highlightJson = $derived(prettyText !== undefined || contentType.includes("json"));

	const tree = $derived.by((): { value: unknown } | { message: string } | undefined => {
		if (shownView !== "tree") return undefined;
		if (text.length > TREE_LIMIT) return { message: `The tree view is limited to ${formatBytes(TREE_LIMIT)}. Use the text view for this response.` };
		try {
			return { value: JSON.parse(text) as unknown };
		} catch {
			return { message: "This response isn't valid JSON." };
		}
	});

	const previewDoc = $derived(shownView === "preview" ? isolatedHtml(text) : "");

	/**
	 * Previews run no scripts (sandbox) and load nothing from the network (CSP), and links can't
	 * navigate, so viewing a page never contacts its server.
	 */
	function isolatedHtml(html: string): string {
		const head = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><base target="_blank">`;
		const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? "";
		return doctype + head + html.slice(doctype.length);
	}

	const imageUrl = $derived(shown && isImage ? URL.createObjectURL(new Blob([shown.body as Uint8Array<ArrayBuffer>], { type: contentType })) : undefined);

	$effect(() => {
		const url = imageUrl;
		return () => {
			if (url) URL.revokeObjectURL(url);
		};
	});

	const PHASE_LABELS = {
		authorizing: "Getting an access token…",
		connecting: "Connecting…",
		securing: "Securing the connection…",
		sending: "Sending the request…",
		waiting: "Waiting for the server…",
		downloading: "Downloading…",
	} as const;

	/* The elapsed time ticks while a request is in flight. */
	let startedAt = $state(0);
	let now = $state(0);
	$effect(() => {
		if (!sending) return;
		startedAt = now = performance.now();
		const timer = window.setInterval(() => (now = performance.now()), 100);
		return () => window.clearInterval(timer);
	});

	const progressText = $derived.by(() => {
		const label = PHASE_LABELS[progress?.phase ?? "connecting"];
		const received = progress?.phase === "downloading" && progress.received ? ` ${formatBytes(progress.received)}${progress.total ? ` of ${formatBytes(progress.total)}` : ""}` : "";
		return `${label}${received}`;
	});
	const progressRatio = $derived(progress?.phase === "downloading" && progress.total && progress.received !== undefined ? Math.min(1, progress.received / progress.total) : undefined);

	const phases = $derived(
		result
			? [
					["DNS lookup", result.response.timings.dns],
					["TCP connect", result.response.timings.connect],
					["TLS handshake", result.response.timings.tls],
					["Waiting (TTFB)", result.response.timings.wait],
					["Download", result.response.timings.download],
				] as const
			: [],
	);
</script>

<div class="carbonwire-response">
	{#if sending}
		<div class="carbonwire-progress" class:is-indeterminate={progressRatio === undefined} role="progressbar" aria-label={progressText} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressRatio === undefined ? undefined : Math.round(progressRatio * 100)}>
			<div class="carbonwire-progress-bar" style:width={progressRatio === undefined ? undefined : `${progressRatio * 100}%`}></div>
		</div>
		<div class="carbonwire-muted carbonwire-response-placeholder carbonwire-sending">
			<div>{progressText}</div>
			<div class="carbonwire-sending-time">{formatMs(now - startedAt)}</div>
		</div>
	{:else}
		{#if result && shown}
			<div class="carbonwire-request-bar carbonwire-response-bar">
				<div class="carbonwire-tabs">
					<button class:is-active={tab === "body"} onclick={() => (tab = "body")}>Body</button>
					<button class:is-active={tab === "headers"} onclick={() => (tab = "headers")}>Headers <span class="carbonwire-count">{shown.headers.length}</span></button>
					<button class:is-active={tab === "timeline"} onclick={() => (tab = "timeline")}>Timeline</button>
				</div>
				<div class="carbonwire-response-meta">
					<span class="carbonwire-status {statusClass(shown.status)}">{shown.status} {shown.statusText}</span>
					<span>{formatMs(result.response.timings.total)}</span>
					<span>{formatBytes(result.response.bodyBytes)}</span>
					{#if result.response.truncated}<span class="carbonwire-badge">Truncated to {formatBytes(result.response.body.byteLength)}</span>{/if}
					{#if restoredAt !== undefined}<span class="carbonwire-badge" title="This response was reopened from history">From history, {formatTime(restoredAt)}</span>{/if}
					{#if formatting && tab === "body" && shownView === "text"}<span class="carbonwire-muted">Formatting…</span>{/if}
				</div>
				<span class="carbonwire-spacer"></span>
				{#if shown && tab === "body" && !isBinary}
					{#if looksJson}
						<button class="clickable-icon" class:is-active={shownView === "tree"} aria-label={shownView === "tree" ? "Show as text" : "Show as tree"} aria-pressed={shownView === "tree"} onclick={() => (view = shownView === "tree" ? "text" : "tree")} use:icon={"list-tree"}></button>
					{/if}
					{#if isHtml}
						<button class="clickable-icon" class:is-active={shownView === "preview"} aria-label={shownView === "preview" ? "Show HTML source" : "Preview HTML"} aria-pressed={shownView === "preview"} onclick={() => (view = shownView === "preview" ? "text" : "preview")} use:icon={"eye"}></button>
					{/if}
					{#if shownView === "text"}
						{#if looksJson}
							<button class="clickable-icon" class:is-active={pretty} aria-label={pretty ? "Show raw body" : "Pretty-print body"} aria-pressed={pretty} onclick={() => (pretty = !pretty)} use:icon={"wand"}></button>
						{/if}
						<button class="clickable-icon" class:is-active={wrap} aria-label={wrap ? "Don't wrap long lines" : "Wrap long lines"} aria-pressed={wrap} onclick={() => onWrapChange(!wrap)} use:icon={"text-wrap"}></button>
						<button class="clickable-icon" aria-label="Find in response" onclick={() => viewer?.openSearch()} use:icon={"search"}></button>
					{/if}
					<button class="clickable-icon" aria-label="Copy body" onclick={() => navigator.clipboard.writeText(shownText)} use:icon={"copy"}></button>
				{/if}
			</div>
		{/if}

		{#if error}
			<div class="carbonwire-error">{error}</div>
		{:else if shown}
			{#each result?.warnings ?? [] as warning, i (i)}
				<div class="carbonwire-warning">{warning}</div>
			{/each}
			<div class="carbonwire-response-content">
				{#if tab === "body"}
					{#if isImage}
						<img src={imageUrl} alt="Response" class="carbonwire-image" />
					{:else if isPdf}
						{#key shown}<PdfView data={shown.body} />{/key}
					{:else if shownView === "tree" && tree}
						{#if "value" in tree}
							{#key tree}<JsonTree value={tree.value} />{/key}
						{:else}
							<div class="carbonwire-muted carbonwire-response-placeholder">{tree.message}</div>
						{/if}
					{:else if shownView === "preview"}
						<iframe class="carbonwire-html-preview" title="HTML preview" sandbox="" srcdoc={previewDoc}></iframe>
					{:else}
						<div class="carbonwire-editor-host">
							<CodeEditor bind:this={viewer} value={shownText} language={highlightJson ? "json" : "text"} readOnly {wrap} />
						</div>
					{/if}
				{:else if tab === "headers"}
					<table class="carbonwire-table">
						<tbody>
							{#each shown.headers as [name, value], i (i)}
								<tr><td>{name}</td><td>{value}</td></tr>
							{/each}
						</tbody>
					</table>
				{:else if result}
					{@const response = result.response}
					<div class="carbonwire-timeline">
						{#each phases as [label, ms] (label)}
							<div class="carbonwire-phase">
								<span>{label}</span>
								<div class="carbonwire-phase-track">
									<div class="carbonwire-phase-bar" style:width="{response.timings.total > 0 ? (ms / response.timings.total) * 100 : 0}%"></div>
								</div>
								<span>{formatMs(ms)}</span>
							</div>
						{/each}
						<div class="carbonwire-phase is-total"><span>Total</span><span></span><span>{formatMs(response.timings.total)}</span></div>
					</div>
					<p class="carbonwire-muted">
						HTTP/{response.httpVersion}{response.remoteAddress ? ` · ${response.remoteAddress}` : ""}{response.timings.reusedConnection ? " · Reused connection" : ""}
					</p>
					{#if response.redirects.length > 0}
						<h4>Redirects</h4>
						{#each response.redirects as r, i (i)}
							<div class="carbonwire-mono">{r.status} {r.url}</div>
						{/each}
					{/if}
					<!-- Restored responses have no resolved request to show. -->
					{#if restoredAt === undefined}
						<h4>Request sent</h4>
						<div class="carbonwire-mono">{result.sent.method} {result.sent.url}</div>
						<table class="carbonwire-table">
							<tbody>
								{#each result.sent.headers as [name, value], i (i)}
									<tr><td>{name}</td><td>{value}</td></tr>
								{/each}
							</tbody>
						</table>
					{/if}
				{/if}
			</div>
		{:else}
			<div class="carbonwire-muted carbonwire-response-placeholder carbonwire-empty-response">
				<div>Send the request to see the response.</div>
				<div class="carbonwire-shortcut"><kbd>{Platform.isMacOS ? "⌘" : "Ctrl"}</kbd> + <kbd>Enter</kbd> sends from anywhere in this tab.</div>
			</div>
		{/if}
	{/if}
</div>
