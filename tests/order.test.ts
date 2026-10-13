import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { childrenAt, findNode, insertKey, seqUpdates, siblingLists, sortCollections, type FileTimes } from "../src/core/storage/order";
import { CollectionStore } from "../src/core/storage/store";
import { buildCollections, type TreeNode } from "../src/core/storage/tree";
import { MemoryFiles } from "./memory-files";

const names = (nodes: readonly TreeNode[]) => nodes.map((n) => n.name);

describe("sortCollections", () => {
	const tree = buildCollections(
		["b/opencollection.yml", "a/opencollection.yml", "a/zeta.yml", "a/alpha.yml", "a/mid.yml", "a/f2/x.yml", "a/f1/y.yml"],
		"V",
		new Map([
			["a/zeta.yml", { seq: 1 }],
			["a/alpha.yml", { seq: 2 }],
		]),
	);
	const times: Record<string, FileTimes> = {
		"a/zeta.yml": { ctime: 1, mtime: 30 },
		"a/alpha.yml": { ctime: 3, mtime: 10 },
		"a/mid.yml": { ctime: 2, mtime: 20 },
	};
	const at = (p: string) => times[p];

	it("keeps the saved order in manual mode, with collections in their dragged order", () => {
		const [first, second] = sortCollections(tree, "manual", at, ["b", "a"]);
		expect([first!.name, second!.name]).toEqual(["b", "a"]);
		expect(names(second!.children)).toEqual(["zeta", "alpha", "f1", "f2", "mid"]);
	});

	it("sorts by name both ways, folders first", () => {
		expect(names(sortCollections(tree, "name-asc", at)[0]!.children)).toEqual(["f1", "f2", "alpha", "mid", "zeta"]);
		const desc = sortCollections(tree, "name-desc", at);
		expect(desc.map((c) => c.name)).toEqual(["b", "a"]);
		expect(names(desc[1]!.children)).toEqual(["f2", "f1", "zeta", "mid", "alpha"]);
	});

	it("sorts requests by date, keeping folders alphabetical", () => {
		expect(names(sortCollections(tree, "modified-desc", at)[0]!.children)).toEqual(["f1", "f2", "zeta", "mid", "alpha"]);
		expect(names(sortCollections(tree, "created-asc", at)[0]!.children)).toEqual(["f1", "f2", "zeta", "mid", "alpha"]);
		expect(names(sortCollections(tree, "created-desc", at)[0]!.children)).toEqual(["f1", "f2", "alpha", "mid", "zeta"]);
	});

	it("does not change the input tree", () => {
		sortCollections(tree, "name-desc", at);
		expect(names(tree[0]!.children)).toEqual(["zeta", "alpha", "f1", "f2", "mid"]);
	});
});

describe("reordering", () => {
	it("inserts before, after or at the end", () => {
		expect(insertKey(["a", "b", "c", "d"], "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
		expect(insertKey(["a", "b", "c", "d"], "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
		expect(insertKey(["a", "b"], "x", undefined, "end")).toEqual(["a", "b", "x"]);
		expect(insertKey(["a", "b"], "x", "missing", "before")).toEqual(["a", "b", "x"]);
	});

	it("only rewrites items whose seq changes", () => {
		expect(seqUpdates([{ path: "a", seq: 1 }, { path: "c" }, { path: "b", seq: 2 }])).toEqual([
			{ path: "c", seq: 2 },
			{ path: "b", seq: 3 },
		]);
	});

	it("lists every folder's items in the order shown", () => {
		const shown = sortCollections(buildCollections(["c/opencollection.yml", "c/b.yml", "c/a.yml", "c/f/z.yml", "c/f/y.yml"]), "name-desc", () => undefined);
		const lists = siblingLists(shown);
		expect([...lists.keys()]).toEqual(["c", "c/f"]);
		expect(names(lists.get("c")!)).toEqual(["f", "b", "a"]);
		expect(names(lists.get("c/f")!)).toEqual(["z", "y"]);
	});

	it("finds a folder's children and any node in nested collections", () => {
		const tree = buildCollections(["c/opencollection.yml", "c/f/g/r.yml", "c/f/s.yml", "c/inner/opencollection.yml", "c/inner/t.yml"]);
		expect(names(childrenAt(tree, "c/f")!)).toEqual(["g", "s"]);
		expect(names(childrenAt(tree, "c/inner")!)).toEqual(["t"]);
		expect(childrenAt(tree, "c/nope")).toBeUndefined();
		expect(findNode(tree, "c/f/g/r.yml")).toMatchObject({ kind: "request", name: "r" });
		expect(findNode(tree, "c/inner/t.yml")).toMatchObject({ name: "t" });
	});
});

describe("CollectionStore ordering", () => {
	it("writes seq into requests and folder.yml, creating it if needed", async () => {
		const mem = new MemoryFiles({ "c/r.yml": "info:\n  name: r\n  type: http\nhttp:\n  method: GET\n" });
		const store = new CollectionStore(mem);
		await store.setSeq("c/r.yml", "request", 4);
		await store.setSeq("c/f", "folder", 2);
		expect(parse(mem.files.get("c/r.yml")!)).toMatchObject({ info: { name: "r", seq: 4 }, http: { method: "GET" } });
		expect(parse(mem.files.get("c/f/folder.yml")!)).toMatchObject({ info: { name: "f", seq: 2 }, request: { auth: "inherit" } });
	});

	it("marks writes that only change the order", async () => {
		const mem = new MemoryFiles({ "c/r.yml": "info:\n  name: r\n" });
		const options: unknown[] = [];
		const write = mem.write.bind(mem);
		mem.write = async (path: string, data: string, opts?: unknown) => {
			options.push(opts);
			await write(path, data);
		};
		await new CollectionStore(mem).setSeq("c/r.yml", "request", 1);
		expect(options).toEqual([{ orderOnly: true }]);
	});

	it("keeps the file's seq when an editor saves an older copy", async () => {
		const mem = new MemoryFiles({ "c/r.yml": "info:\n  name: r\n  seq: 5\n" });
		const store = new CollectionStore(mem);
		await store.saveEdited("c/r.yml", { info: { name: "renamed", seq: 1 }, http: { method: "POST" } });
		expect(parse(mem.files.get("c/r.yml")!)).toEqual({ info: { name: "renamed", seq: 5 }, http: { method: "POST" } });
		await store.saveEdited("c/env.yml", { name: "Dev", variables: [] });
		expect(parse(mem.files.get("c/env.yml")!)).toEqual({ name: "Dev", variables: [] });
	});

	it("numbers a file name that is already taken", () => {
		const store = new CollectionStore(new MemoryFiles({ "c/Get.yml": "", "c/Get 2.yml": "" }));
		expect(store.uniqueFile("c", "Get.yml")).toBe("c/Get 3.yml");
		expect(store.uniqueFile("c", "Other.yaml")).toBe("c/Other.yaml");
	});
});
