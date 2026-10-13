import { debounce, Events, FileSystemAdapter, Notice, Plugin, TFile, type TAbstractFile } from "obsidian";
import type { OAuth2Tokens } from "./core/auth/oauth2";
import type { HttpRequest } from "./core/model";
import { buildRequest } from "./core/request-builder";
import { environmentSecretId } from "./core/secrets";
import type { SendResult } from "./core/sender";
import { insertKey, type SortOrder } from "./core/storage/order";
import { dirname, joinPath, stem } from "./core/storage/paths";
import { CollectionStore } from "./core/storage/store";
import { compare, isYaml, type CollectionNode } from "./core/storage/tree";
import type { SendProgress, Transport } from "./core/transport/types";
import { resolveEnvironment } from "./core/variables";
import { CollectionIndex } from "./obsidian/collection-index";
import { HistoryStore, type HistoryEntry } from "./obsidian/history";
import { ItemActions } from "./obsidian/item-actions";
import { ObsidianVaultFiles } from "./obsidian/vault-files";
import { CarbonWireSettingTab, DEFAULT_SETTINGS, type CarbonWireSettings, type RequestLayout } from "./settings";
import "./styles.css";
import { CollectionsView, VIEW_TYPE_COLLECTIONS } from "./ui/collections-view";
import { CARBONWIRE_ICON, registerIcon } from "./ui/icon";
import { disposeJsonWorker } from "./ui/json-format";
import { refreshTabTitle, requestTitle, RequestView, VIEW_TYPE_REQUEST, type DraftState } from "./ui/request-view";
import { SettingsView, settingsTitle, VIEW_TYPE_SETTINGS } from "./ui/settings-view";

export interface EnvironmentEntry {
	path: string;
	name: string;
	color?: string;
}

export default class CarbonWirePlugin extends Plugin {
	override settings: CarbonWireSettings = structuredClone(DEFAULT_SETTINGS);
	store!: CollectionStore;
	actions!: ItemActions;
	index!: CollectionIndex;
	history!: HistoryStore;
	private readonly events = new Events();
	private focusedRoot?: string;
	private transport?: Transport;
	private oauth2?: OAuth2Tokens;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.store = new CollectionStore(new ObsidianVaultFiles(this.app.vault));
		this.actions = new ItemActions(this.app, this);
		this.index = new CollectionIndex(this.app, {
			sortOrder: () => this.settings.sortOrder,
			collectionOrder: () => this.settings.collectionOrder,
			environmentsFolder: () => this.environmentsFolder(),
			environments: () => this.environments(),
			changed: (collections) => this.events.trigger("collections-changed", collections),
		});
		const adapter = this.app.vault.adapter;
		const vaultKey = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : this.app.vault.getName();
		this.history = new HistoryStore(`carbonwire-history:${vaultKey}`, () => this.settings.historySize, () => this.events.trigger("history-changed"));

