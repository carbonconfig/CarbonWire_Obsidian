import { EXTRA_SETTINGS } from "../inheritance";
import type { Auth, Folder, HttpRequest, OpenCollection } from "../model";
import { dirname } from "./paths";
import { COLLECTION_FILE, FOLDER_FILE } from "./tree";

/*
 * A collection's .carbonwire/collection.json holds what OpenCollection files can't, keyed by
 * each item's path inside the collection.
 */
export const SIDECAR_FILE = ".carbonwire/collection.json";

export interface Extras {
	postmanId?: string;
	/** An auth type OpenCollection has no shape for, in Postman's form; the item's file has no auth. */
	auth?: PostmanAuth;
	/** A raw body's language when OpenCollection doesn't name it, such as html. */
	bodyLanguage?: string;
	/** Request settings OpenCollection lacks, by their Postman names. */
	settings?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface Sidecar {
	version: number;
	collection?: Extras;
	/** Requests by file and folders by folder, relative to the collection root. */
	items?: Record<string, Extras>;
	[key: string]: unknown;
}

export interface PostmanAuth {
	type: string;
	[key: string]: unknown;
}

/** Auth types kept in the sidecar, in the flat form CarbonWire edits: `{type, ...fields}`. */
export const SIDECAR_AUTH_TYPES = ["jwt", "hawk", "edgegrid", "asap"] as const;

/** A flat auth object for the types OpenCollection lacks. */
export interface FlatAuth {
	type: (typeof SIDECAR_AUTH_TYPES)[number];
	[field: string]: unknown;
}

export function isSidecarAuth(auth: unknown): auth is FlatAuth {
	return typeof auth === "object" && auth !== null && (SIDECAR_AUTH_TYPES as readonly string[]).includes((auth as { type?: string }).type ?? "");
}

/** Postman's `{type, <type>: [{key, value}]}` as a flat object. */
export function flattenPostmanAuth(raw: PostmanAuth): FlatAuth {
	const type = raw.type === "akamai" ? "edgegrid" : raw.type;
	const out: Record<string, unknown> = { type };
	const fields = raw[raw.type];
	if (Array.isArray(fields)) {
		for (const p of fields as { key?: unknown; value?: unknown }[]) if (typeof p.key === "string") out[p.key] = p.value ?? null;
	} else if (fields && typeof fields === "object") {
		Object.assign(out, fields);
	}
	return out as FlatAuth;
}

/** The flat object back in Postman's form, for the sidecar. */
export function toPostmanAuth(flat: FlatAuth): PostmanAuth {
	const list = Object.entries(flat)
		.filter(([k]) => k !== "type")
		.map(([key, value]) => ({ key, value, type: typeof value === "boolean" ? "boolean" : "string" }));
	return { type: flat.type, [flat.type]: list };
}

/** The sidecar key for a file in a collection: "" for the collection itself, a folder's directory, or a request's file. */
export function sidecarKey(root: string, path: string): string {
	const file = path.endsWith(`/${FOLDER_FILE}`) || path === FOLDER_FILE ? dirname(path) : path;
	if (file === root || path === `${root}/${COLLECTION_FILE}` || (root === "" && path === COLLECTION_FILE)) return "";
	return root === "" ? file : file.slice(root.length + 1);
}

export function extrasOf(sidecar: Sidecar | undefined, key: string): Extras | undefined {
	return key === "" ? sidecar?.collection : sidecar?.items?.[key];
}

/** Sets a key's extras, removing the entry when it's empty. Returns whether the sidecar changed. */
export function setExtras(sidecar: Sidecar, key: string, extras: Extras | undefined): boolean {
	const clean = extras && withoutEmpty(extras);
	const before = JSON.stringify(extrasOf(sidecar, key) ?? null);
	if (before === JSON.stringify(clean ?? null)) return false;
	if (key === "") {
		if (clean) sidecar.collection = clean;
		else delete sidecar.collection;
	} else {
		const items = (sidecar.items ??= {});
		if (clean) items[key] = clean;
		else delete items[key];
		if (Object.keys(items).length === 0) delete sidecar.items;
	}
	return true;
}

function withoutEmpty(extras: Extras): Extras | undefined {
	const out: Extras = {};
	for (const [k, v] of Object.entries(extras)) {
		if (v === undefined || v === null) continue;
		if (k === "settings" && typeof v === "object" && Object.keys(v).length === 0) continue;
		out[k] = v;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Moves the entries for `from` (a file or folder) to `to`, keeping them under `from` too for a
 * duplicate, which drops the Postman ID. Both keys are inside the same sidecar.
 */
export function moveEntries(source: Sidecar, from: string, target: Sidecar, to: string, keepOld: boolean): boolean {
	let changed = false;
	for (const [key, extras] of Object.entries(source.items ?? {})) {
		if (key !== from && !key.startsWith(`${from}/`)) continue;
		const moved = to + key.slice(from.length);
		const copy: Extras = structuredClone(extras);
		if (keepOld) delete copy.postmanId;
		else delete source.items![key];
		target.items ??= {};
		target.items[moved] = copy;
		changed = true;
	}
	if (source.items && Object.keys(source.items).length === 0) delete source.items;
	return changed;
}

type Doc = HttpRequest | Folder | OpenCollection;

function isRequest(doc: Doc): doc is HttpRequest {
	return "http" in doc || (doc as HttpRequest).info?.type === "http";
}

/** The doc with its extras put back: sidecar auth in place of the file's, and extra settings merged in. */
export function mergeExtras<T extends Doc>(doc: T, extras: Extras | undefined): T {
	if (!extras?.auth && !extras?.settings) return doc;
	const out = structuredClone(doc) as Doc;
	const auth = extras.auth ? (flattenPostmanAuth(extras.auth) as unknown as Auth) : undefined;
	const settings = extras.settings && pickExtraSettings(extras.settings);
	if (isRequest(out)) {
		if (auth) out.http = { ...out.http, auth };
		if (settings) out.settings = { ...out.settings, ...settings };
	} else {
		const defaults = (out.request ??= {});
		if (auth) defaults.auth = auth;
		if (settings) defaults.settings = { ...defaults.settings, http: { ...defaults.settings?.http, ...settings } };
	}
	return out as T;
}

/**
 * Splits an edited doc into what goes in its YAML file and what goes in the sidecar. Extras the
 * doc doesn't carry, such as a Postman ID, are kept from `previous`.
 */
export function splitExtras<T extends Doc>(doc: T, previous: Extras | undefined): { doc: T; extras: Extras | undefined } {
	const out = structuredClone(doc) as Doc;
	const authHolder: { auth?: Auth } | undefined = isRequest(out) ? out.http : out.request;
	const settingsHolder = isRequest(out) ? out.settings : (out).request?.settings?.http;

	const extras: Extras = { ...previous };
	delete extras.auth;
	delete extras.settings;
	const auth = authHolder?.auth;
	if (isSidecarAuth(auth)) {
		extras.auth = toPostmanAuth(auth);
		delete authHolder!.auth;
	}
	if (settingsHolder) {
		const kept = pickExtraSettings(settingsHolder as Record<string, unknown>);
		if (kept) {
			extras.settings = kept;
			for (const k of EXTRA_SETTINGS) delete (settingsHolder as Record<string, unknown>)[k];
		}
		if (Object.keys(settingsHolder).length === 0) {
			if (isRequest(out)) delete out.settings;
			else if ((out).request?.settings) {
				delete (out).request.settings.http;
				if (Object.keys((out).request.settings).length === 0) delete (out).request.settings;
			}
		}
	}
	return { doc: out as T, extras: withoutEmpty(extras) };
}

function pickExtraSettings(settings: Record<string, unknown>): Record<string, unknown> | undefined {
	const out: Record<string, unknown> = {};
	for (const k of EXTRA_SETTINGS) if (settings[k] !== undefined && settings[k] !== "inherit") out[k] = settings[k];
	return Object.keys(out).length > 0 ? out : undefined;
}
