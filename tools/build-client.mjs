/**
 * Build `lib/client.js` from `src/client/`.
 *
 * The Host serves the browser half verbatim under `/plugins`, wrapped in the
 * shell's `__ModuleLoader__` contract: a factory that receives the shell's
 * `require` and returns the module's exports. esbuild bundles the sources to
 * CommonJS with the two seeded modules left external, and this script puts that
 * body inside the factory. The output stays readable (no minification), because
 * the smoke test reads class names, copy keys and primitive names off it.
 *
 * Run: node tools/build-client.mjs          — write lib/client.js
 *      node tools/build-client.mjs --check  — fail if lib/client.js is stale
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "lib/client.js");

const result = await build({
	entryPoints: [join(root, "src/client/index.ts")],
	bundle: true,
	write: false,
	format: "cjs",
	platform: "browser",
	target: "es2022",
	external: ["react", "@deepseek-ai/dsh-client-ui-primitives"],
	jsx: "transform",
	jsxFactory: "h",
	jsxFragment: "Fragment",
	legalComments: "none",
	charset: "utf8",
	logLevel: "warning"
});

// Not re-indented: that would change the contents of multi-line template literals.
const body = result.outputFiles[0].text.trimEnd();
const output = `/**
 * Browser half of dsh-gitview. GENERATED from src/client/ by tools/build-client.mjs — do not edit.
 *
 * The Host serves this file verbatim under \`/plugins\`; the \`__ModuleLoader__\`
 * wrapper below is the contract. Only seeded platform modules are required
 * (\`react\` and \`@deepseek-ai/dsh-client-ui-primitives\`), so the package needs no
 * \`dsh.client.external\` entry.
 */

window.__ModuleLoader__.load({
	id: "dsh-gitview",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${body}
		Object.defineProperty(module.exports, Symbol.toStringTag, { value: "Module" });
		return module.exports;
	}
});
`;

if (process.argv.includes("--check")) {
	if (readFileSync(target, "utf8") !== output) {
		console.error("lib/client.js is stale: run `npm run build` and commit the result.");
		process.exit(1);
	}
} else {
	writeFileSync(target, output);
}
