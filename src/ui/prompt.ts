import { Modal, Setting, type App, type ButtonComponent } from "obsidian";
import { mount, unmount } from "svelte";
import type { CollectionNode, TreeNode } from "../core/storage/tree";
import ColorSwatches from "./ColorSwatches.svelte";
import { colorForName } from "./env-colors";

/** Asks for a single line of text; resolves to undefined if cancelled or left empty. */
export function promptText(app: App, title: string, placeholder = "", initial = "", action = "Create"): Promise<string | undefined> {
	return new Promise((resolve) => {
		const modal = new (class extends Modal {
			private value = initial;
			private submitted = false;

			override onOpen() {
				this.setTitle(title);
				new Setting(this.contentEl).addText((text) => {
					text.setPlaceholder(placeholder).setValue(initial).onChange((v) => (this.value = v));
					text.inputEl.addEventListener("keydown", (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							this.submit();
						}
					});
					window.setTimeout(() => text.inputEl.select(), 0);
				});
				new Setting(this.contentEl).addButton((b) => b.setButtonText(action).setCta().onClick(() => this.submit()));
			}

			submit() {
				this.submitted = true;
				this.close();
			}

			override onClose() {
				const value = this.value.trim();
				resolve(this.submitted && value ? value : undefined);
			}
		})(app);
		modal.open();
	});
}

/** Asks the user to confirm a destructive action. */
export function confirmAction(app: App, title: string, message: string, action: string): Promise<boolean> {
	return new Promise((resolve) => {
		let confirmed = false;
		const modal = new (class extends Modal {
			override onOpen() {
				this.setTitle(title);
				this.contentEl.createEl("p", { text: message });
				new Setting(this.contentEl)
					.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
					.addButton((b) => {
						// Obsidian's warning style for destructive buttons.
						b.buttonEl.addClass("mod-warning");
						b.setButtonText(action).onClick(() => {
							confirmed = true;
							this.close();
						});
					});
			}

			override onClose() {
				resolve(confirmed);
			}
		})(app);
		modal.open();
	});
}

export interface RequestLocation {
	dir: string;
	label: string;
}

/** Every collection and folder, labelled by its path, for choosing where to save a request. */
export function requestLocations(collections: readonly CollectionNode[]): RequestLocation[] {
	const out: RequestLocation[] = [];
	const walk = (nodes: readonly TreeNode[], prefix: string) => {
		for (const n of nodes) {
			if (n.kind !== "folder") continue;
			const label = `${prefix} / ${n.name}`;
			out.push({ dir: n.path, label });
			walk(n.children, label);
		}
	};
	for (const c of collections) {
		out.push({ dir: c.root, label: c.name });
		walk(c.children, c.name);
	}
	return out;
}

/** Asks for a request name and the collection or folder to save it in; nothing is preselected unless given. */
export function promptNewRequest(app: App, locations: readonly RequestLocation[], initial: { name?: string; dir?: string } = {}): Promise<{ name: string; dir: string } | undefined> {
	return new Promise((resolve) => {
		let name = initial.name?.trim() ?? "";
		let dir = locations.some((l) => l.dir === initial.dir) ? initial.dir : undefined;
		let submitted = false;
		const modal = new (class extends Modal {
			private createButton?: ButtonComponent;

			override onOpen() {
				this.setTitle("Save request");
				new Setting(this.contentEl).setName("Name").addText((text) => {
					text.setPlaceholder("Get users").setValue(name).onChange((v) => {
						name = v.trim();
						this.refresh();
					});
					text.inputEl.addEventListener("keydown", (e) => {
						if (e.key === "Enter" && this.ready()) this.submit();
					});
					window.setTimeout(() => text.inputEl.select(), 0);
				});
				new Setting(this.contentEl).setName("Location").addDropdown((d) => {
					d.addOption("", "Choose a collection or folder…");
					for (const [i, l] of locations.entries()) d.addOption(String(i), l.label);
					if (dir !== undefined) d.setValue(String(locations.findIndex((l) => l.dir === dir)));
					d.onChange((v) => {
						dir = v === "" ? undefined : locations[Number(v)]?.dir;
						this.refresh();
					});
				});
				new Setting(this.contentEl).addButton((b) => {
					this.createButton = b.setButtonText("Save").setCta().setDisabled(!this.ready()).onClick(() => this.submit());
				});
			}

			ready(): boolean {
				return name !== "" && dir !== undefined;
			}

			refresh() {
				this.createButton?.setDisabled(!this.ready());
			}

			submit() {
				submitted = true;
				this.close();
			}

			override onClose() {
				resolve(submitted && dir !== undefined ? { name, dir } : undefined);
			}
		})(app);
		modal.open();
	});
}

/** Name and colour for a new or renamed environment. */
export function promptEnvironment(
	app: App,
	/** `suggest: false` keeps the colour fixed while the name changes. */
	options: { title: string; action: string; name?: string; color: string; suggest?: boolean },
): Promise<{ name: string; color: string } | undefined> {
	return new Promise((resolve) => {
		let name = options.name ?? "";
		let color = options.color;
		let submitted = false;
		// Once the user picks a colour, the name stops suggesting one.
		let picked = options.suggest === false;
		let swatches: { suggest(color: string): void } | undefined;
		const modal = new (class extends Modal {
			override onOpen() {
				this.setTitle(options.title);
				new Setting(this.contentEl).setName("Name").addText((text) => {
					text.setPlaceholder("Development").setValue(name).onChange((v) => {
						name = v.trim();
						if (picked) return;
						color = colorForName(name) ?? options.color;
						swatches?.suggest(color);
					});
					text.inputEl.addEventListener("keydown", (e) => {
						if (e.key === "Enter" && name) this.submit();
					});
					window.setTimeout(() => text.inputEl.select(), 0);
				});
				const colorSetting = new Setting(this.contentEl).setName("Colour").setDesc("Highlights the environment when it is active.");
				swatches = mount(ColorSwatches, {
					target: colorSetting.controlEl,
					props: {
						value: color,
						onchange: (next: string) => {
							color = next;
							picked = true;
						},
					},
				}) as { suggest(color: string): void };
				new Setting(this.contentEl).addButton((b) => b.setButtonText(options.action).setCta().onClick(() => name && this.submit()));
			}

			submit() {
				submitted = true;
				this.close();
			}

			override onClose() {
				if (swatches) void unmount(swatches as Record<string, unknown>);
				resolve(submitted && name ? { name, color } : undefined);
			}
		})(app);
		modal.open();
	});
}
