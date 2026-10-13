import type { DefaultsChain, Environment, Folder, HttpRequest, OpenCollection, RequestDefaults } from "../model";
import { basename, dirname, joinPath, safeFileName, stem } from "./paths";
import { COLLECTION_FILE, FOLDER_FILE } from "./tree";

export interface WriteOptions {
	/**
	 * For changes that only reorder: keeps the created time and moves the modified time on by 1 ms,
	 * so sorting by date is unaffected while sync tools and Obsidian still see a change.
	 */
	orderOnly?: boolean;
}

/** Vault-relative file access, implemented over Obsidian's Vault API and over memory in tests. */
export interface VaultFiles {
	exists(path: string): boolean;
	read(path: string): Promise<string>;
	write(path: string, data: string, options?: WriteOptions): Promise<void>;
	readBinary(path: string): Promise<Uint8Array>;
}

export interface RequestContext {
	collectionRoot: string;
	collection: OpenCollection;
	chain: DefaultsChain;
}

interface Sequenced {
	info?: { seq?: number };
}

const STRINGIFY_OPTIONS = { lineWidth: 0 } as const;

let yaml: Promise<typeof import("yaml")> | undefined;
/** The YAML library is set up on first use rather than when the plugin loads. */
const loadYaml = () => (yaml ??= import("yaml"));

export class CollectionStore {
	private readonly cache = new Map<string, unknown>();

	constructor(private readonly files: VaultFiles) {}

	invalidate(path: string): void {
		this.cache.delete(path);
	}

	async loadRequest(path: string): Promise<HttpRequest> {
		return this.loadDocument<HttpRequest>(path);
	}

	async saveRequest(path: string, request: HttpRequest): Promise<void> {
		await this.writeYaml(path, request);
	}

	exists(path: string): boolean {
		return this.files.exists(path);
	}

	/** Where an environment with this name lives (or would live) in an environments folder. */
	environmentPath(environmentsDir: string, name: string): string {
		return joinPath(environmentsDir, `${safeFileName(name)}.yml`);
	}

	/** Writes a file verbatim, e.g. when copying an OpenCollection folder into the vault. */
	async writeRaw(path: string, text: string): Promise<void> {
		this.cache.delete(path);
		await this.files.write(path, text);
	}

	uniqueFolder(parent: string, name: string): string {
		return this.uniqueDir(parent, name);
	}

	/** Any collection file (opencollection.yml, folder.yml, environment) as an editable copy. */
	async loadDocument<T extends object>(path: string): Promise<T> {
		return structuredClone((await this.readYaml<T>(path)) ?? ({} as T));
	}

	async saveDocument(path: string, value: object): Promise<void> {
		await this.writeYaml(path, value);
	}

	/**
	 * Saves a copy that was open in an editor. The file's `info.seq` wins, because dragging in
	 * the sidebar may have changed it since the editor loaded the file.
	 */
	async saveEdited(path: string, value: object): Promise<void> {
		const seq = (await this.readYaml<Sequenced>(path))?.info?.seq;
		const info = { ...(value as Sequenced).info };
		if (info.seq === seq) return this.writeYaml(path, value);
		if (seq === undefined) delete info.seq;
		else info.seq = seq;
		await this.writeYaml(path, { ...value, info });
	}

	/** Sets the sidebar position of a request file, or of a folder through its folder.yml; returns the file written. */
	async setSeq(path: string, kind: "request" | "folder", seq: number): Promise<string> {
		const file = kind === "folder" ? await this.ensureFolderConfig(path) : path;
		const doc = await this.loadDocument<Sequenced>(file);
		await this.writeYaml(file, { ...doc, info: { ...doc.info, seq } }, { orderOnly: true });
		return file;
	}

