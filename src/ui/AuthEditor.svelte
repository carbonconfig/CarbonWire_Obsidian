<script lang="ts">
	import type { AuthOAuth2 } from "@opencollection/types/common/auth-oauth2";
	import type { Auth } from "../core/model";
	import VarInput from "./VarInput.svelte";

	let { auth, onchange, canInherit = true }: { auth: Auth | undefined; onchange: (auth: Auth | undefined) => void; canInherit?: boolean } = $props();

	type Field = { key: string; label: string; kind?: "secret" | "bool" | "area" | "select"; options?: [string, string][]; hint?: string };

	/* Auth types whose settings are a flat list of fields, by their names in the file. */
	const FIELDS: Record<string, Field[]> = {
		ntlm: [
			{ key: "username", label: "Username", hint: "DOMAIN\\user works too" },
			{ key: "password", label: "Password", kind: "secret" },
			{ key: "domain", label: "Domain" },
		],
		wsse: [
			{ key: "username", label: "Username" },
			{ key: "password", label: "Password", kind: "secret" },
		],
		awsv4: [
			{ key: "accessKeyId", label: "Access key" },
			{ key: "secretAccessKey", label: "Secret key", kind: "secret" },
			{ key: "sessionToken", label: "Session token", kind: "secret" },
			{ key: "region", label: "Region", hint: "us-east-1 when empty" },
			{ key: "service", label: "Service", hint: "execute-api when empty" },
		],
		oauth1: [
			{ key: "signatureMethod", label: "Signature method", kind: "select", options: ["HMAC-SHA1", "HMAC-SHA256", "HMAC-SHA512", "RSA-SHA1", "RSA-SHA256", "RSA-SHA512", "PLAINTEXT"].map((m) => [m, m]) },
			{ key: "consumerKey", label: "Consumer key" },
			{ key: "consumerSecret", label: "Consumer secret", kind: "secret" },
			{ key: "accessToken", label: "Access token" },
			{ key: "accessTokenSecret", label: "Token secret", kind: "secret" },
			{ key: "callbackUrl", label: "Callback URL" },
			{ key: "verifier", label: "Verifier" },
			{ key: "timestamp", label: "Timestamp", hint: "Now when empty" },
			{ key: "nonce", label: "Nonce", hint: "Random when empty" },
			{ key: "version", label: "Version", hint: "1.0 when empty" },
			{ key: "realm", label: "Realm" },
			{ key: "placement", label: "Add to", kind: "select", options: [["header", "Authorization header"], ["query", "Query params"], ["body", "Request body"]] },
			{ key: "includeBodyHash", label: "Include a body hash", kind: "bool" },
		],
		jwt: [
			{ key: "algorithm", label: "Algorithm", kind: "select", options: ["HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"].map((m) => [m, m]) },
			{ key: "secret", label: "Secret", kind: "secret", hint: "For HS algorithms" },
			{ key: "isSecretBase64Encoded", label: "Secret is base64", kind: "bool" },
			{ key: "privateKey", label: "Private key", kind: "area", hint: "PEM, for RS, PS and ES algorithms" },
			{ key: "payload", label: "Payload", kind: "area", hint: "A JSON object" },
			{ key: "header", label: "Extra header fields", kind: "area", hint: "A JSON object" },
			{ key: "addTokenTo", label: "Add to", kind: "select", options: [["header", "Authorization header"], ["queryParam", "Query param"]] },
			{ key: "headerPrefix", label: "Header prefix", hint: "Bearer when not set" },
			{ key: "queryParamKey", label: "Query param name", hint: "token when empty" },
		],
		asap: [
			{ key: "alg", label: "Algorithm", kind: "select", options: ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"].map((m) => [m, m]) },
			{ key: "issuer", label: "Issuer" },
			{ key: "subject", label: "Subject" },
			{ key: "audience", label: "Audience" },
			{ key: "kid", label: "Key ID" },
			{ key: "privateKey", label: "Private key", kind: "area", hint: "PEM" },
			{ key: "exp", label: "Expires in", hint: "1h when empty; also 30m, 45s or seconds" },
			{ key: "claims", label: "Extra claims", kind: "area", hint: "A JSON object" },
		],
		hawk: [
			{ key: "authId", label: "Hawk Auth ID" },
			{ key: "authKey", label: "Hawk Auth Key", kind: "secret" },
			{ key: "algorithm", label: "Algorithm", kind: "select", options: [["sha256", "SHA-256"], ["sha1", "SHA-1"]] },
			{ key: "user", label: "User" },
			{ key: "nonce", label: "Nonce", hint: "Random when empty" },
			{ key: "extraData", label: "ext" },
			{ key: "app", label: "app" },
			{ key: "delegation", label: "dlg" },
			{ key: "timestamp", label: "Timestamp", hint: "Now when empty" },
			{ key: "includePayloadHash", label: "Include a payload hash", kind: "bool" },
		],
		edgegrid: [
			{ key: "accessToken", label: "Access token" },
			{ key: "clientToken", label: "Client token" },
			{ key: "clientSecret", label: "Client secret", kind: "secret" },
			{ key: "nonce", label: "Nonce", hint: "Random when empty" },
			{ key: "timestamp", label: "Timestamp", hint: "Now when empty" },
			{ key: "headersToSign", label: "Headers to sign", hint: "Names, separated by commas" },
		],
	};

	const LABELS: Record<string, string> = {
		basic: "Basic",
		bearer: "Bearer token",
		apikey: "API key",
		digest: "Digest",
		oauth2: "OAuth 2.0",
		oauth1: "OAuth 1.0",
		awsv4: "AWS Signature",
		ntlm: "NTLM",
		wsse: "WSSE",
		jwt: "JWT Bearer",
		hawk: "Hawk",
		edgegrid: "Akamai EdgeGrid",
		asap: "ASAP (Atlassian)",
	};
	/** Kept in .carbonwire/collection.json, since OpenCollection has no shape for them. */
	const SIDECAR = new Set(["jwt", "hawk", "edgegrid", "asap"]);

	const kind = $derived(auth === undefined ? "none" : auth === "inherit" ? "inherit" : auth.type);
	const flat = $derived(auth !== undefined && auth !== "inherit" ? (auth as unknown as Record<string, unknown>) : {});

	function change(type: string) {
		switch (type) {
			case "inherit":
				return onchange("inherit");
			case "none":
				return onchange(undefined);
			case "basic":
			case "digest":
				return onchange({ type, username: "", password: "" });
			case "bearer":
				return onchange({ type, token: "" });
			case "apikey":
				return onchange({ type, key: "", value: "", placement: "header" });
			case "oauth2":
				return onchange({ type, flow: "client_credentials", accessTokenUrl: "", credentials: { clientId: "", clientSecret: "", placement: "basic_auth_header" }, scope: "" });
			case "oauth1":
				return onchange({ type, signatureMethod: "HMAC-SHA1", placement: "header" } as Auth);
			case "jwt":
				return onchange({ type, algorithm: "HS256", payload: "{}", addTokenTo: "header" } as unknown as Auth);
			case "asap":
				return onchange({ type, alg: "RS256" } as unknown as Auth);
			case "hawk":
				return onchange({ type, algorithm: "sha256" } as unknown as Auth);
			default:
				return onchange({ type } as Auth);
		}
	}

	function set(field: string, value: unknown) {
		if (auth === undefined || auth === "inherit") return;
		const next = { ...auth } as Record<string, unknown>;
		if (value === "" || value === undefined) delete next[field];
		else next[field] = value;
		onchange(next as unknown as Auth);
	}

	/** OAuth 1.0's private key is `{type: "text", value}` in the file; the others' are text. */
	function fieldValue(f: Field): string {
		const v = flat[f.key];
		if (v && typeof v === "object" && "value" in v) return String((v as { value: unknown }).value ?? "");
		return v === undefined || v === null ? "" : String(v);
	}

	function setField(f: Field, value: unknown) {
		if (kind === "oauth1" && f.key === "privateKey") set(f.key, value ? { type: "text", value } : undefined);
		else set(f.key, value);
	}

	function setOAuth(patch: Partial<AuthOAuth2> | ((a: AuthOAuth2) => AuthOAuth2)) {
		if (auth === undefined || auth === "inherit" || auth.type !== "oauth2") return;
		onchange(typeof patch === "function" ? patch(auth) : ({ ...auth, ...patch } as AuthOAuth2));
	}

	function setFlow(flow: string) {
		setOAuth((a) => {
			const next = { ...a, flow } as AuthOAuth2;
			if (flow === "authorization_code" && !("pkce" in next && next.pkce)) (next as Extract<AuthOAuth2, { flow: "authorization_code" }>).pkce = { method: "S256" };
			return next;
		});
	}

	function setCredentials(field: "clientId" | "clientSecret" | "placement", value: string) {
		setOAuth((a) => ("credentials" in a ? ({ ...a, credentials: { ...a.credentials, [field]: value } } as AuthOAuth2) : a));
	}

	function setPlacement(where: "header" | "query", value: string) {
		setOAuth((a) => ({ ...a, tokenConfig: { ...a.tokenConfig, placement: where === "header" ? { header: value } : { query: value } } }));
	}
</script>

<div class="carbonwire-auth">
	<select class="dropdown" value={kind} onchange={(e) => change(e.currentTarget.value)}>
		{#if canInherit}<option value="inherit">Inherit from parent</option>{/if}
		<option value="none">No auth</option>
		{#each Object.entries(LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
		{#if kind !== "inherit" && kind !== "none" && !(kind in LABELS)}<option value={kind}>{kind} (not supported)</option>{/if}
	</select>

	{#if auth === "inherit"}
		<p class="carbonwire-muted">Uses the auth of the closest folder, or of the collection.</p>
	{:else if auth === undefined}
		<p class="carbonwire-muted">No auth is sent with this request.</p>
	{:else if auth.type === "basic" || auth.type === "digest"}
		<label class="carbonwire-field"><span>Username</span><VarInput value={auth.username ?? ""} oninput={(v) => set("username", v)} /></label>
		<label class="carbonwire-field"><span>Password</span><input type="password" value={auth.password ?? ""} oninput={(e) => set("password", e.currentTarget.value)} /></label>
	{:else if auth.type === "bearer"}
		<label class="carbonwire-field"><span>Token</span><VarInput value={auth.token ?? ""} oninput={(v) => set("token", v)} /></label>
	{:else if auth.type === "apikey"}
		<label class="carbonwire-field"><span>Key</span><VarInput value={auth.key ?? ""} oninput={(v) => set("key", v)} /></label>
		<label class="carbonwire-field"><span>Value</span><VarInput value={auth.value ?? ""} oninput={(v) => set("value", v)} /></label>
		<label class="carbonwire-field">
			<span>Add to</span>
			<select class="dropdown" value={auth.placement ?? "header"} onchange={(e) => set("placement", e.currentTarget.value)}>
				<option value="header">Header</option>
				<option value="query">Query params</option>
			</select>
		</label>
	{:else if auth.type === "oauth2"}
		{@const placement = auth.tokenConfig?.placement}
		{@const browser = auth.flow === "authorization_code" || auth.flow === "implicit"}
		<label class="carbonwire-field">
			<span>Grant type</span>
			<select class="dropdown" value={auth.flow} onchange={(e) => setFlow(e.currentTarget.value)}>
				<option value="authorization_code">Authorization code</option>
				<option value="client_credentials">Client credentials</option>
				<option value="resource_owner_password_credentials">Password</option>
				<option value="implicit">Implicit</option>
			</select>
		</label>
		{#if browser}
			<label class="carbonwire-field"><span>Authorization URL</span><VarInput value={auth.authorizationUrl ?? ""} oninput={(v) => setOAuth({ authorizationUrl: v } as Partial<AuthOAuth2>)} /></label>
			<label class="carbonwire-field">
				<span>Callback URL</span>
				<VarInput value={auth.callbackUrl ?? ""} placeholder="Any free port on 127.0.0.1" oninput={(v) => setOAuth({ callbackUrl: v } as Partial<AuthOAuth2>)} />
			</label>
		{/if}
		{#if auth.flow !== "implicit"}
			<label class="carbonwire-field"><span>Access token URL</span><VarInput value={auth.accessTokenUrl ?? ""} oninput={(v) => setOAuth({ accessTokenUrl: v } as Partial<AuthOAuth2>)} /></label>
		{/if}
		<label class="carbonwire-field"><span>Client ID</span><VarInput value={auth.credentials?.clientId ?? ""} oninput={(v) => setCredentials("clientId", v)} /></label>
		{#if auth.flow !== "implicit"}
			<label class="carbonwire-field"><span>Client secret</span><input type="password" value={auth.credentials?.clientSecret ?? ""} oninput={(e) => setCredentials("clientSecret", e.currentTarget.value)} /></label>
			<label class="carbonwire-field">
				<span>Send client credentials</span>
				<select class="dropdown" value={auth.credentials?.placement ?? "basic_auth_header"} onchange={(e) => setCredentials("placement", e.currentTarget.value)}>
					<option value="basic_auth_header">As Basic auth header</option>
					<option value="body">In the request body</option>
				</select>
			</label>
		{/if}
		{#if auth.flow === "resource_owner_password_credentials"}
			{@const owner = auth.resourceOwner}
			<label class="carbonwire-field"><span>Username</span><VarInput value={owner?.username ?? ""} oninput={(v) => setOAuth({ resourceOwner: { ...owner, username: v } } as Partial<AuthOAuth2>)} /></label>
			<label class="carbonwire-field"><span>Password</span><input type="password" value={owner?.password ?? ""} oninput={(e) => setOAuth({ resourceOwner: { ...owner, password: e.currentTarget.value } } as Partial<AuthOAuth2>)} /></label>
		{/if}
		<label class="carbonwire-field"><span>Scope</span><VarInput value={auth.scope ?? ""} oninput={(v) => setOAuth({ scope: v })} /></label>
		{#if browser}
			<label class="carbonwire-field"><span>State</span><VarInput value={auth.state ?? ""} placeholder="Random when empty" oninput={(v) => setOAuth({ state: v } as Partial<AuthOAuth2>)} /></label>
		{/if}
		{#if auth.flow === "authorization_code"}
			<label class="carbonwire-field">
				<span>PKCE</span>
				<select
					class="dropdown"
					value={auth.pkce === undefined || auth.pkce.disabled ? "off" : (auth.pkce.method ?? "S256")}
					onchange={(e) => setOAuth({ pkce: e.currentTarget.value === "off" ? { disabled: true } : { method: e.currentTarget.value as "S256" | "plain" } } as Partial<AuthOAuth2>)}
				>
					<option value="S256">SHA-256</option>
					<option value="plain">Plain</option>
					<option value="off">Off</option>
				</select>
			</label>
		{/if}
		<label class="carbonwire-field">
			<span>Send token in</span>
			<select class="dropdown" value={placement && "query" in placement ? "query" : "header"} onchange={(e) => setPlacement(e.currentTarget.value as "header" | "query", e.currentTarget.value === "query" ? "access_token" : "Bearer")}>
				<option value="header">Authorization header</option>
				<option value="query">Query param</option>
			</select>
		</label>
		{#if placement && "query" in placement}
			<label class="carbonwire-field"><span>Query param name</span><VarInput value={placement.query} oninput={(v) => setPlacement("query", v)} /></label>
		{:else}
			<label class="carbonwire-field"><span>Header prefix</span><VarInput value={placement && "header" in placement ? placement.header : "Bearer"} oninput={(v) => setPlacement("header", v)} /></label>
		{/if}
		{#if browser}
			<p class="carbonwire-muted">Sending opens the sign-in page in your browser the first time. CarbonWire catches the redirect on this computer, so register a callback URL like http://127.0.0.1:8765/callback with the provider.</p>
		{/if}
	{:else if kind in FIELDS}
		{#each FIELDS[kind]! as f (f.key)}
			{#if f.kind === "bool"}
				<label class="carbonwire-field carbonwire-check"><input type="checkbox" checked={flat[f.key] === true || flat[f.key] === "true"} onchange={(e) => setField(f, e.currentTarget.checked || undefined)} />{f.label}</label>
			{:else if f.kind === "select"}
				<label class="carbonwire-field">
					<span>{f.label}</span>
					<select class="dropdown" value={fieldValue(f) || f.options![0]![0]} onchange={(e) => setField(f, e.currentTarget.value)}>
						{#each f.options! as [value, label] (value)}<option {value}>{label}</option>{/each}
					</select>
				</label>
			{:else if f.kind === "area"}
				<label class="carbonwire-field">
					<span>{f.label}</span>
					<textarea rows="4" spellcheck="false" placeholder={f.hint} value={fieldValue(f)} oninput={(e) => setField(f, e.currentTarget.value)}></textarea>
				</label>
			{:else if f.kind === "secret"}
				<label class="carbonwire-field"><span>{f.label}</span><input type="password" placeholder={f.hint} value={fieldValue(f)} oninput={(e) => setField(f, e.currentTarget.value)} /></label>
			{:else}
				<label class="carbonwire-field"><span>{f.label}</span><VarInput value={fieldValue(f)} placeholder={f.hint} oninput={(v) => setField(f, v)} /></label>
			{/if}
		{/each}
		{#if SIDECAR.has(kind)}
			<p class="carbonwire-muted">{LABELS[kind]} settings are kept in the collection's .carbonwire/collection.json, since OpenCollection files can't hold them. Other apps send this request without auth.</p>
		{/if}
	{:else}
		<p class="carbonwire-muted">"{auth.type}" auth is kept in the file but not applied.</p>
	{/if}
</div>
