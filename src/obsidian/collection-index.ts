import { debounce, TFile, type App, type TAbstractFile } from "obsidian";
import { sortCollections, type SortOrder } from "../core/storage/order";
import { basename, dirname } from "../core/storage/paths";
import { buildCollections, COLLECTION_FILE, extractMeta, FOLDER_FILE, isYaml, type CollectionNode, type FileMeta, type TreeNode } from "../core/storage/tree";

const META_BATCH = 100;
const META_CACHE_KEY = "carbonwire-meta";

/** Metadata with the file's modified time and size when it was read. */
type MetaEntry = [mtime: number, size: number, meta: FileMeta];

export interface IndexOptions {
	sortOrder(): SortOrder;
	collectionOrder(): readonly string[];
	environmentsFolder(): string;
	environments(): string[];
	changed(collections: CollectionNode[]): void;
}

/**
 * The collection trees, built from vault paths, plus the light metadata (method, order, colour)
 * read from inside the files. Metadata is cached across sessions, keyed by modified time and
 * size, so only files that changed are read at startup.
 */
export class CollectionIndex {
	private manual?: CollectionNode[];
	private sorted?: CollectionNode[];
	private readonly meta = new Map<string, MetaEntry>();
	private metaLoading?: Promise<void>;
	private saved?: Record<string, MetaEntry>;

	readonly refresh = debounce(() => this.rebuild(), 150, true);
	private readonly resort = debounce(() => {
		this.sorted = undefined;
		this.options.changed(this.collections());
	}, 150, true);
	private readonly saveCache = debounce(() => this.flush(), 2000, true);

	constructor(private readonly app: App, private readonly options: IndexOptions) {
		const saved: unknown = app.loadLocalStorage(META_CACHE_KEY);
		if (saved && typeof saved === "object") this.saved = saved as Record<string, MetaEntry>;
	}

	/** Collections in the sidebar's sort order. */
	collections(): CollectionNode[] {
		this.sorted ??= sortCollections(this.manualTree(), this.options.sortOrder(), (path) => this.app.vault.getFileByPath(path)?.stat, this.options.collectionOrder());
		return this.sorted;
	}

	/** Collections in their saved order, whatever the sidebar shows; dragging edits this order. */
	manualTree(): CollectionNode[] {
		if (!this.manual) {
			this.restoreCache();
			const meta = new Map([...this.meta].map(([path, entry]) => [path, entry[2]]));
			this.manual = buildCollections(this.app.vault.getFiles().map((f) => f.path), this.app.vault.getName(), meta);
			this.loadMeta();
		}
		return this.manual;
	}

	collectionFor(path: string): CollectionNode | undefined {
		let best: CollectionNode | undefined;
		for (const c of this.manualTree()) {
			if ((c.root === "" || path.startsWith(`${c.root}/`)) && (!best || c.root.length > best.root.length)) best = c;
		}
		return best;
	}

	metaFor(path: string): FileMeta | undefined {
		return this.meta.get(path)?.[2];
	}

	rebuild(): void {
		this.manual = undefined;
		this.sorted = undefined;
		this.options.changed(this.collections());
	}

	/**
	 * Records a `seq` just written, so the tree doesn't wait for the file to be read back:
	 * a modify event may arrive late, or not at all when the file's size and time look unchanged.
	 */
	noteSeq(path: string, seq: number): void {
		const stat = this.app.vault.getFileByPath(path)?.stat;
		this.meta.set(path, [stat?.mtime ?? 0, stat?.size ?? 0, { ...this.metaFor(path), seq }]);
		this.saveCache();
	}

	/** Returns whether the file is part of a collection or an environment. */
	modified(file: TAbstractFile): boolean {
		if (!(file instanceof TFile) || !isYaml(file.path) || !this.isTracked(file.path)) return false;
		void this.readMeta(file).then((changed) => {
			if (changed) this.refresh();
			// Sorting by last update reorders on every save, without rebuilding the trees.
			else if (this.options.sortOrder().startsWith("modified")) this.resort();
		});
		return true;
	}

