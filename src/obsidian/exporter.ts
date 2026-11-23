import { FileSystemAdapter, Notice, SuggestModal, type App } from "obsidian";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { docsText, postmanCollection, postmanEnvironment, postmanV3, postmanV3Environment, curlScript, har, type Collected, type CollectedItem } from "../core/export/collection";
import { zip } from "../core/export/zip";
import type { Folder, HttpRequest, OpenCollection } from "../core/model";
import { basename, joinPath, stem } from "../core/storage/paths";
import { SIDECAR_FILE, type Sidecar } from "../core/storage/sidecar";
import { COLLECTION_FILE, FOLDER_FILE, type TreeNode } from "../core/storage/tree";
import type CarbonWirePlugin from "../main";
import { saveDownload } from "../ui/download";

interface Choice {
	id: string;
	label: string;
	detail: string;
}

const COLLECTION_FORMATS: Choice[] = [
	{ id: "postman", label: "Postman collection (v2.1 JSON)", detail: "Imports into Postman, Insomnia, Bruno and most API tools." },
	{ id: "postman-v3", label: "Postman v3 (YAML, zipped)", detail: "Postman's Git-native layout: postman/collections/<name>." },
	{ id: "opencollection", label: "OpenCollection (zip)", detail: "The collection's files as they are, for Bruno or another CarbonWire." },
	{ id: "curl", label: "cURL script", detail: "One cURL command per request, with variables left as {{name}}." },
	{ id: "har", label: "HAR", detail: "Each request, with its first saved example as the response." },
];

const ENVIRONMENT_FORMATS: Choice[] = [
	{ id: "json", label: "Postman environment (JSON)", detail: "Imports into Postman and most API tools." },
	{ id: "v3", label: "Postman v3 environment (YAML)", detail: "Postman's Git-native layout." },
];

function choose(app: App, title: string, choices: Choice[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		let picked: string | undefined;
		const modal = new (class extends SuggestModal<Choice> {
			getSuggestions(query: string): Choice[] {
				const q = query.toLowerCase();
				return choices.filter((c) => c.label.toLowerCase().includes(q));
			}
			renderSuggestion(choice: Choice, el: HTMLElement): void {
				el.createDiv({ text: choice.label });
				el.createEl("small", { text: choice.detail, cls: "carbonwire-muted" });
			}
			onChooseSuggestion(choice: Choice): void {
				picked = choice.id;
			}
			override onClose(): void {
				// Obsidian calls onChooseSuggestion after onClose, so wait a tick.
				window.setTimeout(() => resolve(picked), 0);
			}
		})(app);
		modal.setPlaceholder(title);
		modal.open();
	});
}

/** The collection's documents, sidecar extras merged in, in the sidebar's manual order. */
async function collect(plugin: CarbonWirePlugin, root: string): Promise<Collected> {
	const { store, index } = plugin;
	const node = index.manualTree().find((c) => c.root === root);
	if (!node) throw new Error("That collection is no longer in the vault.");
	const collection = await store.loadDocument<OpenCollection>(joinPath(root, COLLECTION_FILE));
	const sidecarText = await plugin.app.vault.adapter.read(joinPath(root, SIDECAR_FILE)).catch(() => undefined);
	const sidecar = sidecarText ? (JSON.parse(sidecarText) as Sidecar) : undefined;
	const items = async (nodes: readonly TreeNode[]): Promise<CollectedItem[]> =>
		Promise.all(
			nodes.map(async (n): Promise<CollectedItem> => {
				if (n.kind === "folder") {
					const folder = n.hasConfig ? await store.loadDocument<Folder>(joinPath(n.path, FOLDER_FILE)) : ({} as Folder);
					return { kind: "folder", name: folder.info?.name ?? n.name, dir: n.path, defaults: folder.request ?? { auth: "inherit" }, docs: docsText(folder.docs), items: await items(n.children) };
				}
				const request: HttpRequest = await store.loadRequest(n.path);
				return { kind: "request", name: request.info?.name ?? n.name, path: n.path, request };
			}),
		);
	return { name: collection.info?.name ?? node.name, root, defaults: collection.request ?? {}, docs: docsText(collection.docs), sidecar, items: await items(node.children) };
}

async function walk(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== ".git" && entry.name !== "node_modules") out.push(...(await walk(full)));
		} else if (entry.isFile()) {
			out.push(full);
		}
	}
	return out;
}

/** Exports a collection; the file is saved where the user picks, outside the vault. */
export async function exportCollection(plugin: CarbonWirePlugin, root: string): Promise<void> {
	const format = await choose(plugin.app, "Export the collection as…", COLLECTION_FORMATS);
	if (!format) return;
	try {
		const collected = await collect(plugin, root);
		const base = collected.name.replace(/[/\\:*?"<>|]/g, "-").trim() || "Collection";
		const { stringify } = await import("yaml");
		switch (format) {
			case "postman":
				return saveDownload(`${base}.postman_collection.json`, `${JSON.stringify(postmanCollection(collected), null, 2)}\n`, "application/json");
			case "curl":
				return saveDownload(`${base}.sh`, curlScript(collected), "text/x-shellscript");
			case "har":
				return saveDownload(`${base}.har`, `${JSON.stringify(har(collected, plugin.manifest.version), null, 2)}\n`, "application/json");
			case "postman-v3": {
				const encoder = new TextEncoder();
				const entries = postmanV3(collected).map((f) => ({ name: `postman/${f.path}`, data: encoder.encode(stringify(f.value, { lineWidth: 0 })) }));
				return saveDownload(`${base}.postman-v3.zip`, zip(entries), "application/zip");
			}
			case "opencollection": {
				const adapter = plugin.app.vault.adapter;
				if (!(adapter instanceof FileSystemAdapter)) throw new Error("Exporting a zip needs the desktop app.");
				const fsRoot = adapter.getFullPath(root);
				const prefix = basename(root) || "collection";
				const entries = await Promise.all((await walk(fsRoot)).map(async (file) => ({ name: `${prefix}/${relative(fsRoot, file).split("\\").join("/")}`, data: await readFile(file) })));
				return saveDownload(`${base}.zip`, zip(entries), "application/zip");
			}
		}
	} catch (e) {
		new Notice(`Couldn't export: ${e instanceof Error ? e.message : String(e)}`);
	}
}

export async function exportEnvironment(plugin: CarbonWirePlugin, path: string): Promise<void> {
	const format = await choose(plugin.app, "Export the environment as…", ENVIRONMENT_FORMATS);
	if (!format) return;
	const env = await plugin.store.loadEnvironment(path);
	const name = stem(path);
	if (format === "json") return saveDownload(`${name}.postman_environment.json`, `${JSON.stringify(postmanEnvironment(env, name), null, 2)}\n`, "application/json");
	const { stringify } = await import("yaml");
	saveDownload(`${name}.environment.yaml`, stringify(postmanV3Environment(env, name).value, { lineWidth: 0 }), "application/yaml");
}
