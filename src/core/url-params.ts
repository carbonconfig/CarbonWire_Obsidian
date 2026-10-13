import type { HttpRequestParam } from "./model";

const PATH_PARAM = /\/:([A-Za-z0-9_.-]+)/g;

function splitUrl(url: string): { base: string; query: string | undefined; hash: string } {
	const hashAt = url.indexOf("#");
	const hash = hashAt >= 0 ? url.slice(hashAt) : "";
	const rest = hashAt >= 0 ? url.slice(0, hashAt) : url;
	const queryAt = rest.indexOf("?");
	return queryAt >= 0 ? { base: rest.slice(0, queryAt), query: rest.slice(queryAt + 1), hash } : { base: rest, query: undefined, hash };
}

/** Rebuilds the params list after the URL was edited, keeping path values and disabled query rows. */
export function paramsFromUrl(url: string, current: readonly HttpRequestParam[]): HttpRequestParam[] {
	const { base, query } = splitUrl(url);
	const pathParams = [...base.matchAll(PATH_PARAM)].map((m): HttpRequestParam => {
		const name = m[1]!;
		const existing = current.find((p) => p.type === "path" && p.name === name);
		return { name, value: existing?.value ?? "", type: "path", ...(existing?.description ? { description: existing.description } : {}) };
	});
	const queryParams = (query ?? "")
		.split("&")
		.filter((pair) => pair !== "")
		.map((pair): HttpRequestParam => {
			const eq = pair.indexOf("=");
			return eq >= 0
				? { name: pair.slice(0, eq), value: pair.slice(eq + 1), type: "query" }
				: { name: pair, value: "", type: "query" };
		});
	const disabled = current.filter((p) => p.type === "query" && p.disabled);
	return [...pathParams, ...queryParams, ...disabled];
}

/** Rewrites the URL's query string from the enabled query params, leaving values unencoded for display. */
export function urlFromParams(url: string, params: readonly HttpRequestParam[]): string {
	const { base, hash } = splitUrl(url);
	const qs = params
		.filter((p) => p.type === "query" && !p.disabled && (p.name !== "" || p.value !== ""))
		.map((p) => `${p.name}=${p.value}`)
		.join("&");
	return base + (qs ? `?${qs}` : "") + hash;
}