	/** A file or folder was created or deleted. */
	createdOrDeleted(file: TAbstractFile): void {
		if (file instanceof TFile) {
			if (!isYaml(file.path)) return;
			if (!this.app.vault.getFileByPath(file.path)) {
				if (this.meta.delete(file.path) || this.isTracked(file.path)) this.refresh();
				return;
			}
			if (basename(file.path) === COLLECTION_FILE || this.isTracked(file.path)) void this.readMeta(file).then(() => this.refresh());
		} else if (this.touchesCollections(file.path)) {
			this.refresh();
		}
	}

	renamed(file: TAbstractFile, oldPath: string): void {
		const entry = this.meta.get(oldPath);
		this.meta.delete(oldPath);
		if (entry) this.meta.set(file.path, entry);
		if (!(file instanceof TFile)) {
			// A folder moved: its files' metadata moves with it.
			for (const [path, m] of [...this.meta]) {
				if (!path.startsWith(`${oldPath}/`)) continue;
				this.meta.delete(path);
				this.meta.set(file.path + path.slice(oldPath.length), m);
			}
			if (this.touchesCollections(oldPath) || this.touchesCollections(file.path)) this.refresh();
		} else if (isYaml(file.path) || isYaml(oldPath)) {
			this.refresh();
		}
		this.saveCache();
	}

	/** Writes the metadata cache now, e.g. when the plugin unloads. */
	flush(): void {
		this.app.saveLocalStorage(META_CACHE_KEY, Object.fromEntries(this.meta));
	}

	private isTracked(path: string): boolean {
		return dirname(path) === this.options.environmentsFolder() || this.collectionFor(path) !== undefined;
	}

	/** Whether a folder is, contains or sits inside a collection or the environments folder. */
	private touchesCollections(dir: string): boolean {
		const related = (root: string) => root === "" || root === dir || root.startsWith(`${dir}/`) || dir.startsWith(`${root}/`);
		return related(this.options.environmentsFolder()) || (this.manual ?? []).some((c) => related(c.root));
	}

	/** Uses cached metadata for every file that hasn't changed since it was cached; runs once. */
	private restoreCache(): void {
		if (!this.saved) return;
		for (const [path, entry] of Object.entries(this.saved)) {
			const stat = this.app.vault.getFileByPath(path)?.stat;
			if (stat && Array.isArray(entry) && entry[0] === stat.mtime && entry[1] === stat.size) this.meta.set(path, entry);
		}
		this.saved = undefined;
	}

	/**
	 * Methods and saved order live inside the files, so files the cache didn't cover are read in the
	 * background after the tree is shown, in batches that keep the UI responsive.
	 */
	private loadMeta(): void {
		if (this.metaLoading) return;
		const files: TFile[] = [];
		const add = (path: string) => {
			const file = this.app.vault.getFileByPath(path);
			if (file && !this.meta.has(path)) files.push(file);
		};
		const walk = (nodes: readonly TreeNode[]) => {
			for (const n of nodes) {
				if (n.kind === "request") add(n.path);
				else {
					if (n.hasConfig) add(`${n.path}/${FOLDER_FILE}`);
					walk(n.children);
				}
			}
		};
		for (const c of this.manual ?? []) walk(c.children);
		for (const path of this.options.environments()) add(path);
		if (files.length === 0) return;
		this.metaLoading = (async () => {
			await Promise.resolve();
			for (let i = 0; i < files.length; i += META_BATCH) {
				await Promise.all(files.slice(i, i + META_BATCH).map((f) => this.readMeta(f).catch(() => false)));
				await new Promise((resolve) => window.setTimeout(resolve, 0));
			}
			this.rebuild();
			this.flush();
		})().finally(() => (this.metaLoading = undefined));
	}

	/** Returns whether the file's metadata changed. */
	private async readMeta(file: TFile): Promise<boolean> {
		const { mtime, size } = file.stat;
		const next = extractMeta(await this.app.vault.cachedRead(file));
		const prev = this.metaFor(file.path);
		this.meta.set(file.path, [mtime, size, next]);
		this.saveCache();
		return prev?.method !== next.method || prev?.seq !== next.seq || prev?.color !== next.color;
	}
}
