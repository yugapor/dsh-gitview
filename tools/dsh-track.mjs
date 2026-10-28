/**
 * Compare the DSH versions npm publishes under its dist-tags (latest, next,
 * alpha) with the versions package.json declares verified in `engines.dsh`.
 *
 * rdsh (jimoto-no-llm/rustdsh) installs this plugin by default and moves DSH
 * forward along those tags, so a tag pointing at an unlisted version is the
 * signal to run `test:package` against it and add it to the list.
 *
 * Run: node tools/dsh-track.mjs   (needs the network; exits 1 when a tag is unlisted)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const declared = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
	.engines.dsh.split("||")
	.map((entry) => entry.trim());
const tags = JSON.parse(execFileSync("npm", ["view", "@deepseek-ai/dsh", "dist-tags", "--json"], { encoding: "utf8" }));

let unlisted = 0;
for (const [tag, version] of Object.entries(tags)) {
	const known = declared.includes(version);
	if (!known) unlisted++;
	console.log(`${tag.padEnd(8)} ${version.padEnd(16)} ${known ? "verified" : "NOT VERIFIED"}`);
}
if (unlisted > 0) {
	console.log("\nVerify each unlisted version with `npm run test:package` (DSH_BIN pointing at it), then add it to engines.dsh and both peerDependencies in package.json.");
	process.exit(1);
}