		registerIcon();
		this.registerView(VIEW_TYPE_COLLECTIONS, (leaf) => new CollectionsView(leaf, this));
		this.registerView(VIEW_TYPE_REQUEST, (leaf) => new RequestView(leaf, this));
		this.registerView(VIEW_TYPE_SETTINGS, (leaf) => new SettingsView(leaf, this));
		this.addSettingTab(new CarbonWireSettingTab(this.app, this));
		this.addRibbonIcon(CARBONWIRE_ICON, "Open CarbonWire", () => void this.activateCollectionsView());
		this.addCommand({
			id: "open-collections",
			name: "Open collections",
			callback: () => void this.activateCollectionsView(),
		});
		this.addCommand({
			id: "new-request",
			name: "New request",
			callback: () => void this.openDraft(),
		});
		this.addCommand({
			id: "import",
			name: "Import collection, environment or cURL",
			callback: () => void this.openImport(),
		});
		// Ctrl/Cmd+Enter is bound inside request tabs; this lets users add their own hotkey too.
		this.addCommand({
			id: "send-request",
			name: "Send request",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(RequestView);
				if (!view) return false;
				if (!checking) view.send();
				return true;
			},
		});

		// Obsidian emits a create event for every file while the vault loads, so listen afterwards.
		this.app.workspace.onLayoutReady(() => {
			this.restorePlaceholderTabs();
			this.registerEvent(this.app.vault.on("modify", (file) => this.fileModified(file)));
			this.registerEvent(this.app.vault.on("create", (file) => this.fileChanged(file)));
			this.registerEvent(this.app.vault.on("delete", (file) => this.fileChanged(file)));
			this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.fileRenamed(file, oldPath)));
		});
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				const view = leaf?.view;
				if (view instanceof RequestView && !view.file) this.events.trigger("active-request", undefined);
				if (!(view instanceof RequestView || view instanceof SettingsView) || !view.file) return;
				if (view instanceof RequestView) this.events.trigger("active-request", view.file);
				this.focusedRoot = this.collectionFor(view.file)?.root ?? this.focusedRoot;
			}),
		);
	}

	/**
	 * Restores tabs left as placeholders while the plugin was off: loaded ones reload as real
	 * tabs, and unloaded background tabs get their real title and icon.
	 */
	private restorePlaceholderTabs(): void {
		const views = [
			[VIEW_TYPE_REQUEST, RequestView, CARBONWIRE_ICON, (s: Record<string, unknown>) => requestTitle(s)],
			[VIEW_TYPE_SETTINGS, SettingsView, "settings-2", (s: Record<string, unknown>) => settingsTitle(typeof s.file === "string" ? s.file : undefined)],
			[VIEW_TYPE_COLLECTIONS, CollectionsView, CARBONWIRE_ICON, () => "CarbonWire"],
		] as const;
		let renamed = false;
		for (const [type, ViewClass, icon, title] of views) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				if (leaf.view instanceof ViewClass) continue;
				if (!leaf.isDeferred) {
					void leaf.setViewState({ ...leaf.getViewState(), active: false });
					continue;
				}
				// Obsidian's unloaded tab keeps its title and icon in these fields, which aren't public API.
				const placeholder = leaf.view as unknown as { title?: unknown; icon?: unknown };
				if (typeof placeholder.title !== "string") continue;
				placeholder.title = title(leaf.getViewState().state ?? {});
				placeholder.icon = icon;
				refreshTabTitle(leaf);
				renamed = true;
			}
		}
		if (renamed) this.app.workspace.requestSaveLayout();
	}

	override onunload(): void {
		this.index.flush();
		this.transport?.dispose();
		this.history.close();
		disposeJsonWorker();
	}

	async loadSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<CarbonWireSettings>;
		this.settings = structuredClone(DEFAULT_SETTINGS);
		// Copies only known settings, so unknown keys are dropped from data.json.
		for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof CarbonWireSettings)[]) {
			if (data[key] !== undefined) (this.settings as unknown as Record<string, unknown>)[key] = data[key];
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		void this.history.prune();
	}

	/** Collections in the sidebar's sort order. */
	collections(): CollectionNode[] {
		return this.index.collections();
	}

	collectionFor(path: string): CollectionNode | undefined {
		return this.index.collectionFor(path);
	}

	sortOrder(): SortOrder {
		return this.settings.sortOrder;
	}

	async setSortOrder(order: SortOrder): Promise<void> {
		if (this.settings.sortOrder === order) return;
		this.settings.sortOrder = order;
		this.index.rebuild();
		await this.saveSettings();
	}

	/** Switches to manual order, with the collections in the order they are shown. */
	async useManualOrder(roots: string[]): Promise<void> {
		this.settings.collectionOrder = roots;
		this.settings.sortOrder = "manual";
		this.index.rebuild();
		await this.saveSettings();
	}

	async setCollectionOrder(roots: string[]): Promise<void> {
		this.settings.collectionOrder = roots;
		this.index.rebuild();
		await this.saveSettings();
	}

	async moveEnvironment(path: string, anchor: string, position: "before" | "after"): Promise<void> {
		this.settings.environmentOrder = insertKey(this.environments().map(stem), stem(path), stem(anchor), position);
		this.index.rebuild();
		await this.saveSettings();
	}

	collectionsFolder(): string {
		return this.settings.collectionsFolder;
	}

	environmentsFolder(): string {
		return this.settings.environmentsFolder;
	}

	/** Environment files, shared by every collection, in the order they were dragged to. */
	environments(): string[] {
		const folder = this.app.vault.getFolderByPath(this.environmentsFolder());
		if (!folder) return [];
		const rank = new Map(this.settings.environmentOrder.map((name, i) => [name, i]));
		return folder.children
			.filter((f): f is TFile => f instanceof TFile && isYaml(f.path))
			.map((f) => f.path)
			.sort((a, b) => (rank.get(stem(a)) ?? Infinity) - (rank.get(stem(b)) ?? Infinity) || compare(stem(a), stem(b)));
	}

	/** Environments with the colour from their file, once the background scan has read it. */
	environmentEntries(): EnvironmentEntry[] {
		return this.environments().map((path) => ({ path, name: stem(path), color: this.index.metaFor(path)?.color }));
	}

	activeEnvironmentEntry(): EnvironmentEntry | undefined {
		const name = this.activeEnvironment();
		return name ? this.environmentEntries().find((e) => e.name === name) : undefined;
	}

	/** Environments are identified by file name; returns "" when none is active or it no longer exists. */
	activeEnvironment(): string {
		const name = this.settings.activeEnvironment;
		return name && this.environments().some((p) => stem(p) === name) ? name : "";
	}

	async setActiveEnvironment(name: string): Promise<void> {
		if (this.settings.activeEnvironment === name) return;
		this.settings.activeEnvironment = name;
		this.events.trigger("environment-changed", name);
		await this.saveSettings();
	}

	onEnvironmentChanged(callback: (name: string) => void): () => void {
		const ref = this.events.on("environment-changed", (name) => callback(name as string));
		return () => this.events.offref(ref);
	}

	secretFor(environmentPath: string, name: string): string | null {
		return this.app.secretStorage.getSecret(environmentSecretId(environmentPath, name));
	}

	setSecretFor(environmentPath: string, name: string, value: string): void {
		this.app.secretStorage.setSecret(environmentSecretId(environmentPath, name), value);
	}

	onCollectionsChanged(callback: (collections: CollectionNode[]) => void): () => void {
		const ref = this.events.on("collections-changed", (collections) => callback(collections as CollectionNode[]));
		return () => this.events.offref(ref);
	}

	/** Highlights a request in the sidebar, e.g. right after an unsaved request is saved. */
	noteActiveRequest(path: string): void {
		this.events.trigger("active-request", path);
		this.focusedRoot = this.collectionFor(path)?.root ?? this.focusedRoot;
	}

	onActiveRequestChanged(callback: (path: string | undefined) => void): () => void {
		const ref = this.events.on("active-request", (path) => callback(path as string | undefined));
		return () => this.events.offref(ref);
	}

	/** The collection of the request or settings tab the user last focused. */
	focusedCollection(): string | undefined {
		return this.focusedRoot;
	}

	requestLayout(): RequestLayout {
		return this.settings.requestLayout;
	}

	async setRequestLayout(layout: RequestLayout): Promise<void> {
		this.settings.requestLayout = layout;
		this.events.trigger("layout-changed", layout);
		await this.saveSettings();
	}

	async setWrapResponseLines(wrap: boolean): Promise<void> {
		this.settings.wrapResponseLines = wrap;
		this.events.trigger("wrap-changed", wrap);
		await this.saveSettings();
	}

	onWrapResponseLinesChanged(callback: (wrap: boolean) => void): () => void {
		const ref = this.events.on("wrap-changed", (wrap) => callback(wrap as boolean));
		return () => this.events.offref(ref);
	}

	onRequestLayoutChanged(callback: (layout: RequestLayout) => void): () => void {
		const ref = this.events.on("layout-changed", (layout) => callback(layout as RequestLayout));
		return () => this.events.offref(ref);
	}

	/** The importers are large, so they load when the dialog first opens. */
	async openImport(options: { collectionRoot?: string; environments?: boolean } = {}): Promise<void> {
		const { ImportModal } = await import("./ui/import-modal");
		new ImportModal(this.app, this, options).open();
	}

	async openRequest(path: string): Promise<void> {
		await this.openInView(VIEW_TYPE_REQUEST, path);
	}

	/** Opens an unsaved request in a new tab; `dir` is where Save suggests putting it. */
	async openDraft(draft: Partial<DraftState> = {}): Promise<void> {
		const state: DraftState = { name: "New request", request: { http: { method: "GET", url: "" } }, ...draft };
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_REQUEST, state: { draft: state }, active: true });
		await this.app.workspace.revealLeaf(leaf);
		if (leaf.view instanceof RequestView) leaf.view.focusUrl();
	}

	/** Reopens a send from history, with its response, as an unsaved request. */
	async openHistoryEntry(entry: HistoryEntry): Promise<void> {
		await this.openDraft({ name: entry.name, request: entry.request, dir: entry.source ? dirname(entry.source) : undefined, historyId: entry.id });
	}

	onHistoryChanged(callback: () => void): () => void {
		const ref = this.events.on("history-changed", callback);
		return () => this.events.offref(ref);
	}

	/** Opens a collection file or environment in the matching CarbonWire editor. */
	async openFile(path: string): Promise<void> {
		await this.openInView(VIEW_TYPE_SETTINGS, path);
	}

	/**
	 * Sends a saved request (`path`) or an unsaved one (no path, so only the active environment
	 * applies), and records it in history.
	 */
	async send(path: string | undefined, name: string, request: HttpRequest, signal: AbortSignal, onProgress?: (progress: SendProgress) => void): Promise<SendResult> {
		const time = Date.now();
		const environment = this.activeEnvironment() || undefined;
		const record = (outcome: Pick<HistoryEntry, "error"> & { response?: SendResult["response"] }) =>
			void this.history.add({ time, name, source: path, environment, request, ...outcome }).catch(() => undefined);
		try {
			const [{ requestScope, sendRequest }, { readBodyFile }, transport, oauth2] = await Promise.all([
				import("./core/sender"),
				import("./obsidian/body-files"),
				this.getTransport(),
				this.getOAuth2(),
			]);
			const { root, context, scope } = await this.scopeFor(path, request, requestScope);
			const result = await sendRequest(buildRequest(request, context.chain, scope), {
				transport,
				oauth2,
				readFile: (file) => readBodyFile(this.app.vault, root, file),
				rejectUnauthorized: this.settings.rejectUnauthorized,
				maxBodyBytes: Math.round(this.settings.maxResponseMB * 1024 * 1024),
				signal,
				onProgress,
			});
			record({ response: result.response });
			return result;
		} catch (e) {
			if (!signal.aborted) record({ error: e instanceof Error ? e.message : String(e) });
			throw e;
		}
	}

	/**
	 * Copies the request as cURL with variables, inherited auth and OAuth 2.0 tokens resolved,
	 * as it would be sent. Body file paths become absolute so the command runs anywhere.
	 */
	async copyCurl(path: string | undefined, request: HttpRequest): Promise<void> {
		try {
			const [{ requestScope, withOAuth2 }, { toCurl }, oauth2] = await Promise.all([import("./core/sender"), import("./core/export/curl"), this.getOAuth2()]);
			const { root, context, scope } = await this.scopeFor(path, request, requestScope);
			const resolved = await withOAuth2(buildRequest(request, context.chain, scope), oauth2, { rejectUnauthorized: this.settings.rejectUnauthorized });
			const adapter = this.app.vault.adapter;
			const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
			const absolute = (file: string) => (/^(\/|[A-Za-z]:[\\/])/.test(file) ? file : `${base}/${joinPath(root, file)}`);
			await navigator.clipboard.writeText(toCurl(resolved, { filePath: absolute, insecure: !this.settings.rejectUnauthorized }));
			new Notice("Copied as cURL.");
		} catch (e) {
			new Notice(`Couldn't copy as cURL: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/** Names of every variable the request can use with the active environment, for highlighting. */
	async variableNames(path: string | undefined, request: HttpRequest): Promise<string[]> {
		const { requestScope } = await import("./core/sender");
		const scoped = await this.scopeFor(path, request, requestScope).catch(() => undefined);
		return scoped ? [...scoped.scope.keys()] : [];
	}

	onDocumentsChanged(callback: () => void): () => void {
		const ref = this.events.on("documents-changed", callback);
		return () => this.events.offref(ref);
	}

	/** An unsaved request has no collection, so it gets no collection or folder defaults. */
	private async scopeFor(path: string | undefined, request: HttpRequest, requestScope: typeof import("./core/sender").requestScope) {
		const collection = path === undefined ? undefined : this.collectionFor(path);
		if (path !== undefined && !collection) throw new Error("This request is no longer inside a collection.");
		const root = collection?.root ?? "";
		const context = collection && path ? await this.store.loadContext(root, path) : { collectionRoot: "", collection: {}, chain: [] };
		const name = this.activeEnvironment();
		const environmentPath = name ? this.environments().find((p) => stem(p) === name) : undefined;
		const environment = environmentPath ? await this.store.loadEnvironment(environmentPath) : undefined;
		const variables = resolveEnvironment(environment, (variable) => (environmentPath ? this.secretFor(environmentPath, variable) : null));
		return { root, context, scope: requestScope(context, request, variables) };
	}

	/** Node's http stack loads on first send rather than at startup. */
	private async getTransport(): Promise<Transport> {
		if (!this.transport) {
			const { NodeTransport } = await import("./core/transport/node");
			this.transport = new NodeTransport(`CarbonWire/${this.manifest.version}`);
		}
		return this.transport;
	}

	private async getOAuth2(): Promise<OAuth2Tokens> {
		if (!this.oauth2) {
			const { OAuth2Tokens } = await import("./core/auth/oauth2");
			this.oauth2 = new OAuth2Tokens(await this.getTransport());
		}
		return this.oauth2;
	}

	private async openInView(type: string, path: string): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(type).find((l) => (l.view as RequestView | SettingsView).file === path);
		const leaf = existing ?? workspace.getLeaf("tab");
		if (!existing) await leaf.setViewState({ type, state: { file: path }, active: true });
		await workspace.revealLeaf(leaf);
		if (leaf.view instanceof RequestView) leaf.view.focusUrl();
	}

	private async activateCollectionsView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_COLLECTIONS)[0];
		const leaf = existing ?? workspace.getLeftLeaf(false);
		if (!leaf) return;
		if (!existing) await leaf.setViewState({ type: VIEW_TYPE_COLLECTIONS, active: true });
		await workspace.revealLeaf(leaf);
	}

	private readonly documentsChanged = debounce(() => this.events.trigger("documents-changed"), 300, true);

	private fileModified(file: TAbstractFile): void {
		this.store.invalidate(file.path);
		if (this.index.modified(file)) this.documentsChanged();
	}

	private fileChanged(file: TAbstractFile): void {
		this.store.invalidate(file.path);
		this.index.createdOrDeleted(file);
	}

	private fileRenamed(file: TAbstractFile, oldPath: string): void {
		this.store.invalidate(oldPath);
		this.store.invalidate(file.path);
		this.index.renamed(file, oldPath);
		if (isYaml(oldPath) || !(file instanceof TFile)) void this.history.moveSource(oldPath, file.path).catch(() => undefined);
		this.followEnvironmentRename(oldPath, file.path);
		for (const type of [VIEW_TYPE_REQUEST, VIEW_TYPE_SETTINGS]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				const view = leaf.view as RequestView | SettingsView;
				if (view.file === oldPath) view.renamed(file.path);
				else if (view.file?.startsWith(`${oldPath}/`)) view.renamed(file.path + view.file.slice(oldPath.length));
			}
		}
	}

	/** Keeps an environment selected, and in its place, when its file is renamed in place. */
	private followEnvironmentRename(oldPath: string, newPath: string): void {
		if (!isYaml(oldPath) || dirname(oldPath) !== this.environmentsFolder() || dirname(newPath) !== dirname(oldPath)) return;
		const order = this.settings.environmentOrder;
		const i = order.indexOf(stem(oldPath));
		if (i >= 0) {
			order[i] = stem(newPath);
			void this.saveSettings();
		}
		if (this.settings.activeEnvironment === stem(oldPath)) void this.setActiveEnvironment(stem(newPath));
	}
}
