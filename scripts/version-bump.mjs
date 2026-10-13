// Run by `npm version <x.y.z>`: copies the new version into manifest.json and records the
// minimum Obsidian version it needs in versions.json, so all three stay in step.
import { readFile, writeFile } from "node:fs/promises";

const version = process.env.npm_package_version;
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`Obsidian needs an x.y.z version, got "${version}".`);

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
manifest.version = version;
await writeFile("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(await readFile("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
await writeFile("versions.json", `${JSON.stringify(versions, null, 2)}\n`);
