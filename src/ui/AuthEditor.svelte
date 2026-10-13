<script lang="ts">
	import type { AuthOAuth2 } from "@opencollection/types/common/auth-oauth2";
	import type { Auth } from "../core/model";
	import VarInput from "./VarInput.svelte";

	let { auth, onchange, canInherit = true }: { auth: Auth | undefined; onchange: (auth: Auth | undefined) => void; canInherit?: boolean } = $props();

	const SUPPORTED = ["inherit", "none", "basic", "bearer", "apikey", "digest", "oauth2"];
	const kind = $derived(auth === undefined ? "none" : auth === "inherit" ? "inherit" : auth.type);

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
		}
	}

	function set(field: string, value: string) {
		if (auth === undefined || auth === "inherit") return;
		onchange({ ...auth, [field]: value } as Auth);
	}

	function setOAuth(patch: Partial<AuthOAuth2> | ((a: AuthOAuth2) => AuthOAuth2)) {
		if (auth === undefined || auth === "inherit" || auth.type !== "oauth2") return;
		onchange(typeof patch === "function" ? patch(auth) : ({ ...auth, ...patch } as AuthOAuth2));
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
		<option value="basic">Basic</option>
		<option value="bearer">Bearer token</option>
		<option value="apikey">API key</option>
		<option value="digest">Digest</option>
		<option value="oauth2">OAuth 2.0</option>
		{#if !SUPPORTED.includes(kind)}<option value={kind}>{kind} (not supported yet)</option>{/if}
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
		<label class="carbonwire-field">
			<span>Grant type</span>
			<select class="dropdown" value={auth.flow} onchange={(e) => setOAuth({ flow: e.currentTarget.value } as Partial<AuthOAuth2>)}>
				<option value="client_credentials">Client credentials</option>
				<option value="resource_owner_password_credentials">Password</option>
				{#if auth.flow === "authorization_code" || auth.flow === "implicit"}<option value={auth.flow}>{auth.flow} (not supported yet)</option>{/if}
			</select>
		</label>
		{#if auth.flow === "client_credentials" || auth.flow === "resource_owner_password_credentials"}
			<label class="carbonwire-field"><span>Access token URL</span><VarInput value={auth.accessTokenUrl ?? ""} oninput={(v) => setOAuth({ accessTokenUrl: v })} /></label>
			<label class="carbonwire-field"><span>Client ID</span><VarInput value={auth.credentials?.clientId ?? ""} oninput={(v) => setCredentials("clientId", v)} /></label>
			<label class="carbonwire-field"><span>Client secret</span><input type="password" value={auth.credentials?.clientSecret ?? ""} oninput={(e) => setCredentials("clientSecret", e.currentTarget.value)} /></label>
			<label class="carbonwire-field">
				<span>Send client credentials</span>
				<select class="dropdown" value={auth.credentials?.placement ?? "basic_auth_header"} onchange={(e) => setCredentials("placement", e.currentTarget.value)}>
					<option value="basic_auth_header">As Basic auth header</option>
					<option value="body">In the request body</option>
				</select>
			</label>
			{#if auth.flow === "resource_owner_password_credentials"}
				{@const owner = auth.resourceOwner}
				<label class="carbonwire-field"><span>Username</span><VarInput value={owner?.username ?? ""} oninput={(v) => setOAuth({ resourceOwner: { ...owner, username: v } } as Partial<AuthOAuth2>)} /></label>
				<label class="carbonwire-field"><span>Password</span><input type="password" value={owner?.password ?? ""} oninput={(e) => setOAuth({ resourceOwner: { ...owner, password: e.currentTarget.value } } as Partial<AuthOAuth2>)} /></label>
			{/if}
			<label class="carbonwire-field"><span>Scope</span><VarInput value={auth.scope ?? ""} oninput={(v) => setOAuth({ scope: v })} /></label>
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
		{/if}
	{:else}
		<p class="carbonwire-muted">"{auth.type}" auth is kept in the file but not applied yet.</p>
	{/if}
</div>
