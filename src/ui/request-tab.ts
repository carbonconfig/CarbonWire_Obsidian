import type { HttpRequestDetails } from "../core/model";

export type RequestTab = "params" | "headers" | "body" | "auth" | "settings" | "code" | "examples";

/** The tab a request opens on: the first of Body, Params, Auth and Headers that has something in it. */
export function initialTab(http: HttpRequestDetails | undefined): RequestTab {
	if (hasBody(http?.body)) return "body";
	if (http?.params?.some((p) => p.name)) return "params";
	if (http?.auth && http.auth !== "inherit" && (http.auth as { type: string }).type !== "none") return "auth";
	if (http?.headers?.some((h) => h.name)) return "headers";
	return "params";
}

function hasBody(body: HttpRequestDetails["body"]): boolean {
	const current = Array.isArray(body) ? (body.find((v) => v.selected) ?? body[0])?.body : body;
	const data: unknown = current?.data;
	return Array.isArray(data) ? data.length > 0 : typeof data === "string" && data.trim() !== "";
}

export interface ResponseView {
	tab: "body" | "headers" | "cookies" | "timeline";
	view: "text" | "tree" | "preview";
	pretty: boolean;
	filter: string;
}

/** What a request tab shows, kept with the tab so switching back or restarting shows it again. */
export interface TabView {
	tab: RequestTab;
	response?: ResponseView;
}
