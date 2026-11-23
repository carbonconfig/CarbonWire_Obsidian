<script lang="ts">
	import type { LevelSettings } from "../core/inheritance";

	/*
	 * Request settings on a request, folder or collection. Each setting can be left to inherit from
	 * the level above; the collection's defaults are CarbonWire's own.
	 */
	let {
		settings,
		onchange,
		level,
	}: {
		settings: LevelSettings | undefined;
		onchange: (settings: LevelSettings) => void;
		level: "request" | "folder" | "collection";
	} = $props();

	const s = $derived(settings ?? {});
	const inheritLabel = $derived(level === "collection" ? "Default" : "Inherit");
	const TLS_VERSIONS = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"];
	const DEFAULT_HEADERS = [
		["user-agent", "User-Agent"],
		["accept", "Accept"],
		["accept-encoding", "Accept-Encoding"],
	] as const;

	function set<K extends keyof LevelSettings>(key: K, value: LevelSettings[K] | undefined) {
		const next = { ...s } as Record<string, unknown>;
		if (value === undefined) delete next[key];
		else next[key] = value;
		onchange(next as LevelSettings);
	}

	/** A select's value for a boolean setting: "", "on" or "off". */
	const tri = (value: boolean | "inherit" | undefined) => (value === true ? "on" : value === false ? "off" : "");
	const fromTri = (value: string) => (value === "on" ? true : value === "off" ? false : undefined);

	function setBool(key: "followRedirects" | "forwardAuthorizationHeader" | "encodeUrl" | "followOriginalHttpMethod", value: string) {
		set(key, fromTri(value));
	}

	/** strictSSL and disableCookies read the other way round from how they're shown. */
	function setInverted(key: "strictSSL" | "disableCookies", value: string) {
		const on = fromTri(value);
		set(key, on === undefined ? undefined : key === "strictSSL" ? on : !on);
	}

	function setNumber(key: "timeout" | "maxRedirects", text: string) {
		const n = Number(text);
		set(key, text.trim() === "" || !Number.isFinite(n) || n < 0 ? undefined : Math.floor(n));
	}

	function toggleTls(version: string, enabled: boolean) {
		const disabled = new Set(s.tlsDisabledProtocols ?? []);
		if (enabled) disabled.delete(version);
		else disabled.add(version);
		set("tlsDisabledProtocols", disabled.size > 0 ? TLS_VERSIONS.filter((v) => disabled.has(v)) : undefined);
	}

	function toggleOmit(header: string, sent: boolean) {
		const omit = new Set((s.omitHeaders ?? []).map((h) => h.toLowerCase()));
		if (sent) omit.delete(header);
		else omit.add(header);
		set("omitHeaders", omit.size > 0 ? [...omit] : undefined);
	}

	const strict = $derived(s.strictSSL === undefined ? "" : s.strictSSL ? "on" : "off");
	const cookies = $derived(s.disableCookies === undefined ? "" : s.disableCookies ? "off" : "on");
	const omitted = $derived(new Set((s.omitHeaders ?? []).map((h) => h.toLowerCase())));
</script>

