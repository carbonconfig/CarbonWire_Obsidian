<script lang="ts">
	import { onDestroy, tick, untrack } from "svelte";
	import type { Auth, HttpRequest, HttpRequestBody, HttpRequestExample, HttpRequestHeader, HttpRequestParam } from "../core/model";
	import { applyPreset, type HeaderPreset } from "../core/header-presets";
	import type { LevelSettings } from "../core/inheritance";
	import { findHeader } from "../core/headers";
	import CodeEditor from "./CodeEditor.svelte";
	import RequestSettings from "./RequestSettings.svelte";
	import type { SendResult } from "../core/sender";
	import type { SendProgress } from "../core/transport/types";
	import type { EnvironmentEntry } from "../main";
	import type { RequestLayout } from "../settings";
	import { icon } from "./actions";
	import { readableTextColor } from "./env-colors";
	import type { RequestController } from "./request-controller";
	import AuthEditor from "./AuthEditor.svelte";
	import BodyEditor from "./BodyEditor.svelte";
	import KeyValueTable from "./KeyValueTable.svelte";
	import ResponsePanel from "./ResponsePanel.svelte";
	import UrlInput from "./UrlInput.svelte";
	import { provideVariables } from "./variables-context";
	import { createAutosave } from "./autosave";
	import { formatTime } from "./format";
	import { paramsFromUrl, urlFromParams } from "../core/url-params";
	import { initialTab, type RequestTab, type ResponseView, type TabView } from "./request-tab";

	let {
		initial,
		initialEnvironment,
		initialLayout,
		initialWrap,
		initialName,
		initialDraft,
		initialResult,
		restoredAt: initialRestoredAt,
		initialSnippetLanguage = "curl",
		initialView,
		controller,
	}: {
		initial: HttpRequest;
		/** True for a request that isn't saved to a collection yet. */
		initialDraft: boolean;
		/** A response to show straight away, such as one reopened from history. */
		initialResult?: SendResult;
		restoredAt?: number;
		/** The active environment, or undefined for none. */
		initialEnvironment: EnvironmentEntry | undefined;
		initialLayout: RequestLayout;
		/** Whether response bodies wrap long lines. */
		initialWrap: boolean;
		initialName: string;
		/** The language the Code tab shows first. */
		initialSnippetLanguage?: string;
		/** The tabs and response view the tab showed last. */
		initialView?: TabView;
		controller: RequestController;
	} = $props();

	const SNIPPET_LANGUAGES = [
		["curl", "cURL"],
		["http", "HTTP"],
		["fetch", "JavaScript (fetch)"],
		["python", "Python (requests)"],
		["go", "Go (net/http)"],
	] as const;
	/** Example bodies are kept up to this size, as text. */
	const EXAMPLE_LIMIT = 1024 * 1024;

	const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

	const loaded = structuredClone(untrack(() => initial));
	loaded.http ??= { method: "GET", url: "" };
	let request = $state(loaded);
	let environment = $state.raw(untrack(() => initialEnvironment));

	/** Called by the view when the active environment, its name or its colour changes. */
	export function setEnvironment(next: EnvironmentEntry | undefined) {
		const switched = next?.path !== environment?.path;
		environment = next;
		if (switched) void refreshVariables();
	}

	let variableNames = $state.raw<ReadonlySet<string> | undefined>();
	provideVariables({
		get names() {
			return variableNames;
		},
	});

	/** Reloads which variables are defined, after an environment or collection file changes. */
	export async function refreshVariables() {
		variableNames = new Set(await controller.variableNames($state.snapshot(request) as HttpRequest));
	}

	export function setLayout(next: RequestLayout) {
		layout = next;
	}

	let wrap = $state(untrack(() => initialWrap));
	let urlInput = $state<ReturnType<typeof UrlInput>>();

	export function setWrap(next: boolean) {
		wrap = next;
	}

	export function focusUrl() {
		urlInput?.focus();
	}

	/** Shows a send from history, unless the user has already sent the request in this tab. */
	export function restore(next: SendResult | undefined, time: number, failure?: string) {
		if (sending || result || error || cancelledAfter !== undefined) return;
		result = next;
		restoredAt = time;
		error = failure && `The last send, ${formatTime(time)}, failed: ${failure}`;
	}

	let layout = $state(untrack(() => initialLayout));
	let container: HTMLDivElement;
	let name = $state(untrack(() => initialName));
	let draft = $state(untrack(() => initialDraft));
	let restoredAt = $state(untrack(() => initialRestoredAt));
	let requestPane: HTMLDivElement;
	let responsePane: HTMLDivElement;
	let bodyEditor = $state<ReturnType<typeof BodyEditor>>();
	let responsePanel = $state<ReturnType<typeof ResponsePanel>>();

	/** Called by the view after the file is renamed elsewhere. */
	export function setName(next: string) {
		name = next;
	}

	/**
	 * Ctrl/Cmd+F: search the editor that has focus; otherwise the response if there is one,
	 * else the request body.
	 */
	export function find() {
		const focused = document.activeElement;
		const inBodyEditor = focused instanceof HTMLElement && requestPane.contains(focused) && focused.closest(".carbonwire-code-editor") !== null;
		if (inBodyEditor && bodyEditor?.openSearch()) return;
		if (focused && responsePane.contains(focused) && responsePanel?.openSearch()) return;
		if (responsePanel?.openSearch()) return;
		tab = "body";
		void tick().then(() => bodyEditor?.openSearch());
	}

	async function rename(input: HTMLInputElement) {
		const next = input.value.trim();
		if (!next || next === name) {
			input.value = name;
			return;
		}
		const renamed = await controller.rename(next);
		name = renamed ?? name;
		input.value = name;
	}
	const lastTab = untrack(() => initialView?.tab);
	let tab = $state<RequestTab>(lastTab && (lastTab !== "examples" || loaded.examples?.length) ? lastTab : initialTab(loaded.http));
	let responseView = $state.raw<ResponseView | undefined>(untrack(() => initialView?.response));
	$effect(() => controller.viewChanged?.({ tab, response: responseView }));
	let result = $state.raw<SendResult | undefined>(untrack(() => initialResult));
	let error = $state<string | undefined>();
	let sending = $state(false);
	let cancelledAfter = $state<number | undefined>();
	let progress = $state.raw<SendProgress | undefined>();
	let abort: AbortController | undefined;
	const autosave = createAutosave(() => controller.save($state.snapshot(request) as HttpRequest));

	const http = $derived(request.http!);
	const params = $derived(http.params ?? []);
	const pathParams = $derived(params.filter((p) => p.type === "path"));
	const queryParams = $derived(params.filter((p) => p.type === "query"));
	const method = $derived((http.method ?? "GET").toUpperCase());

	const changed = () => autosave.schedule();

	void refreshVariables();

	onDestroy(() => {
		abort?.abort();
		void autosave.flush();
	});

	function setUrl(url: string) {
		http.url = url;
		http.params = paramsFromUrl(url, params);
		changed();
	}

	function setParams(next: HttpRequestParam[]) {
		http.params = next;
		http.url = urlFromParams(http.url ?? "", next);
		changed();
	}

	function setHeaders(next: HttpRequestHeader[]) {
		http.headers = next;
		changed();
	}

	/** With body variants, only the selected variant's body is replaced. */
	function setBody(next: HttpRequestBody | undefined) {
		const body = http.body;
		if (Array.isArray(body) && next) {
			const i = Math.max(0, body.findIndex((v) => v.selected));
			if (body[i]) body[i].body = next;
			else http.body = next;
		} else {
			http.body = next;
		}
		changed();
	}

	function setAuth(next: Auth | undefined) {
		http.auth = next;
		changed();
	}

	function setSettings(next: LevelSettings) {
		if (Object.keys(next).length === 0) delete request.settings;
		else request.settings = next;
		changed();
	}

	/* The Code tab: the request as code, regenerated as the request changes. */
	let snippetLanguage = $state(untrack(() => initialSnippetLanguage));
	let snippetText = $state("");
	$effect(() => {
		if (tab !== "code") return;
		const snapshot = $state.snapshot(request) as HttpRequest;
		const language = snippetLanguage;
		let current = true;
		const timer = setTimeout(() => {
			void controller.snippet(snapshot, language).then(
				(text) => current && (snippetText = text),
				(e: unknown) => current && (snippetText = `Couldn't write the code: ${e instanceof Error ? e.message : String(e)}`),
			);
		}, 150);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	});

	/* Header presets, loaded when the Headers tab opens. */
	let presets = $state.raw<HeaderPreset[]>([]);
	$effect(() => {
		if (tab === "headers") void controller.headerPresets().then((list) => (presets = list));
	});

	async function presetAction(choice: string) {
		if (choice === "save") await controller.saveHeaderPreset($state.snapshot(http.headers ?? []) as HttpRequestHeader[]);
		else if (choice === "remove") await controller.removeHeaderPreset();
		else {
			const preset = presets.find((p) => p.name === choice);
			if (preset) setHeaders(applyPreset(http.headers ?? [], preset));
			return;
		}
		presets = await controller.headerPresets();
	}

	/* Saved examples: shown in the response panel instead of the last response. */
	let shownExample = $state<number | undefined>();
	const examples = $derived(request.examples ?? []);
	const exampleResult = $derived.by((): SendResult | undefined => {
		const e = shownExample === undefined ? undefined : examples[shownExample];
		if (!e) return undefined;
		const body = new TextEncoder().encode(e.response?.body?.data ?? "");
		const types: Record<string, string> = { json: "application/json", xml: "application/xml", html: "text/html", text: "text/plain" };
		const headers = (e.response?.headers ?? []).map((h): [string, string] => [h.name, h.value]);
		if (!headers.some(([n]) => n.toLowerCase() === "content-type") && e.response?.body?.type) headers.push(["Content-Type", types[e.response.body.type] ?? "text/plain"]);
		return {
			sent: { method: e.request?.method ?? "GET", url: e.request?.url ?? "", headers: [], bodyBytes: 0 },
			response: {
				url: e.request?.url ?? "",
				status: e.response?.status ?? 0,
				statusText: e.response?.statusText ?? "",
				httpVersion: "1.1",
				headers,
				body,
				bodyBytes: body.byteLength,
				truncated: false,
				timings: { dns: 0, connect: 0, tls: 0, wait: 0, download: 0, total: 0, reusedConnection: false },
				redirects: [],
			},
			warnings: [],
		};
	});

	async function saveExample() {
		if (!result) return;
		const { response, sent } = result;
		const name = await controller.askName("Name the example", `${response.status} ${response.statusText}`.trim());
		if (name === undefined) return;
		const type = (findHeader(response.headers, "content-type") ?? "").toLowerCase();
		const kind = type.includes("json") ? "json" : type.includes("xml") ? "xml" : type.includes("html") ? "html" : /^(image|audio|video)\/|pdf|zip|octet/.test(type) ? "binary" : "text";
		const example: HttpRequestExample = {
			name,
			request: { url: sent.url, method: sent.method, headers: sent.headers.map(([n, v]) => ({ name: n, value: v })) },
			response: {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers.map(([n, v]) => ({ name: n, value: v })),
				...(kind === "binary" ? {} : { body: { type: kind, data: new TextDecoder().decode(response.body.subarray(0, EXAMPLE_LIMIT)) } }),
			},
		};
		request.examples = [...(request.examples ?? []), example];
		changed();
		controller.notify(`Saved the example "${name}".`);
	}

	function deleteExample(i: number) {
		const next = [...examples];
		next.splice(i, 1);
		if (next.length === 0) delete request.examples;
		else request.examples = next;
		if (shownExample === i) shownExample = undefined;
		changed();
	}

	async function saveBody() {
		const shown = exampleResult ?? result;
		if (!shown) return;
		const type = findHeader(shown.response.headers, "content-type") ?? "";
		await controller.saveBody(shown.response.body, type, name);
	}


	export function snapshot(): HttpRequest {
		return $state.snapshot(request) as HttpRequest;
	}

	/** Saves an unsaved request to a collection; after that, changes save automatically. */
	export async function save() {
		if (!draft) return;
		await autosave.flush();
		const saved = await controller.saveDraft(name, snapshot());
		if (saved === undefined) return;
		draft = false;
		name = saved;
	}

	/** A curl command pasted into the URL replaces the request, keeping its auth if curl had none. */
	async function pasteUrl(e: ClipboardEvent) {
		const text = e.clipboardData?.getData("text/plain") ?? "";
		if (!/^\s*curl(\.exe)?\s/i.test(text)) return;
		e.preventDefault();
		try {
			const { requestFromCurl } = await import("../core/import/curl");
			const parsed = requestFromCurl(text);
			const next = parsed.request.http ?? {};
			request.http = { ...next, auth: next.auth ?? http.auth };
			changed();
			if (draft && name === initialName) name = (await controller.rename(parsed.name)) ?? name;
			controller.notify(parsed.warnings.length > 0 ? `Filled in from the cURL command. ${parsed.warnings.join(" ")}` : "Filled in from the cURL command.");
		} catch (err) {
			controller.notify(`Couldn't read the cURL command: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	export async function send() {
		if (sending) return;
		sending = true;
		error = undefined;
		cancelledAfter = undefined;
		progress = undefined;
		abort = new AbortController();
		const signal = abort.signal;
		const started = performance.now();
		try {
			await autosave.flush();
			result = await controller.send(name, snapshot(), abort.signal, (next) => (progress = next));
			restoredAt = undefined;
			shownExample = undefined;
		} catch (e) {
			result = undefined;
			if (signal.aborted) cancelledAfter = performance.now() - started;
			else error = e instanceof Error ? e.message : String(e);
		} finally {
			sending = false;
			abort = undefined;
		}
	}

	async function copyCurl() {
		await autosave.flush();
		await controller.copyCurl(snapshot());
	}

	function toggleOrientation() {
		layout = { ...layout, orientation: layout.orientation === "vertical" ? "horizontal" : "vertical" };
		controller.setLayout(layout);
	}

	/** Dragging the divider resizes both panels; the ratio is saved when the drag ends. */
	function startResize(e: PointerEvent) {
		const divider = e.currentTarget as HTMLElement;
		divider.setPointerCapture(e.pointerId);
		const rect = container.getBoundingClientRect();
		const move = (ev: PointerEvent) => {
			const raw = layout.orientation === "vertical" ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
			layout = { ...layout, ratio: Math.min(0.85, Math.max(0.15, raw)) };
		};
		const end = () => {
			divider.removeEventListener("pointermove", move);
			divider.removeEventListener("pointerup", end);
			divider.removeEventListener("pointercancel", end);
			controller.setLayout(layout);
		};
		divider.addEventListener("pointermove", move);
		divider.addEventListener("pointerup", end);
		divider.addEventListener("pointercancel", end);
	}

	function resetSplit() {
		layout = { ...layout, ratio: 0.5 };
		controller.setLayout(layout);
	}
</script>

<div class="carbonwire-request-view">
<div class="carbonwire-request is-{layout.orientation}" bind:this={container} style:--cw-ratio={layout.ratio}>
<div class="carbonwire-pane carbonwire-pane-request" bind:this={requestPane}>
<div class="carbonwire-titlebar">
	<input
		class="carbonwire-title-input"
		aria-label="Request name"
		spellcheck="false"
		value={name}
		onkeydown={(e) => {
			if (e.key === "Enter") e.currentTarget.blur();
			else if (e.key === "Escape") {
				e.currentTarget.value = name;
				e.currentTarget.blur();
			}
		}}
		onblur={(e) => void rename(e.currentTarget)}
	/>
</div>
	<div class="carbonwire-urlbar">
		<select
			class="dropdown carbonwire-method"
			data-method={method}
			value={method}
			onchange={(e) => {
				http.method = e.currentTarget.value;
				changed();
			}}
		>
			{#each METHODS as m (m)}<option class="carbonwire-method" data-method={m} value={m}>{m}</option>{/each}
			{#if !METHODS.includes(method)}<option class="carbonwire-method" value={method}>{method}</option>{/if}
		</select>
		<UrlInput
			bind:this={urlInput}
			class="carbonwire-url"
			placeholder="Enter a URL or paste a cURL command"
			value={http.url ?? ""}
			oninput={setUrl}
			onpaste={(e) => void pasteUrl(e)}
			onenter={() => void send()}
		/>
		{#if sending}
			<button onclick={() => abort?.abort()}>Cancel</button>
		{:else}
			<button class="mod-cta" onclick={() => void send()}>Send</button>
		{/if}
		{#if draft}
			<button aria-label="Save to a collection" onclick={() => void save()}>Save</button>
		{/if}
	</div>

	<div class="carbonwire-request-bar">
		<div class="carbonwire-tabs">
			<button class:is-active={tab === "params"} onclick={() => (tab = "params")}>Params {#if params.length}<span class="carbonwire-count">{params.length}</span>{/if}</button>
			<button class:is-active={tab === "headers"} onclick={() => (tab = "headers")}>Headers {#if http.headers?.length}<span class="carbonwire-count">{http.headers.length}</span>{/if}</button>
			<button class:is-active={tab === "body"} onclick={() => (tab = "body")}>Body</button>
			<button class:is-active={tab === "auth"} onclick={() => (tab = "auth")}>Auth</button>
			<button class:is-active={tab === "settings"} onclick={() => (tab = "settings")}>Settings {#if request.settings && Object.keys(request.settings).length}<span class="carbonwire-count">{Object.keys(request.settings).length}</span>{/if}</button>
			<button class:is-active={tab === "code"} onclick={() => (tab = "code")}>Code</button>
			{#if examples.length > 0}<button class:is-active={tab === "examples"} onclick={() => (tab = "examples")}>Examples <span class="carbonwire-count">{examples.length}</span></button>{/if}
		</div>
		<span class="carbonwire-spacer"></span>
		{#if environment}
			{@const env = environment}
			<span
				class="carbonwire-env-badge"
				class:has-color={env.color !== undefined}
				style:--cw-env-color={env.color}
				style:--cw-env-text={readableTextColor(env.color)}
				role="button"
				tabindex="0"
				title="Active environment. Click to edit it."
				onclick={() => controller.openEnvironment(env.path)}
				onkeydown={(e) => (e.key === "Enter" || e.key === " ") && controller.openEnvironment(env.path)}
			>{env.name}</span>
		{:else}
			<span class="carbonwire-env-badge is-none">No environment</span>
		{/if}
		<button class="clickable-icon" aria-label="Copy as cURL" onclick={() => void copyCurl()} use:icon={"code-xml"}></button>
		<button
			class="clickable-icon"
			aria-label={layout.orientation === "vertical" ? "Show response below" : "Show response beside"}
			onclick={toggleOrientation}
			use:icon={layout.orientation === "vertical" ? "panel-bottom" : "panel-right"}
		></button>
	</div>

	<div class="carbonwire-request-content">
		{#if tab === "params"}
			{#if pathParams.length > 0}
				<h4>Path params</h4>
				<KeyValueTable
					rows={pathParams}
					fixedNames
					toggleable={false}
					onchange={(rows) => setParams([...rows, ...queryParams])}
				/>
				<h4>Query params</h4>
			{/if}
			<KeyValueTable
				rows={queryParams}
				onchange={(rows) => setParams([...pathParams, ...rows])}
				create={(): HttpRequestParam => ({ name: "", value: "", type: "query" })}
			/>
		{:else if tab === "headers"}
			<KeyValueTable rows={http.headers ?? []} onchange={setHeaders} create={() => ({ name: "", value: "" })} />
			<div class="carbonwire-presets">
				<select
					class="dropdown"
					aria-label="Header presets"
					value=""
					onchange={(e) => {
						const choice = e.currentTarget.value;
						e.currentTarget.value = "";
						if (choice) void presetAction(choice);
					}}
				>
					<option value="">Presets…</option>
					{#if presets.length > 0}
						<optgroup label="Add a preset's headers">
							{#each presets as preset (preset.name)}<option value={preset.name}>{preset.name}</option>{/each}
						</optgroup>
					{/if}
					<option value="save">Save these headers as a preset…</option>
					{#if presets.length > 0}<option value="remove">Remove a preset…</option>{/if}
				</select>
			</div>
		{:else if tab === "body"}
			<BodyEditor bind:this={bodyEditor} body={http.body} onchange={setBody} />
		{:else if tab === "auth"}
			<AuthEditor auth={http.auth} onchange={setAuth} />
		{:else if tab === "settings"}
			<RequestSettings settings={request.settings as LevelSettings | undefined} onchange={setSettings} level="request" />
		{:else if tab === "code"}
			<div class="carbonwire-code-bar">
				<select
					class="dropdown"
					aria-label="Language"
					value={snippetLanguage}
					onchange={(e) => {
						snippetLanguage = e.currentTarget.value;
						controller.setSnippetLanguage(snippetLanguage);
					}}
				>
					{#each SNIPPET_LANGUAGES as [id, label] (id)}<option value={id}>{label}</option>{/each}
				</select>
				<span class="carbonwire-spacer"></span>
				<button class="clickable-icon" aria-label="Copy code" onclick={() => void navigator.clipboard.writeText(snippetText)} use:icon={"copy"}></button>
			</div>
			<div class="carbonwire-editor-host carbonwire-snippet"><CodeEditor value={snippetText} readOnly wrap={false} /></div>
		{:else}
			<table class="carbonwire-table carbonwire-examples">
				<tbody>
					{#each examples as e, i (i)}
						<tr class:is-active={shownExample === i}>
							<td>{e.name ?? `Example ${i + 1}`}</td>
							<td class="carbonwire-muted">{e.response?.status ?? ""} {e.response?.statusText ?? ""}</td>
							<td class="carbonwire-row-buttons">
								<button onclick={() => (shownExample = shownExample === i ? undefined : i)}>{shownExample === i ? "Hide" : "Show"}</button>
								<button class="clickable-icon" aria-label="Delete {e.name ?? 'example'}" onclick={() => deleteExample(i)} use:icon={"trash"}></button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
<div
	class="carbonwire-divider"
	role="separator"
	aria-orientation={layout.orientation === "vertical" ? "vertical" : "horizontal"}
	aria-label="Resize panels (double-click to reset)"
	onpointerdown={startResize}
	ondblclick={resetSplit}
></div>
<div class="carbonwire-pane carbonwire-pane-response" bind:this={responsePane}>
	<ResponsePanel
		bind:this={responsePanel}
		initialView={responseView}
		onviewchange={(next) => (responseView = next)}
		cancelledAfter={exampleResult ? undefined : cancelledAfter}
		oncancel={() => abort?.abort()}
		onsendagain={() => void send()}
		result={exampleResult ?? result}
		error={exampleResult ? undefined : error}
		example={exampleResult ? (examples[shownExample!]?.name ?? "Example") : undefined}
		onSaveBody={() => void saveBody()}
		onSaveExample={() => void saveExample()}
		{sending}
		{progress}
		{restoredAt}
		{wrap}
		onWrapChange={(next) => {
			wrap = next;
			controller.setWrap(next);
		}}
	/>
</div>
</div>
</div>
