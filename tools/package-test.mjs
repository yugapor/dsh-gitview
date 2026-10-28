/** Build the distributable and exercise the real DSH CLI in a disposable profile.
 * Requires one of the DSH versions package.json declares under engines.dsh, pnpm and the test-only js-yaml parser; may use the network.
 * No server, model call, user profile, or registry publication is involved.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { load } = createRequire(import.meta.url)("js-yaml");
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = resolve(process.argv[2] ?? join(root, "dist"));
const scratch = mkdtempSync(join(tmpdir(), "dsh-gitview-package-"));
const env = {
	...process.env,
	DSH_HOME: join(scratch, "dsh"),
	npm_config_cache: join(scratch, "npm-cache")
};
const dsh = process.env.DSH_BIN ?? "dsh";
function run(command, args) {
	return execFileSync(command, args, { cwd: scratch, env, encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
}
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

try {
	const version = run(dsh, ["--version"]).trim();
	const verified = json(join(root, "package.json")).engines.dsh.split("||").map((entry) => entry.trim());
	assert.ok(verified.includes(version), `DSH ${version} is not declared in engines.dsh (${verified.join(", ")})`);
	const [pack] = JSON.parse(run("npm", ["pack", root, "--json", "--ignore-scripts", "--pack-destination", scratch]));
	const expected = ["LICENSE", "README.md", "cordis.patch.yml", "lib/ci.js", "lib/client.js", "lib/git.js", "lib/index.js", "package.json"];
	assert.deepEqual(pack.files.map((file) => file.path).sort(), expected.sort(), "only distributable files belong in the archive");
	const archive = join(scratch, pack.filename);
	run("tar", ["-xzf", archive, "-C", scratch]);
	const unpacked = join(scratch, "package");
	const manifest = json(join(unpacked, "package.json"));
	assert.equal(manifest.license, "MIT");
	assert.match(readFileSync(join(unpacked, "LICENSE"), "utf8"), /MIT License[\s\S]*Permission is hereby granted/);
	assert.deepEqual(manifest.engines.dsh.split("||").map((entry) => entry.trim()), verified);
	assert.equal(manifest.dsh.manifestVersion, 1);
	assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
	assert.deepEqual(load(readFileSync(join(unpacked, manifest.dsh.bundle.patch), "utf8")), [
		{ insert: [{ id: "git-tree", name: manifest.name }] }
	]);
	for (const file of expected) assert.deepEqual(readFileSync(join(unpacked, file)), readFileSync(join(root, file)), `${file} must match the tested source`);
	const host = await import(pathToFileURL(join(unpacked, manifest.exports["."].default)));
	assert.equal(host.name, "git-tree");
	assert.equal(typeof host.apply, "function");
	assert.equal(manifest.exports["./client"].default, "./lib/client.js");
	console.log("PASS  archive contents, MIT license, manifest, patch and host entry");

	console.log("Installing archive into a disposable web profile…");
	run(dsh, ["plugin", "--profile", "web", "add", archive, "--store-dir", join(scratch, "pnpm-store")]);
	const profileFile = join(env.DSH_HOME, "profiles", "web", "package.json");
	const installed = json(profileFile);
	assert.ok(installed.dependencies[manifest.name]);
	assert.equal(installed.dsh.profile.bundles.filter((name) => name === manifest.name).length, 1);
	const configured = run(dsh, ["--profile", "web", "--dump-config"]);
	assert.equal((configured.match(/^\s*name: ["']?dsh-gitview["']?\s*$/gm) ?? []).length, 1, "exactly one active plugin row");
	console.log("PASS  standard install and composed plugin registration");

	run(dsh, ["plugin", "--profile", "web", "remove", manifest.name, "--store-dir", join(scratch, "pnpm-store")]);
	const removed = json(profileFile);
	assert.equal(removed.dependencies?.[manifest.name], undefined);
	assert.ok(!removed.dsh.profile.bundles.includes(manifest.name));
	assert.doesNotMatch(run(dsh, ["--profile", "web", "--dump-config"]), /^\s*name: ["']?dsh-gitview["']?\s*$/m);
	console.log("PASS  standard removal clears dependency and registration");

	// Publish an artifact locally only after all checks succeed.
	mkdirSync(output, { recursive: true });
	copyFileSync(archive, join(output, pack.filename));
	console.log(`Verified package: ${join(output, pack.filename)}`);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
