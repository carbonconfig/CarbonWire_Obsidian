import { Notice, type App } from "obsidian";
import type { Environment, Folder, HttpRequest } from "../core/model";
import type { TreeNode } from "../core/storage/tree";
import { insertKey, seqUpdates, siblingLists, type InsertPosition } from "../core/storage/order";
import { basename, dirname, joinPath, safeFileName, stem } from "../core/storage/paths";
import { FOLDER_FILE } from "../core/storage/tree";
import type CarbonWirePlugin from "../main";
import { colorForName, defaultEnvColor } from "../ui/env-colors";
import { confirmAction, promptEnvironment, promptText } from "../ui/prompt";

/** Rename, duplicate and delete for requests, folders and environments. */
export class ItemActions {
	constructor(private readonly app: App, private readonly plugin: CarbonWirePlugin) {}

	/** Prompts for a name unless one is given; resolves to the new path, or undefined. */
	async renameRequest(path: string, newName?: string): Promise<string | undefined> {
		const current = stem(path);
		const name = newName ?? (await promptText(this.app, "Rename request", current, current, "Rename"));
		if (!name || name === current) return undefined;
		const target = joinPath(dirname(path), `${safeFileName(name)}.yml`);
		if (!(await this.move(path, target))) return undefined;
		const request = await this.plugin.store.loadRequest(target);
		await this.plugin.store.saveRequest(target, { ...request, info: { ...request.info, name } });
		return target;
	}

	async duplicateRequest(path: string): Promise<void> {
		const { store } = this.plugin;
		const request: HttpRequest = await store.loadRequest(path);
		const copy = await store.createRequest(dirname(path), `${request.info?.name ?? stem(path)} copy`, request, request.info?.seq);
		await this.plugin.openRequest(copy);
	}

	async deleteRequest(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (file) await this.app.fileManager.trashFile(file);
	}

	async renameFolder(dir: string): Promise<void> {
		const current = basename(dir);
		const name = await promptText(this.app, "Rename folder", current, current, "Rename");
		if (!name || name === current) return;
		const target = joinPath(dirname(dir), safeFileName(name));
		if (!(await this.move(dir, target))) return;
		const config = joinPath(target, FOLDER_FILE);
		if (this.plugin.store.exists(config)) {
			const folder = await this.plugin.store.loadDocument<Folder>(config);
			await this.plugin.store.saveDocument(config, { ...folder, info: { ...folder.info, name } });
		}
	}

	async deleteFolder(dir: string): Promise<void> {
		const folder = this.app.vault.getFolderByPath(dir);
		if (!folder) return;
		const ok = await confirmAction(this.app, "Delete folder", `Move "${basename(dir)}" and every request in it to the trash?`, "Delete");
		if (ok) await this.app.fileManager.trashFile(folder);
	}

	/**
	 * Without a name, asks for a new name and colour. Secret values are keyed by environment
	 * name, so they are copied to the new name first. Resolves to the resulting path.
	 */
	async renameEnvironment(path: string, newName?: string): Promise<string | undefined> {
		const { store } = this.plugin;
		const current = stem(path);
		let name = newName;
		let color: string | undefined;
		if (name === undefined) {
			const env = await store.loadDocument<Environment>(path);
			// A colour the user chose stays; one that came from the old name follows the new name.
			const suggest = !env.color || env.color.toLowerCase() === colorForName(current)?.toLowerCase();
			const choice = await promptEnvironment(this.app, { title: "Edit environment", action: "Save", name: current, color: env.color ?? defaultEnvColor(0), suggest });
			if (!choice) return undefined;
			({ name, color } = choice);
		}

		let target = path;
		if (name && name !== current) {
			target = joinPath(dirname(path), `${safeFileName(name)}.yml`);
			if (store.exists(target)) {
				new Notice(`An environment named "${stem(target)}" already exists.`);
				return undefined;
			}
			const env = await store.loadDocument<Environment>(path);
			for (const v of env.variables ?? []) {
				if (!("secret" in v) || !v.secret || !v.name) continue;
				const value = this.plugin.secretFor(path, v.name);
				if (value !== null) {
					this.plugin.setSecretFor(target, v.name, value);
					this.plugin.setSecretFor(path, v.name, "");
				}
			}
			if (!(await this.move(path, target))) return undefined;
			await store.saveDocument(target, { ...env, name: stem(target) });
		}
		if (color) {
			const env = await store.loadDocument<Environment>(target);
			if (env.color !== color) await store.saveDocument(target, { ...env, color });
		}
		return target;
	}