	/** A free path for `fileName` in `dir`, numbering it if the name is taken. */
	uniqueFile(dir: string, fileName: string): string {
		const dot = fileName.lastIndexOf(".");
		const [base, ext] = dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, ""];
		let path = joinPath(dir, fileName);
		for (let i = 2; this.files.exists(path); i++) path = joinPath(dir, `${base} ${i}${ext}`);
		return path;
	}

	/** Defaults from the collection root down to the request's own folder, outermost first. */
	async loadContext(collectionRoot: string, requestPath: string): Promise<RequestContext> {
		const collection = (await this.readYaml<OpenCollection>(joinPath(collectionRoot, COLLECTION_FILE))) ?? {};
		const chain: (Folder["request"] | undefined)[] = [collection.request ?? {}];

		const dirs: string[] = [];
		for (let dir = dirname(requestPath); dir !== collectionRoot && dir !== ""; dir = dirname(dir)) dirs.unshift(dir);
		for (const dir of dirs) {
			const folder = await this.readYaml<Folder>(joinPath(dir, FOLDER_FILE));
			chain.push(folder ? (folder.request ?? {}) : undefined);
		}
		return { collectionRoot, collection, chain };
	}

	async createCollection(dir: string, name: string, defaults?: RequestDefaults, docs?: string): Promise<string> {
		const root = this.uniqueDir(dir, name);
		const collection: OpenCollection = { opencollection: "1.0.0", info: { name } };
		if (defaults && Object.keys(defaults).length > 0) collection.request = defaults;
		if (docs) collection.docs = docs;
		await this.writeYaml(joinPath(root, COLLECTION_FILE), collection);
		return root;
	}

	async createRequest(dir: string, name: string, from?: HttpRequest, seq?: number): Promise<string> {
		const path = this.uniquePath(dir, name);
		const request: HttpRequest = from
			? { ...from, info: { ...from.info, name, type: "http", ...(seq !== undefined ? { seq } : {}) } }
			: { info: { name, type: "http" }, http: { method: "GET", url: "", auth: "inherit" } };
		await this.writeYaml(path, request);
		return path;
	}

	/**
	 * Folders inherit auth by default, because a folder.yml without auth means "no auth".
	 * Returns the folder's directory.
	 */
	async createFolder(dir: string, name: string, defaults: RequestDefaults = { auth: "inherit" }, seq?: number, docs?: string): Promise<string> {
		const folderDir = this.uniqueDir(dir, name);
		const folder: Folder = { info: { name, type: "folder", ...(seq !== undefined ? { seq } : {}) }, request: defaults };
		if (docs) folder.docs = docs;
		await this.writeYaml(joinPath(folderDir, FOLDER_FILE), folder);
		return folderDir;
	}

	async ensureFolderConfig(dir: string): Promise<string> {
		const path = joinPath(dir, FOLDER_FILE);
		if (!this.files.exists(path)) {
			const folder: Folder = { info: { name: basename(dir), type: "folder" }, request: { auth: "inherit" } };
			await this.writeYaml(path, folder);
		}
		return path;
	}

	/** An environment is identified by its file name, which is also written as its `name`. */
	async createEnvironmentIn(environmentsDir: string, name: string, from?: Environment): Promise<string> {
		const path = this.uniquePath(environmentsDir, name);
		const env: Environment = { ...structuredClone(from ?? { variables: [] }), name: stem(path) };
		await this.writeYaml(path, env);
		return path;
	}

	async loadEnvironment(path: string): Promise<Environment> {
		const env = await this.loadDocument<Environment>(path);
		return { ...env, name: stem(path) };
	}

	private uniqueDir(parent: string, name: string): string {
		const base = safeFileName(name);
		let dir = joinPath(parent, base);
		for (let i = 2; this.files.exists(dir); i++) dir = joinPath(parent, `${base} ${i}`);
		return dir;
	}

	private uniquePath(dir: string, name: string): string {
		const base = safeFileName(name);
		let path = joinPath(dir, `${base}.yml`);
		for (let i = 2; this.files.exists(path); i++) path = joinPath(dir, `${base} ${i}.yml`);
		return path;
	}

	private async readYaml<T>(path: string): Promise<T | undefined> {
		if (this.cache.has(path)) return this.cache.get(path) as T;
		if (!this.files.exists(path)) return undefined;
		const [text, { parse }] = await Promise.all([this.files.read(path), loadYaml()]);
		const value = (parse(text) ?? {}) as T;
		this.cache.set(path, value);
		return value;
	}

	private async writeYaml(path: string, value: unknown, options?: WriteOptions): Promise<void> {
		const { stringify } = await loadYaml();
		await this.files.write(path, stringify(value, STRINGIFY_OPTIONS), options);
		this.cache.set(path, structuredClone(value));
	}
}
