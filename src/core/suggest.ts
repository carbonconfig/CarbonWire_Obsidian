import type { VariableInfo } from "./variables";

/** One entry in a suggestion list: what's shown, and what replaces the typed text. */
export interface Suggestion {
	label: string;
	detail?: string;
	insert: string;
}

const LIMIT = 50;
const NAME = /^\s*[\w$.-]*$/;

/**
 * The {{variable}} being typed at `caret`: from its {{ up to the caret, or to the end of a name and
 * }} already there, so picking a suggestion replaces the whole reference.
 */
export function variableQuery(text: string, caret: number): { from: number; to: number; query: string } | undefined {
	if (caret < 2) return undefined;
	const from = text.lastIndexOf("{{", caret - 2);
	if (from < 0) return undefined;
	const query = text.slice(from + 2, caret);
	if (!NAME.test(query)) return undefined;
	const rest = /^[\w$.-]*\s*\}\}/.exec(text.slice(caret));
	return { from, to: caret + (rest?.[0].length ?? 0), query: query.trim() };
}

/** Variables in scope whose names match, best first; dynamic values only once a $ is typed. */
export function suggestVariables(query: string, variables: Iterable<VariableInfo>, dynamic: readonly string[]): Suggestion[] {
	const q = query.toLowerCase();
	const ranked: { rank: number; s: Suggestion }[] = [];
	for (const v of variables) {
		const rank = matchRank(v.name, q);
		if (rank >= 0) ranked.push({ rank, s: { label: v.name, detail: v.value === "" ? "empty" : v.value, insert: `{{${v.name}}}` } });
	}
	if (q.startsWith("$")) {
		for (const name of dynamic) {
			const rank = matchRank(name, q);
			if (rank >= 0) ranked.push({ rank: rank + 2, s: { label: name, detail: "a new value each send", insert: `{{${name}}}` } });
		}
	}
	ranked.sort((a, b) => a.rank - b.rank || a.s.label.localeCompare(b.s.label));
	return ranked.slice(0, LIMIT).map((r) => r.s);
}

/** 0 for a prefix match, 1 for a match inside the name, -1 for none. */
function matchRank(name: string, q: string): number {
	if (!q) return 0;
	const lower = name.toLowerCase();
	if (lower.startsWith(q)) return 0;
	return lower.includes(q) ? 1 : -1;
}

const HEADER_VALUES: Record<string, readonly string[]> = {
	Accept: ["application/json", "*/*", "application/xml", "text/html", "text/plain", "text/event-stream"],
	"Accept-Encoding": ["gzip, deflate, br", "gzip", "identity"],
	"Accept-Language": ["en-US,en;q=0.9", "en"],
	Authorization: ["Bearer {{token}}", "Basic {{credentials}}"],
	"Cache-Control": ["no-cache", "no-store", "max-age=0"],
	Connection: ["keep-alive", "close"],
	"Content-Type": ["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain", "application/xml", "text/html", "application/octet-stream"],
	Cookie: [],
	"If-Match": [],
	"If-Modified-Since": [],
	"If-None-Match": [],
	Origin: [],
	Pragma: ["no-cache"],
	Prefer: ["return=representation", "return=minimal", "respond-async"],
	Range: ["bytes=0-1023"],
	Referer: [],
	"User-Agent": [],
	"X-API-Key": ["{{apiKey}}"],
	"X-Correlation-ID": ["{{$guid}}"],
	"X-Forwarded-For": [],
	"X-Request-ID": ["{{$guid}}"],
	"X-Requested-With": ["XMLHttpRequest"],
};

function fromList(list: readonly string[], text: string): Suggestion[] {
	const q = text.trim().toLowerCase();
	if (!q) return [];
	const ranked = list.flatMap((item) => {
		const rank = matchRank(item, q);
		return rank < 0 || item.toLowerCase() === q ? [] : [{ rank, item }];
	});
	ranked.sort((a, b) => a.rank - b.rank);
	return ranked.map(({ item }) => ({ label: item, insert: item }));
}

/** Common request headers whose names match what's typed. */
export function suggestHeaderNames(text: string): Suggestion[] {
	return fromList(Object.keys(HEADER_VALUES), text);
}

/** Usual values for a header, such as application/json for Content-Type; all of them before anything is typed. */
export function suggestHeaderValues(name: string, text: string): Suggestion[] {
	const key = Object.keys(HEADER_VALUES).find((k) => k.toLowerCase() === name.trim().toLowerCase());
	const values = key ? HEADER_VALUES[key]! : [];
	if (!text.trim()) return values.map((v) => ({ label: v, insert: v }));
	return fromList(values, text);
}
