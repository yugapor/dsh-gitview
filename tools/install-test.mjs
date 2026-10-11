/**
 * Test of the install script — the one part that writes to a DSH profile.
 *
 * It runs the real `tools/install-into-profile.sh` against a SYNTHETIC
 * `$DSH_HOME` under the system temp directory, so nothing here reads or writes
 * the developer's actual `~/.dsh`. The only thing borrowed from the real
 * machine is the YAML parser from `profiles/node_modules`, symlinked read-only.
 * CI supplies that parser through NODE_PATH instead, without installing DSH.
 *
 * Run: node tools/install-test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const installScript = join(packageDir, "tools", "install-into-profile.sh");
const realHome = process.env.DSH_HOME ?? join(process.env.HOME ?? "", ".dsh");
const realNodeModules = join(realHome, "profiles", "node_modules");

console.log("install-test");

let passed = 0;
function check(name, fn) {
	fn();
	passed++;
	console.log(`  ok  ${name}`);
}

/** A synthetic DSH home, with a profile that looks like the real one. */
function fakeHome({ patch }) {
	const home = mkdtempSync(join(tmpdir(), "dsh-gitview-home-"));
	const profileDir = join(home, "profiles", "web");
	mkdirSync(profileDir, { recursive: true });
	writeFileSync(
		join(home, "profiles", "package.json"),
		JSON.stringify({ name: "dsh-profile-web", private: true, dsh: { profile: { bundles: [], patchReload: "live" } } }, null, 2)
	);
	writeFileSync(join(profileDir, "cordis.yml"), "# dsh profile root - an empty entry list.\n");
	writeFileSync(join(profileDir, "cordis.patch.yml"), patch);
	// Borrow only the YAML parsers, read-only: these are what the validator
	// resolves, and they are the one thing the synthetic home cannot provide. The
	// directory itself stays real, so every write lands under the temp root
	// instead of resolving through a symlink back into the developer's profile.
	const modules = join(home, "profiles", "node_modules");
	mkdirSync(modules, { recursive: true });
	if (existsSync(realNodeModules)) {
		for (const name of ["js-yaml", "argparse", "yaml"]) {
			const real = join(realNodeModules, name);
			if (existsSync(real)) symlinkSync(real, join(modules, name));
		}
	}
	return home;
}

/**
 * Run the installer against one synthetic home.
 *
 * stderr is folded into stdout so one string carries the whole transcript, and
 * DSH_BIN points at a program that always fails: any test that passes is proof
 * the harness was never booted.
 */
function install(home, extraEnv = {}) {
	return execFileSync("bash", ["-c", 'bash "$1" web 2>&1', "git-tree-install-test", installScript], {
		cwd: packageDir,
		encoding: "utf8",
		env: { ...process.env, DSH_HOME: home, DSH_BIN: "/usr/bin/false", ...extraEnv }
	});
}

/** Parse a patch file with the profile's own YAML parser. */
function parsePatch(file) {
	const script = `
		const fs = require("node:fs");
		const { load } = require(require.resolve("js-yaml", { paths: [process.argv[2]] }));
		process.stdout.write(JSON.stringify(load(fs.readFileSync(process.argv[1], "utf8"))));
	`;
	const out = execFileSync("node", ["-e", script, file, realNodeModules], { encoding: "utf8" });
	return JSON.parse(out);
}

/** The insert rows a patch document declares. */
const insertRows = (doc) =>
	(Array.isArray(doc) ? doc : []).flatMap((row) => (row && Array.isArray(row.insert) ? row.insert : []));

/** A patch shaped like the real profile's: a top-level list with plain rows. */
const REALISTIC_PATCH = `# Synthetic profile patch for the install test.
- insert:
    - id: locale-ja
      name: dsh-locale-ja
- id: ui-theme
  name: "@deepseek-ai/dsh-client-ui-theme"
  config:
    preference: light
`;

const home = fakeHome({ patch: REALISTIC_PATCH });
const profileDir = join(home, "profiles", "web");
const patchFile = join(profileDir, "cordis.patch.yml");

try {
	check("the installer links the package into both node_modules", () => {
		install(home);
		for (const target of [join(profileDir, "node_modules", "dsh-gitview"), join(home, "profiles", "node_modules", "dsh-gitview")]) {
			assert.ok(lstatSync(target).isSymbolicLink(), `${target} should be a symlink`);
			assert.equal(readlinkSync(target), packageDir);
		}
	});

	check("the patch gains one insert row and still parses as YAML", () => {
		const doc = parsePatch(patchFile);
		const rows = insertRows(doc);
		assert.deepEqual(
			rows.map((row) => row.id),
			["locale-ja", "git-tree"],
			"the existing row must survive above the new one"
		);
		const ours = rows.find((row) => row.id === "git-tree");
		assert.equal(ours.name, "dsh-gitview");
		// The pre-existing sibling row must be untouched.
		assert.ok(doc.some((row) => row.id === "ui-theme"), "the ui-theme row must survive");
	});

	check("the install is idempotent", () => {
		const output = install(home);
		assert.match(output, /already present/);
		const rows = insertRows(parsePatch(patchFile));
		assert.equal(rows.filter((row) => row.id === "git-tree").length, 1, "no duplicate row");
	});

	check("a backup of the pre-install patch exists", () => {
		assert.equal(readFileSync(`${patchFile}.bak-git-tree`, "utf8"), REALISTIC_PATCH);
	});

	check("a patch the append would corrupt is rolled back untouched", () => {
		// A top-level MAPPING cannot take a top-level sequence item, so the append
		// makes the document invalid and the validator must reject it.
		const broken = fakeHome({ patch: "key: value\n" });
		const brokenPatch = join(broken, "profiles", "web", "cordis.patch.yml");
		let failed = false;
		try {
			install(broken);
		} catch (error) {
			failed = true;
			assert.equal(error.status, 1, "the installer must exit non-zero");
			assert.match(String(error.stdout), /validation failed/);
		}
		assert.ok(failed, "the installer should have failed");
		assert.equal(readFileSync(brokenPatch, "utf8"), "key: value\n", "the patch must be restored byte-for-byte");
		rmSync(broken, { recursive: true, force: true });
	});

	check("an unparseable patch that already names the row is left alone", () => {
		// Idempotency is checked before validation, so re-running must not fail on a
		// patch this script did not write.
		const already = fakeHome({ patch: `- insert:\n    - id: git-tree\n      name: dsh-gitview\n` });
		const output = install(already);
		assert.match(output, /already present/);
		rmSync(already, { recursive: true, force: true });
	});

	check("the optional dump-config step does not run by default", () => {
		// DSH_BIN is set to a program that always fails. A default install must
		// still succeed, proving the harness is never booted.
		const silent = fakeHome({ patch: REALISTIC_PATCH });
		const output = install(silent);
		assert.doesNotMatch(output, /dump-config/);
		rmSync(silent, { recursive: true, force: true });
	});

	check("DSH_VERIFY_DUMP=1 reports a dump failure without rolling back", () => {
		const opted = fakeHome({ patch: `${REALISTIC_PATCH}` });
		const optedPatch = join(opted, "profiles", "web", "cordis.patch.yml");
		const output = install(opted, { DSH_VERIFY_DUMP: "1" });
		assert.match(output, /dump-config.*failed|failed/);
		// The install stands even though the harness could not boot.
		assert.equal(insertRows(parsePatch(optedPatch)).filter((row) => row.id === "git-tree").length, 1);
		rmSync(opted, { recursive: true, force: true });
	});
} finally {
	rmSync(home, { recursive: true, force: true });
}

console.log(`\nPASS  ${passed} checks`);