	/** Copies a collection's own environments, such as a Bruno collection's, to the shared environments. */
	async copyCollectionEnvironments(paths: readonly string[]): Promise<void> {
		const { store } = this.plugin;
		const names: string[] = [];
		for (const path of paths) {
			const file = this.app.vault.getFileByPath(path);
			if (!file) continue;
			const target = store.uniqueFile(this.plugin.environmentsFolder(), basename(path));
			await store.writeRaw(target, await this.app.vault.cachedRead(file));
			names.push(stem(target));
		}
		new Notice(`Added environment${names.length === 1 ? "" : "s"} ${names.map((n) => `"${n}"`).join(", ")}.`);
	}

	async duplicateEnvironment(path: string): Promise<void> {
		const { store } = this.plugin;
		const env = await store.loadEnvironment(path);
		const copy = await store.createEnvironmentIn(dirname(path), `${env.name} copy`, env);
		for (const v of env.variables ?? []) {
			if (!("secret" in v) || !v.secret || !v.name) continue;
			const value = this.plugin.secretFor(path, v.name);
			if (value !== null) this.plugin.setSecretFor(copy, v.name, value);
		}
	}

	async deleteEnvironment(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		if (this.plugin.activeEnvironment() === stem(path)) await this.plugin.setActiveEnvironment("");
		await this.app.fileManager.trashFile(file);
	}

	/**
	 * Moves a request or folder into `dir`, before or after `anchor` or at the end, renaming it if
	 * the name is taken there. Order is saved as `seq` in each affected file.
	 * When the sidebar is sorted another way, what it shows becomes the manual order first, so
	 * only the dragged item moves when it switches to manual order.
	 */
	async moveTreeItem(path: string, dir: string, anchor: string | undefined, position: InsertPosition): Promise<void> {
		const { plugin } = this;
		const { store } = plugin;
		const sorted = plugin.sortOrder() !== "manual";
		const shown = sorted ? plugin.collections() : plugin.index.manualTree();
		const lists = siblingLists(shown);
		const nodes = new Map([...lists.values()].flat().map((n) => [n.path, n]));
		const node = nodes.get(path);
		const siblings = lists.get(dir);
		if (!node || !siblings) return;

		const orders = new Map<string, string[]>();
		if (sorted) for (const [d, list] of lists) orders.set(d, list.map((n) => n.path).filter((p) => p !== path));
		orders.set(dir, insertKey(siblings.map((n) => n.path), path, anchor, position));

		let target = path;
		if (dirname(path) !== dir) {
			target = node.kind === "folder" ? store.uniqueFolder(dir, basename(path)) : store.uniqueFile(dir, basename(path));
			if (!(await this.move(path, target))) return;
		}
		await this.writeOrders(orders, nodes, (p) => (p === path ? target : p.startsWith(`${path}/`) ? target + p.slice(path.length) : p));
		if (sorted) await plugin.useManualOrder(shown.map((c) => c.root));
		else plugin.index.rebuild();
	}

	/** Reorders collections, keeping what is shown inside them when leaving another sort order. */
	async moveCollection(root: string, anchor: string, position: "before" | "after"): Promise<void> {
		const { plugin } = this;
		const shown = plugin.collections();
		const roots = insertKey(shown.map((c) => c.root), root, anchor, position);
		if (plugin.sortOrder() === "manual") return plugin.setCollectionOrder(roots);
		const lists = siblingLists(shown);
		const orders = new Map([...lists].map(([dir, list]) => [dir, list.map((n) => n.path)]));
		await this.writeOrders(orders, new Map([...lists.values()].flat().map((n) => [n.path, n])));
		await plugin.useManualOrder(roots);
	}

	/** Writes `seq` wherever it differs, so each folder's items read in the given order. */
	private async writeOrders(orders: Map<string, string[]>, nodes: Map<string, TreeNode>, pathNow = (p: string) => p): Promise<void> {
		for (const order of orders.values()) {
			for (const u of seqUpdates(order.map((p) => ({ path: p, seq: nodes.get(p)?.seq })))) {
				const file = await this.plugin.store.setSeq(pathNow(u.path), nodes.get(u.path)?.kind ?? "request", u.seq);
				this.plugin.index.noteSeq(file, u.seq);
			}
		}
	}

	private async move(from: string, to: string): Promise<boolean> {
		const item = this.app.vault.getAbstractFileByPath(from);
		if (!item) return false;
		if (this.app.vault.getAbstractFileByPath(to)) {
			new Notice(`"${basename(to)}" already exists here.`);
			return false;
		}
		await this.app.fileManager.renameFile(item, to);
		return true;
	}
}