<div class="carbonwire-request-settings">
	<label class="carbonwire-field">
		<span>Timeout</span>
		<span class="carbonwire-field-row">
			<input type="number" min="0" placeholder={level === "collection" ? "None" : "Inherit"} value={typeof s.timeout === "number" ? s.timeout : ""} onchange={(e) => setNumber("timeout", e.currentTarget.value)} />
			<span class="carbonwire-muted">ms; 0 waits forever</span>
		</span>
	</label>
	<label class="carbonwire-field">
		<span>Follow redirects</span>
		<select class="dropdown" value={tri(s.followRedirects)} onchange={(e) => setBool("followRedirects", e.currentTarget.value)}>
			<option value="">{inheritLabel}{level === "collection" ? " (on)" : ""}</option>
			<option value="on">On</option>
			<option value="off">Off</option>
		</select>
	</label>
	<label class="carbonwire-field">
		<span>Most redirects</span>
		<input type="number" min="0" placeholder={level === "collection" ? "5" : "Inherit"} value={typeof s.maxRedirects === "number" ? s.maxRedirects : ""} onchange={(e) => setNumber("maxRedirects", e.currentTarget.value)} />
	</label>
	<label class="carbonwire-field">
		<span>Keep the method on redirects</span>
		<select class="dropdown" value={tri(s.followOriginalHttpMethod)} onchange={(e) => setBool("followOriginalHttpMethod", e.currentTarget.value)} title="On 301, 302 and 303, send the same method and body again instead of switching to GET">
			<option value="">{inheritLabel}{level === "collection" ? " (off)" : ""}</option>
			<option value="on">On</option>
			<option value="off">Off</option>
		</select>
	</label>
	<label class="carbonwire-field">
		<span>Keep Authorization on redirects to other sites</span>
		<select class="dropdown" value={tri(s.forwardAuthorizationHeader)} onchange={(e) => setBool("forwardAuthorizationHeader", e.currentTarget.value)}>
			<option value="">{inheritLabel}{level === "collection" ? " (off)" : ""}</option>
			<option value="on">On</option>
			<option value="off">Off</option>
		</select>
	</label>
	<label class="carbonwire-field">
		<span>Encode the URL</span>
		<select class="dropdown" value={tri(s.encodeUrl)} onchange={(e) => setBool("encodeUrl", e.currentTarget.value)} title="Percent-encode query and path values as they're sent">
			<option value="">{inheritLabel}{level === "collection" ? " (on)" : ""}</option>
			<option value="on">On</option>
			<option value="off">Off</option>
		</select>
	</label>
	<label class="carbonwire-field">
		<span>Verify TLS certificates</span>
		<select class="dropdown" value={strict} onchange={(e) => setInverted("strictSSL", e.currentTarget.value)} title="Off skips certificate checks for these requests only, even when the setting is on">
			<option value="">{inheritLabel}{level === "collection" ? " (on)" : ""}</option>
			<option value="on">On</option>
			<option value="off">Off</option>
		</select>
	</label>
	<label class="carbonwire-field">
		<span>Cookies</span>
		<select class="dropdown" value={cookies} onchange={(e) => setInverted("disableCookies", e.currentTarget.value)} title="Send cookies from the cookie jar, and keep cookies responses set">
			<option value="">{inheritLabel}{level === "collection" ? " (on)" : ""}</option>
			<option value="on">On</option>
			<option value="off">Off</option>
		</select>
	</label>
	<label class="carbonwire-field">
		<span>HTTP version</span>
		<select class="dropdown" value={s.protocolVersion ?? ""} onchange={(e) => set("protocolVersion", (e.currentTarget.value || undefined) as LevelSettings["protocolVersion"])}>
			<option value="">{inheritLabel}{level === "collection" ? " (HTTP/1.1)" : ""}</option>
			<option value="http1">HTTP/1.1</option>
			<option value="http2">HTTP/2</option>
			<option value="auto">HTTP/2 when the server offers it</option>
		</select>
	</label>
	<div class="carbonwire-field">
		<span>TLS versions</span>
		<span class="carbonwire-field-row">
			{#each TLS_VERSIONS as version (version)}
				<label class="carbonwire-check"><input type="checkbox" checked={!(s.tlsDisabledProtocols ?? []).includes(version)} onchange={(e) => toggleTls(version, e.currentTarget.checked)} />{version.replace("TLSv", "TLS ")}</label>
			{/each}
		</span>
	</div>
	<label class="carbonwire-field">
		<span>Cipher suites</span>
		<input
			type="text"
			spellcheck="false"
			placeholder="Node's defaults"
			title="OpenSSL names, separated by commas, such as ECDHE-RSA-AES128-GCM-SHA256"
			value={(s.tlsCipherSelection ?? []).join(", ")}
			onchange={(e) => {
				const list = e.currentTarget.value.split(/[\s,:]+/).filter(Boolean);
				set("tlsCipherSelection", list.length > 0 ? list : undefined);
			}}
		/>
	</label>
	<div class="carbonwire-field">
		<span>Default headers sent</span>
		<span class="carbonwire-field-row">
			{#each DEFAULT_HEADERS as [key, label] (key)}
				<label class="carbonwire-check"><input type="checkbox" checked={!omitted.has(key)} onchange={(e) => toggleOmit(key, e.currentTarget.checked)} />{label}</label>
			{/each}
		</span>
	</div>
	{#if level !== "request"}
		<p class="carbonwire-muted">Requests in this {level} use these unless they set their own.</p>
	{/if}
</div>
