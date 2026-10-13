import { Modal, Notice, Setting, type App } from "obsidian";
import { importBrunoFolder } from "../core/import/bruno";
import { importText } from "../core/import/detect";
import { countItems, type ImportedEnvironment, type ImportResult } from "../core/import/model";
import { writeImport, type EnvironmentResolution, type ImportTarget } from "../core/import/writer";
import { basename, joinPath, stem } from "../core/storage/paths";
import type CarbonWirePlugin from "../main";

const FILE_TYPES = ".json,.yaml,.yml,.har,.http,.rest,.bru,.txt";
const FOLDER_FILES = /\.(bru|json|ya?ml|md)$/i;
const SKIPPED_DIRS = /(^|\/)(node_modules|\.git)(\/|$)/;
const NEW = "new";

interface FolderFile {
	path: string;
	text: string;
}

export interface ImportModalOptions {
	/** Preselects this collection as the destination. */
	collectionRoot?: string;
	/** Opened for environments: only environment files are accepted. */
	environments?: boolean;
}

type ConflictChoice = "rename" | "merge-imported" | "merge-existing";

/** Choose a file, a folder or pasted text, preview what will be imported, then write it. */
export class ImportModal extends Modal {
	constructor(app: App, private readonly plugin: CarbonWirePlugin, private readonly options: ImportModalOptions = {}) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.options.environments ? "Import environment" : "Import into CarbonWire");
		this.renderSource();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private renderSource(error?: string): void {
		const { contentEl } = this;
		contentEl.empty();
		if (error) contentEl.createDiv({ cls: "carbonwire-error", text: error });

		new Setting(contentEl)
			.setName("File")
			.setDesc(
				this.options.environments
					? "Postman, Insomnia, Hoppscotch, HTTPie, Bruno (.bru or .yml) or http-client.env.json environment files."
					: "Postman, Insomnia, Hoppscotch or HTTPie exports, HAR, .http and .bru files, and environment files.",
			)
			.addButton((b) => b.setButtonText("Choose file…").setCta().onClick(() => this.pickFile()));

		if (!this.options.environments) {
			new Setting(contentEl)
				.setName("Folder")
				.setDesc("A Bruno collection folder (.bru files), or an OpenCollection folder, which is copied as-is.")
				.addButton((b) => b.setButtonText("Choose folder…").onClick(() => this.pickFolder()));
		}

		const paste = new Setting(contentEl).setName("Paste").setDesc(this.options.environments ? "The contents of an environment file." : "A curl command, or the contents of any supported file.");
		paste.settingEl.addClass("carbonwire-import-paste");
		const textarea = contentEl.createEl("textarea", { cls: "carbonwire-code", attr: { placeholder: "Paste here", rows: "6" } });
		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Continue").onClick(() => {
				if (textarea.value.trim()) this.parse(() => importText(textarea.value));
			}),
		);
	}

	private pickFile(): void {
		const input = createEl("input", { type: "file", attr: { accept: FILE_TYPES } });
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (file) void file.text().then((text) => this.parse(() => importText(text, file.name)));
		});
		input.click();
	}

	private pickFolder(): void {
		const input = createEl("input", { type: "file" });
		input.webkitdirectory = true;
		input.addEventListener("change", () => void this.readFolder(Array.from(input.files ?? [])));
		input.click();
	}

	private async readFolder(selected: File[]): Promise<void> {
		const files: FolderFile[] = [];
		for (const file of selected) {
			const path = file.webkitRelativePath || file.name;
			if (FOLDER_FILES.test(path) && !SKIPPED_DIRS.test(path)) files.push({ path, text: await file.text() });
		}
		const openCollection = files.find((f) => basename(f.path) === "opencollection.yml");
		if (openCollection) await this.copyOpenCollection(files, openCollection.path);
		else this.parse(() => importBrunoFolder(files));
	}

	private parse(run: () => ImportResult): void {
		try {
			const result = run();
			if (this.options.environments && result.collections.length > 0) {
				this.renderSource("This file contains requests. Use Import in the Collections section instead.");
				return;
			}
			this.renderPreview(result);
		} catch (e) {
			this.renderSource(e instanceof Error ? e.message : String(e));
		}
	}

	private renderPreview(result: ImportResult): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("p", { text: `Detected: ${result.format}` });

		const list = contentEl.createEl("ul");
		for (const c of result.collections) {
			const { requests, folders } = countItems(c.items);
			const parts = [plural(requests, "request")];
			if (folders) parts.push(plural(folders, "folder"));
			if (c.environments.length) parts.push(plural(c.environments.length, "environment"));
			list.createEl("li", { text: `${c.name}: ${parts.join(", ")}` });
		}
		for (const env of result.environments) list.createEl("li", { text: `Environment "${env.name}": ${plural(env.variables.length, "variable")}` });

		if (result.warnings.length) {
			const details = contentEl.createEl("details", { cls: "carbonwire-warning" });
			details.createEl("summary", { text: `${plural(result.warnings.length, "note")} about this import` });
			const ul = details.createEl("ul");
			for (const w of result.warnings) ul.createEl("li", { text: w });
		}

		const collections = this.plugin.collections();
		const envOnly = result.collections.length === 0;
		const { requests, folders } = result.collections.length === 1 ? countItems(result.collections[0]!.items) : { requests: 0, folders: 1 };
		const singleRequest = requests === 1 && folders === 0;

		// Environments are shared, so only collections need a destination.
		let target = NEW;
		if (envOnly) {
			contentEl.createEl("p", { cls: "carbonwire-muted", text: "Environments are shared by every collection." });
		} else {
			const targets = new Map<string, string>([[NEW, `New collection in ${this.plugin.collectionsFolder() || "the vault root"}`]]);
			for (const c of collections) targets.set(c.root, `Add to ${c.name}`);
			// Whole collections default to a new collection; single requests to the current one.
			target = this.options.collectionRoot ?? (singleRequest ? (this.plugin.focusedCollection() ?? collections[0]?.root ?? NEW) : NEW);
			if (!targets.has(target)) target = NEW;
			new Setting(contentEl).setName("Import into").addDropdown((d) => {
				for (const [value, label] of targets) d.addOption(value, label);
				d.setValue(target).onChange((v) => (target = v));
			});
		}

		const resolutions = new Map<string, EnvironmentResolution>();
		const environments = [...result.environments, ...result.collections.flatMap((c) => c.environments)];
		const conflictsEl = contentEl.createDiv();
		for (const env of environments) this.renderConflict(conflictsEl, this.plugin.environmentsFolder(), env, resolutions);

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Back").onClick(() => this.renderSource()))
			.addButton((b) =>
				b.setButtonText("Import").setCta().onClick(async () => {
					b.setDisabled(true);
					const destination: ImportTarget = envOnly ? { kind: "environments" } : target === NEW ? { kind: "new", dir: this.plugin.collectionsFolder() } : { kind: "existing", root: target };
					await this.write(result, destination, resolutions);
				}),
			);
	}

	/** Shows a choice for an environment whose name is already taken in the destination folder. */
	private renderConflict(container: HTMLElement, dir: string, env: ImportedEnvironment, resolutions: Map<string, EnvironmentResolution>): void {
		const { store } = this.plugin;
		const existing = store.environmentPath(dir, env.name);
		if (!store.exists(existing)) return;
		let suggestion = `${env.name} 2`;
		for (let i = 3; store.exists(store.environmentPath(dir, suggestion)); i++) suggestion = `${env.name} ${i}`;

		let choice: ConflictChoice = "rename";
		let newName = suggestion;
		const nameSetting = new Setting(container);
		const apply = () => {
			resolutions.set(env.name, choice === "rename" ? { action: "rename", name: newName.trim() || suggestion } : { action: "merge", prefer: choice === "merge-imported" ? "imported" : "existing" });
			nameSetting.settingEl.toggle(choice === "rename");
		};

		new Setting(container)
			.setName(`"${stem(existing)}" already exists`)
			.setDesc("Import it under a new name, or merge its variables into the existing environment.")
			.addDropdown((d) =>
				d
					.addOption("rename", "Import with a new name")
					.addOption("merge-imported", "Merge, using imported values")
					.addOption("merge-existing", "Merge, keeping existing values")
					.setValue(choice)
					.onChange((v) => {
						choice = v as ConflictChoice;
						apply();
					}),
			);
		container.appendChild(nameSetting.settingEl);
		nameSetting.setName("New name").addText((t) =>
			t.setValue(newName).onChange((v) => {
				newName = v;
				apply();
			}),
		);
		apply();
	}

	private async write(result: ImportResult, target: ImportTarget, resolutions: Map<string, EnvironmentResolution>): Promise<void> {
		try {
			const summary = await writeImport(this.plugin.store, result, target, {
				environmentsDir: this.plugin.environmentsFolder(),
				resolutions,
				setSecret: (path, name, value) => this.plugin.setSecretFor(path, name, value),
			});
			const parts: string[] = [];
			if (summary.requests) parts.push(plural(summary.requests, "request"));
			if (summary.environments.length) parts.push(`environment${summary.environments.length === 1 ? "" : "s"} ${summary.environments.map((n) => `"${n}"`).join(", ")}`);
			new Notice(parts.length ? `Imported ${parts.join(" and ")}.` : "Nothing was imported.");
			this.close();
		} catch (e) {
			this.renderSource(e instanceof Error ? e.message : String(e));
		}
	}

	/** Copies an OpenCollection folder as is, moving its environments to the shared environments. */
	private async copyOpenCollection(files: FolderFile[], rootFile: string): Promise<void> {
		const { store } = this.plugin;
		const sourceRoot = rootFile.slice(0, -"opencollection.yml".length).replace(/\/$/, "");
		const name = basename(sourceRoot) || "Collection";
		const destination = store.uniqueFolder(this.plugin.collectionsFolder(), name);
		let copied = 0;
		const environments: string[] = [];
		for (const f of files) {
			if (sourceRoot && !f.path.startsWith(`${sourceRoot}/`)) continue;
			const relative = sourceRoot ? f.path.slice(sourceRoot.length + 1) : f.path;
			if (/^environments\/[^/]+\.ya?ml$/i.test(relative)) {
				const target = store.uniqueFile(this.plugin.environmentsFolder(), basename(relative));
				await store.writeRaw(target, f.text);
				environments.push(stem(target));
				continue;
			}
			await store.writeRaw(joinPath(destination, relative), f.text);
			copied++;
		}
		const envs = environments.length ? ` and environment${environments.length === 1 ? "" : "s"} ${environments.map((n) => `"${n}"`).join(", ")}` : "";
		new Notice(`Copied ${copied} files into ${destination}${envs}.`);
		this.close();
	}
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}
