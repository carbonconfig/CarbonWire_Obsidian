<script lang="ts">
	import { Platform } from "obsidian";
	import { tick, untrack } from "svelte";
	import type { ResponseView } from "./request-tab";
	import { findHeader } from "../core/headers";
	import type { SendResult } from "../core/sender";
	import type { SendProgress } from "../core/transport/types";
	import { icon } from "./actions";
	import CodeEditor from "./CodeEditor.svelte";
	import { formatBytes, formatMs, formatTime, statusClass } from "./format";
	import { formatJson, prettyJson } from "./json-format";
	import { queryJson } from "../core/jsonpath";
	import JsonTree from "./JsonTree.svelte";
	import PdfView from "./PdfView.svelte";
	import { parseSetCookie } from "../core/cookies";
	import { OPERATORS } from "../core/after-response";

	let {
		result,
		error,
		sending,
		progress,
		restoredAt,
		wrap,
		onWrapChange,
		example,
		onSaveBody,
		onSaveExample,
		onSaveVariable,
		initialView,
		onviewchange,
		cancelledAfter,
		oncancel,
		onsendagain,
	}: {
		result: SendResult | undefined;
		error: string | undefined;
		sending: boolean;
		progress: SendProgress | undefined;
		wrap: boolean;
		onWrapChange: (wrap: boolean) => void;
		/** When the response was reopened from history, the time it was received. */
		restoredAt?: number;
		/** Set when a saved example is shown instead of a response. */
		example?: string;
		onSaveBody?: () => void;
		onSaveExample?: () => void;
		/** From the JSON tree's menu: keep a value as a variable. */
		onSaveVariable?: (path: string, value: string) => void;
		initialView?: ResponseView;
		onviewchange?: (view: ResponseView) => void;
		/** Set when the last send was cancelled, to how long it had run. */
		cancelledAfter?: number;
		oncancel?: () => void;
		onsendagain?: () => void;
	} = $props();

	// Larger bodies are formatted in a worker; past PRETTY_LIMIT they're shown as received.
	const SYNC_FORMAT_LIMIT = 256 * 1024;
	const PRETTY_LIMIT = 50_000_000;
	// The tree parses on the main thread, so it's limited to what parses quickly.
	const TREE_LIMIT = 10_000_000;

	const start = untrack(() => initialView);
	let tab = $state<ResponseView["tab"]>(start?.tab ?? "body");
	let view = $state<ResponseView["view"]>(start?.view ?? "text");
	let pretty = $state(start?.pretty ?? true);
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

	/* A JSONPath filter shows only the values it selects, pretty-printed. */
	let filter = $state(start?.filter ?? "");
	let filterInput = $state(start?.filter ?? "");
	$effect(() => onviewchange?.({ tab, view, pretty, filter }));
	const filtered = $derived.by((): { text: string } | { error: string } | undefined => {
		if (!filter || !looksJson) return undefined;
		if (text.length > TREE_LIMIT) return { error: `Filtering is limited to ${formatBytes(TREE_LIMIT)} of JSON.` };
		try {
			return { text: JSON.stringify(queryJson(JSON.parse(text), filter), null, 2) };
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) };
		}
	});
	$effect(() => {
		void shown;
		if (!filter) filterInput = "";
	});

	const shownText = $derived(filtered && "text" in filtered ? filtered.text : (prettyText ?? text));
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

	const shortDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

	/* Example responses have no checks; a reopened tab shows them again only after the next send. */
	const tests = $derived(result?.tests);
	const testsFailed = $derived(tests !== undefined && (tests.checks.some((c) => !c.passed) || tests.variables.some((v) => v.error !== undefined)));
	const operatorLabel = (id: string) => OPERATORS.find((o) => o.id === id)?.label ?? id;
	const SCOPE_LABELS: Record<string, string> = { runtime: "Until restart", environment: "Active environment", collection: "Collection", folder: "Folder", request: "This request" };
	const scopeLabel = (scope: string) => SCOPE_LABELS[scope] ?? scope;

	const cookies = $derived.by(() => {
		if (!shown) return [];
		let url: URL;
		try {
			url = new URL(shown.url || result?.sent.url || "http://localhost/");
		} catch {
			url = new URL("http://localhost/");
		}
		return shown.headers.filter(([n]) => n.toLowerCase() === "set-cookie").map(([, v]) => ({ raw: v, cookie: parseSetCookie(v, url) }));
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

	/* Escape cancels while focus is in the response pane; the URL field and editors keep Escape for themselves. */
	let root: HTMLDivElement;
	$effect(() => {
		if (!sending || !oncancel) return;
		const cancel = oncancel;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			cancel();
		};
		root.addEventListener("keydown", onKey);
		return () => root.removeEventListener("keydown", onKey);
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

<div class="carbonwire-response" bind:this={root}>
	{#if sending}
		<div class="carbonwire-progress" class:is-indeterminate={progressRatio === undefined} role="progressbar" aria-label={progressText} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressRatio === undefined ? undefined : Math.round(progressRatio * 100)}>
			<div class="carbonwire-progress-bar" style:width={progressRatio === undefined ? undefined : `${progressRatio * 100}%`}></div>
		</div>
		<div class="carbonwire-muted carbonwire-response-placeholder carbonwire-sending">
			<div>{progressText}</div>
			<div class="carbonwire-sending-time">{formatMs(now - startedAt)}</div>
			<!-- Shown after half a second, so quick requests don't flash it. -->
			{#if oncancel && now - startedAt >= 500}<button class="carbonwire-cancel" onclick={oncancel}>Cancel request</button>{/if}
		</div>
	{:else}
		{#if result && shown}
			<div class="carbonwire-request-bar carbonwire-response-bar">
				<div class="carbonwire-tabs">
					<button class:is-active={tab === "body"} onclick={() => (tab = "body")}>Body</button>
					<button class:is-active={tab === "headers"} onclick={() => (tab = "headers")}>Headers <span class="carbonwire-count">{shown.headers.length}</span></button>
					{#if cookies.length > 0}<button class:is-active={tab === "cookies"} onclick={() => (tab = "cookies")}>Cookies <span class="carbonwire-count">{cookies.length}</span></button>{/if}
					{#if example === undefined}<button class:is-active={tab === "timeline"} onclick={() => (tab = "timeline")}>Timeline</button>{/if}
					{#if tests && example === undefined}
						<button class:is-active={tab === "tests"} class={testsFailed ? "is-failed" : "is-passed"} onclick={() => (tab = "tests")}>
							Tests <span class="carbonwire-count">{tests.checks.length ? `${tests.checks.filter((c) => c.passed).length}/${tests.checks.length}` : tests.variables.length}</span>
						</button>
					{/if}
				</div>
				<div class="carbonwire-response-meta">
					<span class="carbonwire-status {statusClass(shown.status)}">{shown.status} {shown.statusText}</span>
					{#if example === undefined}<span>{formatMs(result.response.timings.total)}</span>{/if}
					<span>{formatBytes(result.response.bodyBytes)}</span>
					{#if result.response.truncated}<span class="carbonwire-badge">Truncated to {formatBytes(result.response.body.byteLength)}</span>{/if}
					{#if example !== undefined}<span class="carbonwire-badge" title="A saved example, not a response from this session">Example: {example}</span>
					{:else if restoredAt !== undefined}<span class="carbonwire-badge" title="This response was reopened from history">From history, {formatTime(restoredAt)}</span>{/if}
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
				{#if shown && tab === "body"}
					{#if onSaveBody}<button class="clickable-icon" aria-label="Save body to a file" onclick={onSaveBody} use:icon={"save"}></button>{/if}
					{#if onSaveExample && example === undefined}<button class="clickable-icon" aria-label="Save as example" onclick={onSaveExample} use:icon={"bookmark"}></button>{/if}
				{/if}
			</div>
		{/if}

		{#if cancelledAfter !== undefined}
			<div class="carbonwire-muted carbonwire-response-placeholder carbonwire-sending">
				<div>Cancelled after {formatMs(cancelledAfter)}.</div>
				{#if onsendagain}<button class="carbonwire-cancel" onclick={onsendagain}>Send again</button>{/if}
			</div>
		{:else if error}
			<div class="carbonwire-error">{error}</div>
		{:else if shown}
			{#each result?.warnings ?? [] as warning, i (i)}
				<div class="carbonwire-warning">{warning}</div>
			{/each}
			{#if tab === "body" && looksJson && !isBinary && shownView !== "preview"}
				<form
					class="carbonwire-jsonpath"
					onsubmit={(e) => {
						e.preventDefault();
						filter = filterInput.trim();
						if (filter) view = "text";
					}}
				>
					<input type="text" spellcheck="false" placeholder="Filter with JSONPath, such as $.items[?@.active].id" aria-label="JSONPath filter" bind:value={filterInput} oninput={() => filterInput.trim() === "" && (filter = "")} />
					{#if filter}<button type="button" onclick={() => ((filter = ""), (filterInput = ""))}>Clear</button>{/if}
				</form>
				{#if filtered && "error" in filtered}<div class="carbonwire-warning">{filtered.error}</div>{/if}
			{/if}
			<div class="carbonwire-response-content">
				{#if tab === "body"}
					{#if isImage}
						<img src={imageUrl} alt="Response" class="carbonwire-image" />
					{:else if isPdf}
						{#key shown}<PdfView data={shown.body} />{/key}
					{:else if shownView === "tree" && tree}
						{#if "value" in tree}
							{#key tree}<JsonTree value={tree.value} onSaveVariable={example === undefined ? onSaveVariable : undefined} />{/key}
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
				{:else if tab === "cookies"}
					<table class="carbonwire-table carbonwire-cookies">
						<thead><tr><th>Name</th><th>Value</th><th>Domain</th><th>Path</th><th>Expires</th><th></th></tr></thead>
						<tbody>
							{#each cookies as { raw, cookie }, i (i)}
								{#if cookie}
									<tr>
										<td>{cookie.name}</td>
										<td class="carbonwire-mono">{cookie.value}</td>
										<td>{cookie.hostOnly ? cookie.domain : `.${cookie.domain}`}</td>
										<td>{cookie.path}</td>
										<td>{cookie.expires === undefined ? "Session" : cookie.expires === 0 ? "Deleted" : shortDate(cookie.expires)}</td>
										<td class="carbonwire-muted">{[cookie.secure && "Secure", cookie.httpOnly && "HttpOnly", cookie.sameSite && `SameSite=${cookie.sameSite}`].filter(Boolean).join(" · ")}</td>
									</tr>
								{:else}
									<tr><td colspan="6" class="carbonwire-muted" title="The cookie isn't allowed for this site, so it wasn't kept">{raw} (refused)</td></tr>
								{/if}
							{/each}
						</tbody>
					</table>
				{:else if tab === "tests" && tests}
					<div class="carbonwire-test-results">
						{#if tests.checks.length}
							<h4>Checks</h4>
							<ul>
								{#each tests.checks as c, i (i)}
									<li class={c.passed ? "is-passed" : "is-failed"}>
										<span class="carbonwire-test-mark" aria-label={c.passed ? "Passed" : "Failed"}>{c.passed ? "✓" : "✗"}</span>
										<span class="carbonwire-mono">{c.expression} {operatorLabel(c.operator)}{c.value !== undefined ? ` ${c.value}` : ""}</span>
										{#if c.error}<span class="carbonwire-test-detail">{c.error}</span>
										{:else if !c.passed}<span class="carbonwire-test-detail">{c.actual === undefined ? "Nothing there" : `Got ${c.actual}`}</span>{/if}
									</li>
								{/each}
							</ul>
						{/if}
						{#if tests.variables.length}
							<h4>Variables</h4>
							<ul>
								{#each tests.variables as v, i (i)}
									<li class={v.error ? "is-failed" : "is-passed"}>
										<span class="carbonwire-test-mark" aria-label={v.error ? "Not set" : "Set"}>{v.error ? "✗" : "✓"}</span>
										<span class="carbonwire-mono">{v.name}</span>
										<span class="carbonwire-test-detail">{v.error ?? `${scopeLabel(v.scope)}: ${v.value && v.value.length > 120 ? `${v.value.slice(0, 120)}…` : v.value}`}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
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
						HTTP/{response.httpVersion}{response.remoteAddress ? ` · ${response.remoteAddress}${response.remotePort ? `:${response.remotePort}` : ""}` : ""}{response.proxy ? ` · Through the proxy ${response.proxy}` : ""}{response.timings.reusedConnection ? " · Reused connection" : ""}
					</p>
					{#if response.tls}
						<h4>TLS</h4>
						<div class="carbonwire-mono">{response.tls.protocol ?? "TLS"}{response.tls.cipher ? ` · ${response.tls.cipher}` : ""}</div>
						<p class="carbonwire-muted">{response.tls.authorized ? "The certificate is trusted." : `The certificate isn't trusted${response.tls.authorizationError ? `: ${response.tls.authorizationError}` : ""}. It was accepted because certificate checks are off.`}</p>
						{#each response.tls.certificates as cert, i (cert.fingerprint256)}
							<details class="carbonwire-cert" open={i === 0}>
								<summary>{cert.subject || "Certificate"}</summary>
								<table class="carbonwire-table">
									<tbody>
										<tr><td>Issued by</td><td>{cert.issuer}</td></tr>
										<tr><td>Valid</td><td>{cert.validFrom} to {cert.validTo}</td></tr>
										{#if cert.subjectAltName}<tr><td>Names</td><td>{cert.subjectAltName}</td></tr>{/if}
										<tr><td>SHA-256</td><td class="carbonwire-mono">{cert.fingerprint256}</td></tr>
									</tbody>
								</table>
							</details>
						{/each}
					{/if}
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
