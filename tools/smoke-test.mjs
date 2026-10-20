/**
 * Boot-free smoke test for the hand-written client bundle.
 *
 * Loads `lib/client.js` with a stub `window.__ModuleLoader__`, materializes the
 * factory against the modules the shell actually seeds, and drives `apply(ctx)`
 * with a recording fake context. It proves the registration surface (inject
 * list, tab type, guide entry, dictionary, slot body) AND the data channel,
 * without DSH and without a browser.
 *
 * The `inject` assertion is the important one: the slot renderer CALLS the
 * inject value (`inject(...args)`), so it must be a factory. A plain object
 * there throws at first render — the failure mode this test exists to catch.
 *
 * Run: node tools/smoke-test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "lib/client.js"), "utf8");

let passed = 0;
/** Checks run strictly in order: the data-channel checks share one fetch log. */
async function check(name, fn) {
	await fn();
	passed++;
	console.log(`  ok  ${name}`);
}

console.log("smoke-test");

// ── 1. execution-time registration ───────────────────────────────────────────

let registration;
const fetched = [];
/** Scripted responses keyed by URL substring; anything else fails the test. */
let fetchScript = () => ({ ok: true, status: 200, json: async () => ({ kind: "ready", changed: 0 }) });

const sandbox = {
	window: {
		__ModuleLoader__: {
			load(value) {
				registration = value;
			}
		}
	},
	console,
	URLSearchParams,
	AbortController,
	fetch: async (url, init) => {
		fetched.push({ url: String(url), init });
		return fetchScript(String(url));
	}
};
runInContext(source, createContext(sandbox));

await check("the bundle registers itself with the module loader", () => {
	assert.ok(registration, "bundle never called __ModuleLoader__.load");
	assert.equal(registration.id, "dsh-gitview");
	assert.equal(typeof registration.factory, "function");
});

// ── 2. materialization against the seeded module table ───────────────────────

const primitives = {
	Button: () => null,
	PathLabel: () => null,
	StateDot: () => null,
	Tag: () => null,
	GuideArtworkFiles: () => null
};
const react = {
	// Recording, not stubbing to null: the pure renderers return element trees, and
	// asserting on their shape is the only way to check the graph without a DOM.
	// React folds a `children` prop and positional children into one list; the
	// bundle passes labels both ways (`children:` in props, and as an argument).
	createElement: (type, props, ...children) => ({
		type,
		props: props ?? {},
		children: children.length > 0 ? children : props?.children === undefined ? [] : [props.children]
	}),
	useState: () => [undefined, () => {}],
	useEffect: () => {},
	useCallback: (fn) => fn,
	useMemo: (fn) => fn(),
	useRef: (value) => ({ current: value })
};
const require = (spec) => {
	if (spec === "react") return react;
	if (spec === "@deepseek-ai/cordis") return {};
	if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
	throw new Error(`undeclared module request: ${spec}`);
};

const mod = registration.factory(require);

await check("the module exposes apply() and inject[]", () => {
	assert.equal(typeof mod.apply, "function");
	assert.ok(Array.isArray(mod.inject));
	// No Remote face may be injected: an external package cannot publish one.
	assert.deepEqual([...mod.inject], ["slots", "locale", "sidebarRightTabs", "sessions", "conversation"]);
});

// ── 3. apply() against a recording context ──────────────────────────────────

const recorded = { effects: 0, dictionaries: [], types: [], bodies: [], injections: [], withdrawn: [] };
const ctx = {
	effect(fn, label) {
		assert.equal(typeof label, "string", "ctx.effect requires a label");
		recorded.effects++;
		const disposer = fn();
		if (disposer !== undefined) assert.equal(typeof disposer, "function", `${label}: bad disposer`);
		return () => {};
	},
	locale: {
		bind: (ns) => (key) => `${ns}.${key}`,
		register: (ns, dictionaries) => {
			recorded.dictionaries.push({ ns, dictionaries });
			return () => {};
		}
	},
	sidebarRightTabs: {
		register(definition) {
			recorded.types.push(definition);
			return () => recorded.withdrawn.push(`type:${definition.id}`);
		}
	},
	slots: {
		inject(name, register) {
			recorded.injections.push(name);
			return register();
		},
		register(spec, body) {
			recorded.bodies.push({ spec, body });
			return () => recorded.withdrawn.push(spec.name);
		}
	}
};

mod.apply(ctx);

await check("registers one dictionary under the declared namespace", () => {
	assert.equal(recorded.dictionaries.length, 1);
	const [entry] = recorded.dictionaries;
	assert.equal(entry.ns, "gitTree");
	assert.ok(entry.dictionaries.en, "the object form must carry the 'en' dictionary");
	assert.equal(typeof entry.dictionaries.en["guide.title"], "string");
});

await check("registers exactly one tab type, with a guide button", () => {
	assert.equal(recorded.types.length, 1);
	const type = recorded.types[0];
	assert.equal(type.id, "dsh-gitview");
	assert.equal(type.kind, "git-tree");
	assert.equal(type.priority, "extension");
	assert.equal(type.keepMounted, true);
	assert.equal(typeof type.title, "function");
	// A page type: no patterns, so it cannot steal resource opening.
	assert.equal(type.patterns, undefined);
	assert.equal(type.guide.length, 1);
	const entry = type.guide[0];
	assert.equal(typeof entry.order, "number");
	assert.equal(typeof entry.title, "function");
	assert.equal(typeof entry.description, "function");
});

await check("registers the body into the right keyed slot, and injects a FACTORY", () => {
	// By default Git appears in both places, and offers the choice in Settings.
	assert.deepEqual(recorded.injections, ["sidebar.right.pane.tab", "conversation.view", "settings.general.item"]);
	assert.equal(recorded.bodies.length, 3);
	const { spec, body } = recorded.bodies[0];
	assert.equal(spec.name, "sidebar.right.pane.tab");
	assert.equal(spec.key, recorded.types[0].id, "body key must equal the tab type id");
	assert.equal(spec.locale, "gitTree");
	assert.equal(typeof body, "function");
	// The renderer does `inject(...args)`; anything else throws at first render.
	assert.equal(typeof spec.inject, "function", "inject must be a factory, not an object");
});

await check("the conversation view is a second body over the same data channel", () => {
	const { spec, body } = recorded.bodies[1];
	assert.equal(spec.name, "conversation.view");
	assert.equal(spec.id, "git");
	assert.equal(typeof spec.order, "number");
	assert.equal(spec.locale, "gitTree");
	assert.equal(typeof spec.label, "function", "the tab label follows the locale");
	assert.equal(typeof body, "function");
	assert.equal(typeof spec.inject, "function", "inject must be a factory, not an object");
	assert.deepEqual(Object.keys(spec.inject("session-1")).sort(), Object.keys(recorded.bodies[0].spec.inject("session-1")).sort());
});

await check("the placement setting withdraws and restores each surface", () => {
	const { spec } = recorded.bodies[2];
	assert.equal(spec.name, "settings.general.item");
	const { placement } = spec.inject();
	assert.equal(placement.get(), "both");

	placement.set("conversation");
	assert.deepEqual(recorded.withdrawn.splice(0).sort(), ["conversation.view", "sidebar.right.pane.tab", "type:dsh-gitview"], "every surface is withdrawn before the new set registers");
	assert.equal(recorded.bodies.at(-1).spec.name, "conversation.view");
	assert.equal(recorded.types.length, 1, "no sidebar type while only the conversation view is asked for");

	placement.set("sidebar");
	assert.deepEqual(recorded.withdrawn.splice(0), ["conversation.view"]);
	assert.equal(recorded.bodies.at(-1).spec.name, "sidebar.right.pane.tab");
	assert.equal(recorded.types.length, 2);

	placement.set("both");
	recorded.withdrawn.length = 0;
});

await check("the body declares no undeclared props", () => {
	// Every value the component destructures must come from the standard kit, the
	// locale seat, the tab info hook, or the business factory.
	const face = recorded.bodies[0].spec.inject("session-1", undefined);
	assert.deepEqual(
		Object.keys(face).sort(),
		["askAI", "generateMessage", "loadAuth", "loadBlame", "loadBranches", "loadCI", "loadDiff", "loadHistory", "loadReflog", "loadStatus", "mutate"],
		"the injected business share is the whole data channel"
	);
	for (const [name, value] of Object.entries(face)) {
		assert.equal(typeof value, "function", `${name} must be a function`);
	}
});

// ── 4. the data channel ─────────────────────────────────────────────────────

const face = recorded.bodies[0].spec.inject("session-1", undefined);

await check("loadStatus calls the host route and returns the envelope", async () => {
	fetchScript = () => ({
		ok: true,
		status: 200,
		json: async () => ({ kind: "ready", changed: 2, tree: { type: "dir", children: [] } })
	});
	const result = await face.loadStatus("session-1");
	assert.equal(result.ok, true);
	assert.equal(result.value.kind, "ready");
	const last = fetched.at(-1);
	// Document-relative by convention, so a path-prefix mount keeps working.
	assert.match(last.url, /^api\/git\.tree\?/, `unexpected URL: ${last.url}`);
	assert.ok(!last.url.startsWith("/"), `route URL must be document-relative: ${last.url}`);
	assert.ok(
		last.url.endsWith(new URLSearchParams({ sessionId: "session-1" }).toString()),
		`unexpected query: ${last.url}`
	);
});

await check("loadDiff carries the path, percent-encoded", async () => {
	fetchScript = () => ({ ok: true, status: 200, json: async () => ({ kind: "ready", text: "diff" }) });
	await face.loadDiff("session-1", "src/a b.js");
	const last = fetched.at(-1);
	assert.match(last.url, /^api\/git\.diff\?/, `unexpected URL: ${last.url}`);
	assert.ok(
		last.url.endsWith(new URLSearchParams({ sessionId: "session-1", path: "src/a b.js" }).toString()),
		`unexpected query: ${last.url}`
	);
});

await check("loadDiff carries the scope and revision, and drops an empty path", async () => {
	fetchScript = () => ({ ok: true, status: 200, json: async () => ({ kind: "ready", text: "" }) });
	// A whole-commit request names no path at all; the Host reads that as the commit.
	await face.loadDiff("session-1", "", "commit", "deadbee");
	const last = fetched.at(-1);
	assert.match(last.url, /^api\/git\.diff\?/, `unexpected URL: ${last.url}`);
	assert.equal(
		last.url,
		`api/git.diff?${new URLSearchParams({ sessionId: "session-1", scope: "commit", rev: "deadbee" }).toString()}`,
		"an empty path must not be sent"
	);
});

await check("loadHistory, loadBranches and loadReflog call their own routes", async () => {
	fetchScript = () => ({ ok: true, status: 200, json: async () => ({ kind: "ready" }) });
	await face.loadHistory("session-1");
	assert.match(fetched.at(-1).url, /^api\/git\.history\?/);
	await face.loadBranches("session-1");
	assert.match(fetched.at(-1).url, /^api\/git\.branches\?/);
	await face.loadReflog("session-1");
	assert.match(fetched.at(-1).url, /^api\/git\.reflog\?/);
});

await check("mutate POSTs the action, and a refusal keeps the payload's code", async () => {
	fetchScript = () => ({ ok: true, status: 200, json: async () => ({ kind: "ready", action: "stage" }) });
	const accepted = await face.mutate("session-1", { action: "stage", paths: ["a.js"] });
	assert.equal(accepted.ok, true);

	const posted = fetched.at(-1);
	assert.equal(posted.init.method, "POST", "the only write must use POST");
	assert.match(posted.url, /^api\/git\.mutate\?/, `unexpected URL: ${posted.url}`);
	assert.ok(posted.url.endsWith("sessionId=session-1"), "the session id travels in the query");
	assert.equal(posted.init.headers["content-type"], "application/json");
	assert.deepEqual(JSON.parse(posted.init.body), { action: "stage", paths: ["a.js"] });

	// A refused mutation answers 400 with a code the panel translates by name; that
	// code is more useful than the bare status, so it must win.
	fetchScript = () => ({ ok: false, status: 400, json: async () => ({ code: "unknown-action" }) });
	const refused = await face.mutate("session-1", { action: "push --force" });
	assert.equal(refused.ok, false);
	assert.equal(refused.error.code, "unknown-action");
});

await check("a non-2xx answer becomes the error branch, not a rejection", async () => {
	fetchScript = () => ({ ok: false, status: 503, json: async () => ({}) });
	const result = await face.loadStatus("session-1");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "http/503");
});

await check("a transport failure becomes the error branch too", async () => {
	fetchScript = () => {
		throw new Error("network down");
	};
	const result = await face.loadStatus("session-1");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "transport");
	assert.match(result.error.message, /network down/);
});

// ── 5. pure viewing helpers ─────────────────────────────────────────────────

const { flatten, directoryPaths, countsText, stateOf, gitTreeDefinition, sliceTree, GROUPS, laneGutter, query, VIEWS, ROUTES } =
	mod.__internals;

const tree = {
	type: "dir",
	name: "repo",
	path: "",
	children: [
		{
			type: "dir",
			name: "src",
			path: "src",
			counts: { modified: 1 },
			total: 1,
			children: [
				{
					type: "file",
					name: "a.js",
					path: "src/a.js",
					state: "modified",
					index: " ",
					worktree: "M",
					origPath: null
				}
			]
		},
		{
			type: "file",
			name: "README.md",
			path: "README.md",
			state: "untracked",
			index: "?",
			worktree: "?",
			origPath: null
		}
	]
};

await check("flatten walks every level when nothing is collapsed", () => {
	const rows = flatten(tree, new Set(), 0, []);
	assert.deepEqual(
		[...rows.map((row) => `${row.depth}:${row.node.name}:${row.isDir ? "dir" : "file"}`)],
		["0:src:dir", "1:a.js:file", "0:README.md:file"]
	);
});

await check("flatten stops at a collapsed directory", () => {
	const rows = flatten(tree, new Set(["src"]), 0, []);
	assert.deepEqual(
		[...rows.map((row) => row.node.name)],
		["src", "README.md"]
	);
	assert.equal(rows[0].open, false);
});

await check("directoryPaths collects every directory for collapse-all", () => {
	assert.deepEqual([...directoryPaths(tree)], ["src"]);
});

await check("countsText renders a stable per-state summary", () => {
	assert.equal(countsText({ modified: 2, untracked: 1 }), "2M 1?");
	assert.equal(countsText(undefined), "");
});

await check("stateOf maps each git state and degrades safely", () => {
	assert.equal(stateOf("untracked").letter, "?");
	assert.equal(stateOf("conflicted").letter, "U");
	assert.equal(stateOf("renamed").letter, "R");
	assert.equal(stateOf("nonsense").letter, "•");
});

await check("the registered definition is exactly the tested shape", () => {
	const definition = gitTreeDefinition((key) => key);
	assert.equal(definition.guide[0].id, definition.kind);
	assert.equal(definition.guide[0].order, 20);
});

// The section tree the Status view actually draws, and the rule that puts a file in
// it. Both are pure, so the grouping can be pinned without a browser. The fixture
// mirrors the Host's own sort — directories before files — so the walk is checked
// against a tree shaped the way a real one arrives.
const changedTree = {
	type: "dir",
	name: "repo",
	path: "",
	children: [
		{
			type: "dir",
			name: "src",
			path: "src",
			children: [
				{ type: "file", name: "e", path: "src/e", staged: true, unstaged: false, state: "added" },
				// Staged AND unstaged at once: it belongs in BOTH sections.
				{ type: "file", name: "f", path: "src/f", staged: true, unstaged: true, state: "modified" }
			]
		},
		{ type: "file", name: "a", path: "a", staged: true, unstaged: false, state: "modified" },
		{ type: "file", name: "b", path: "b", staged: false, unstaged: true, state: "modified" },
		// A conflicted file is on BOTH sides of the index, which is exactly what git
		// means; it still gets a section of its own.
		{ type: "file", name: "c", path: "c", staged: true, unstaged: true, state: "conflicted" },
		{ type: "file", name: "d", path: "d", staged: false, unstaged: true, state: "untracked" }
	]
};

const sectionTree = (id) => sliceTree(changedTree, GROUPS.find((group) => group.id === id).keep);

// Only the files: `flatten` also yields the rebuilt directories, which the row
// counts further down check separately.
const sectionPaths = (id) => [
	...flatten(sectionTree(id), new Set(), 0, [])
		.filter((row) => !row.isDir)
		.map((row) => row.node.path)
];

await check("the four sections partition a mixed tree by side of the index", () => {
	assert.deepEqual([...GROUPS.map((group) => group.id)], ["conflicted", "staged", "unstaged", "untracked"]);
	assert.deepEqual(sectionPaths("conflicted"), ["c"]);
	// Conflicts are held out of Staged, because git will not commit an unmerged index.
	assert.deepEqual(sectionPaths("staged"), ["src/e", "src/f", "a"]);
	// A file dirty on both sides is in both, which is the deliberate overlap.
	assert.deepEqual(sectionPaths("unstaged"), ["src/f", "b"]);
	// Untracked files are not repeated in Unstaged: every file has one home.
	assert.deepEqual(sectionPaths("untracked"), ["d"]);
});

await check("a section tree rebuilds its directories, recounts them, and keeps the order", () => {
	const staged = sectionTree("staged");
	assert.equal(staged.total, 3, "the section header's number is its own row count");
	// `src` survives because two of its files are staged, and it stays ahead of the
	// root's own files, exactly as the Host sorted them.
	assert.deepEqual([...staged.children.map((child) => child.name)], ["src", "a"]);
	const src = staged.children[0];
	assert.equal(src.total, 2);
	assert.deepEqual({ ...src.counts }, { added: 1, modified: 1 });
	assert.deepEqual([...src.children.map((child) => child.path)], ["src/e", "src/f"]);
	// A section of only root-level files builds no directory at all: the directories
	// are rebuilt from the surviving paths, so none is left behind empty.
	assert.equal(sectionTree("conflicted").total, 1);
	assert.deepEqual([...sectionTree("untracked").children.map((child) => child.name)], ["d"]);
	assert.equal(sectionTree("untracked").children[0].type, "file");
});

await check("slicing copies the rows the tree needs and leaves the source alone", () => {
	const src = sectionTree("staged").children[0];
	const [first, second] = src.children;
	// The copy keeps the fields a row acts on, so a section row stays actionable.
	assert.equal(first.staged, true);
	assert.equal(second.unstaged, true);
	assert.equal(first.state, "added");
	assert.equal(changedTree.children[0].children[0].name, "e", "the source tree is not mutated");
	assert.equal(changedTree.children[0].total, undefined, "no count is written back onto the source");
});

await check("laneGutter spans its row and draws the node, lanes and parents", () => {
	// A merge commit in lane 1, with lane 0 passing through and a parent curving to 0.
	// The slice is positioned against its row rather than given a height, because the
	// row's height belongs to the content — see the render test for why that matters.
	const merge = laneGutter({ column: 1, width: 2, through: [0], ends: [], columns: [0], ahead: true });
	assert.equal(merge.type, "div");
	assert.equal(merge.props.style.position, "absolute", "the slice is positioned against the row");
	assert.equal(merge.props.style.width, 20, "two lanes are 20px wide");
	assert.equal(typeof merge.props.style.top, "number", "anchored to the top edge");
	assert.equal(typeof merge.props.style.bottom, "number", "and to the bottom edge");
	assert.equal(merge.props.style.height, undefined, "a fixed height is what tore the graph");
	assert.equal(merge.props.style.top <= 0 && merge.props.style.bottom <= 0, true, "bleeding past both edges closes the hairline seam");

	const svg = merge.children[0];
	assert.equal(svg.type, "svg");
	assert.equal(svg.props.viewBox, "0 0 20 100", "the vertical axis is a share of the row, not pixels");
	assert.equal(svg.props.preserveAspectRatio, "none", "so the drawing is stretched");
	assert.equal(svg.props.height, "100%", "and it fills the slice");
	assert.deepEqual(
		[...svg.children.map((child) => child.type)],
		["line", "path"],
		"a through lane, then the parent curve"
	);
	assert.equal(svg.children[0].props.x1, 5, "the through lane runs down lane 0");
	assert.equal(svg.children[0].props.y2, 100, "and covers the whole span");
	assert.equal(svg.children[1].props.d.startsWith("M 15 50"), true, "the parent leaves the node in its own lane");
	// The stretch scales stroke width too, which is what a sub-pixel "broken" line is.
	for (const stroke of svg.children) assert.equal(stroke.props.vectorEffect, "non-scaling-stroke");

	// The node is not an SVG circle: stretching one would draw an ellipse.
	const node = merge.children[1];
	assert.equal(node.type, "div");
	assert.equal(node.props.style.borderRadius, "50%", "the node cannot be distorted");
	assert.equal(node.props.style.left, 15, "the node sits in its own lane");
	assert.equal(node.props.style.width, 6.8, "a commit ahead of the base is drawn larger");
	assert.equal(node.props.style.opacity, 1);

	// A root commit closes its lane: one line through, then the node, nothing below.
	const root = laneGutter({ column: 0, width: 1, through: [0], ends: [], columns: [], ahead: false });
	assert.deepEqual([...root.children[0].children.map((child) => child.type)], ["line"]);
	assert.equal(root.children[0].props.viewBox, "0 0 10 100");
	assert.equal(root.children[1].props.style.width, 4.8, "the ordinary node is smaller");
	assert.equal(root.children[1].props.style.opacity, 0.7);

	// A lane merging in from above draws its own path before the node.
	const joined = laneGutter({ column: 0, width: 2, through: [0], ends: [1], columns: [0], ahead: false });
	assert.deepEqual([...joined.children[0].children.map((child) => child.type)], ["line", "path", "path"]);
	assert.equal(joined.children[0].children[1].props.d.startsWith("M 15 0"), true, "the lane closing in starts at the top edge");

	// Called without a width it falls back to the lanes the commit itself needs.
	assert.equal(laneGutter({ column: 1, width: 2, through: [], ends: [], columns: [] }).props.style.width, 20);
	assert.equal(laneGutter({ column: 0, through: [], ends: [], columns: [] }).props.style.width, 10);
});

await check("query drops every parameter the caller left unset", () => {
	assert.equal(query({ sessionId: "s", path: "", scope: undefined, rev: null }), "sessionId=s");
	assert.equal(query({ path: "a b.js" }), "path=a+b.js");
	assert.equal(query({}), "");
});

await check("the view list and route table are the ones the panel uses", () => {
	assert.deepEqual([...VIEWS], ["status", "history", "branches", "blame", "reflog", "ci"]);
	assert.deepEqual(Object.keys(ROUTES).sort(), ["auth", "blame", "branches", "ci", "diff", "history", "message", "mutate", "reflog", "status"]);
	for (const route of Object.values(ROUTES)) {
		assert.ok(!route.startsWith("/"), `routes must be document-relative: ${route}`);
		assert.ok(route.startsWith("api/"), `routes must carry the /api/ prefix: ${route}`);
	}
});

// ── 6. static guards over the whole bundle ──────────────────────────────────

await check("every copy string the panel asks for exists, in both languages", () => {
	const dictionaries = recorded.dictionaries[0].dictionaries;
	assert.deepEqual(
		Object.keys(dictionaries.ja).sort(),
		Object.keys(dictionaries.en).sort(),
		"the two dictionaries must cover exactly the same keys"
	);

	// Keys reached through a template or a table cannot be read off the source, so
	// they are named here; everything else is taken from the literal calls.
	const used = new Set();
	for (const match of source.matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(match[1]);
	for (const id of VIEWS) used.add(`view.${id}`);
	for (const kind of ["rebase", "merge", "cherry-pick", "revert", "am", "bisect"]) used.add(`op.${kind}`);
	for (const scope of ["head", "worktree", "index", "commit"]) used.add(`scope.${scope}`);

	assert.ok(used.size > 40, `expected the whole dictionary to be exercised, saw ${used.size}`);
	for (const key of used) {
		assert.ok(Object.hasOwn(dictionaries.en, key), `missing English copy for "${key}"`);
		assert.ok(Object.hasOwn(dictionaries.ja, key), `missing Japanese copy for "${key}"`);
	}
});

await check("only primitives that shipped bundles really export are used", () => {
	// The primitives module is a seed word the shell provides, so a typo here fails
	// at render rather than at build. Every name below was found in a shipped client
	// bundle under node_modules; adding one to the panel must mean adding it here.
	const used = new Set([...source.matchAll(/primitives\.([A-Za-z0-9_]+)/g)].map((match) => match[1]));
	assert.deepEqual(
		[...used].sort(),
		[
			"Button",
			// The tree's leading glyphs: a folder that opens and closes, and the file's
			// own type, which is what makes a list of paths scannable.
			"FileTypeIcon",
			"IconBranchOutlineRegular",
			// The Commit button's check, as in VS Code.
			"IconCheckOutlineRegular",
			// The settings row's selector chevron, as the shell's own selector rows draw it.
			"IconChevronDownOutlineRegular",
			// The diff layout toggle: one icon for side by side / one column.
			"IconCompareSplitOutlineRegular",
			// The changes list toggles between a flat list and the folder tree.
			"IconFlatListOutlineRegular",
			"IconFolderCloseRegular",
			"IconFolderOpenRegular",
			// The AI commit-message draft, inside the message box.
			"IconSparkleRegular",
			"IconWorkspaceTreeOutlineRegular",
			// The shell's settings selector menu and its segmented tabs (mode, layout, list).
			"Menu",
			"SegmentedControl",
			"Tag",
			"classifyFileType",
			"languageForPath",
			// Turns a commit date into the shell's own "4d"/"2mo" buckets; the words stay
			// in this plugin's dictionary.
			"relativeTime",
			"useCodeHighlighter",
			"writeClipboard"
		]
	);
});

await check("only enum values that shipped bundles really use are passed", () => {
	// Same reasoning as the primitive names: these are string unions the shell maps to
	// classes, so a value nobody uses is SILENTLY unstyled instead of rejected. These
	// sets are the complete vocabulary found across the shipped client bundles.
	const VERIFIED = {
		variant: ["outline", "primary", "ghost", "compact", "preview", "count", "main", "switcher", "embedded", "inline", "block"],
		tone: ["success", "neutral", "warning", "info", "danger"],
		// `dot` is this bundle's own table key; `state` is StateDot's prop.
		dot: ["ongoing", "error", "warning", "idle", "loading", "done", "armed", "pending", "failed", "preparing", "ready", "open"],
		state: ["ongoing", "error", "warning", "idle", "loading", "done", "armed", "pending", "failed", "preparing", "ready", "open"],
		size: ["sm"]
	};
	for (const [prop, allowed] of Object.entries(VERIFIED)) {
		// Reads the first quoted literal after the property, so a ternary such as
		// `variant: active ? "outline" : "ghost"` is checked as well as a plain string.
		const pattern = new RegExp(`\\b${prop}:\\s*[^,}\\n]*?"([^"]+)"`, "g");
		const used = new Set([...source.matchAll(pattern)].map((match) => match[1]));
		if (prop !== "state") assert.ok(used.size > 0, `no ${prop} literal was found at all`);
		for (const value of used) {
			assert.ok(allowed.includes(value), `${prop}:"${value}" is not a value any shipped bundle uses`);
		}
	}
	// The StateDot semantics largely come from one table, so check them through the
	// function that reads it, including the unknown-state fallback.
	for (const name of ["added", "modified", "deleted", "renamed", "copied", "typechange", "conflicted", "untracked", "ignored", "nonsense"]) {
		assert.ok(VERIFIED.state.includes(stateOf(name).dot), `stateOf("${name}").dot is not a real StateDot state`);
	}
});

// ── 3. the stylesheet, and the token vocabulary it is allowed to name ────────

/**
 * Every custom property this panel's stylesheet may name, with where it was verified.
 *
 * An undefined custom property does NOT fail loudly: `var(--x, <fallback>)` silently
 * paints the fallback. This panel shipped for two rounds with a hard-coded grey in
 * place of the theme's hover tint because two names were invented — the panel looked
 * foreign, ignored the light/dark theme, and nothing anywhere reported it. So the
 * names are frozen here and the sheet is checked against them.
 *
 * Verified against the shipped bundles under node_modules (the shells tokens come from
 * the theme package; use counts are from a grep across every `lib/*.js` in the install):
 * text `--dsw-alias-label-primary/-secondary/-tertiary` (20/24/28 uses),
 * `--dsw-alias-interactive-bg-hover` (14, the shell's hover AND selected background),
 * `--dsw-alias-border-l1/-l2/-l3` (5/7/11), surfaces `--dsw-alias-bg-layer-2` (6),
 * `--dsw-alias-link` (2), state `--dsw-alias-state-error-primary` (9),
 * `--dsw-alias-state-success-primary` (2), `--dsw-alias-state-warn-label` (1),
 * radii `--dsw-radius-sm/-md` (83/66), the body size `--dsh-content-font-size-secondary`
 * (48), the font shorthands `--dsw-font-xxs-12` (15) / `--dsw-font-xxxs-11` (5), and the
 * monospace family `--dsw-font-mono` (4, always with the fallback kept here verbatim).
 */
const SHELL_TOKENS = [
	"--dsh-content-font-size-secondary",
	// Verified in ui-trajectory (sticky headers, inspector) and ui-conversation (settings selectors).
	"--dsw-alias-bg-layer-1",
	"--dsw-alias-bg-layer-2",
	"--dsw-alias-bg-module-platform",
	"--dsw-alias-code-diff-added",
	"--dsw-alias-code-diff-deleted",
	"--dsw-alias-border-l1",
	"--dsw-alias-border-l2",
	"--dsw-alias-border-l3",
	"--dsw-alias-interactive-bg-hover",
	"--dsw-alias-label-primary",
	"--dsw-alias-label-secondary",
	"--dsw-alias-label-tertiary",
	"--dsw-alias-link",
	"--dsw-alias-state-error-primary",
	"--dsw-alias-state-success-primary",
	"--dsw-alias-state-warn-label",
	"--dsw-font-mono",
	"--dsw-font-xxs-12",
	"--dsw-font-xxxs-11",
	"--dsw-radius-md",
	"--dsw-radius-sm",
	// Verified in ui-theme/lib/client.js: the theme's light/dark shiki.css.
	"--shiki-token-constant", "--shiki-token-function", "--shiki-token-parameter", "--shiki-token-keyword"
];

/** The sheet itself, pulled out of the bundle the way the browser receives it. */
const SHEET = /(?:const|var) CSS = `([\s\S]*?)`;/.exec(source)[1];

await check("the stylesheet names only custom properties the shell really defines", () => {
	const named = new Set([...source.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]));
	assert.ok(named.size > 0, "the sheet uses no tokens at all, which cannot be right");
	for (const name of named) {
		assert.ok(SHELL_TOKENS.includes(name), `${name} is not a token any shipped bundle uses`);
	}
	// And nothing may define its own colour as a fallback: that is exactly how an
	// undefined token hides, and it is what made the panel ignore the theme.
	const fallbacks = [...SHEET.matchAll(/var\(--[a-z0-9-]+,\s*(rgba?\(|#)/g)].map((match) => match[0]);
	assert.deepEqual(fallbacks, [], "a colour literal fallback hides a missing token");
});

await check("every class the panel sets exists in the stylesheet, and vice versa", () => {
	const declared = new Set([...SHEET.matchAll(/\.(gt_[A-Za-z0-9_]+)/g)].map((match) => match[1]));
	// Built at render time from the state table, so they never appear as literals.
	const dynamic = ["success", "warning", "danger", "info", "neutral"].map((tone) => `gt_${tone}`);
	// A `className` may carry several classes, so the whole literal is split rather
	// than matched as one name.
	const referenced = new Set(
		[...source.matchAll(/"([^"]*)"/g)]
			.flatMap((match) => match[1].split(/\s+/))
			.filter((name) => name.startsWith("gt_"))
	);

	for (const name of referenced) {
		assert.ok(declared.has(name), `"${name}" is set in the bundle but never styled`);
	}
	for (const name of dynamic) {
		assert.ok(declared.has(name), `stateOf() can produce "${name}", which is never styled`);
	}
	// A rule nothing can apply is dead weight, and usually a rename that missed a spot.
	for (const name of declared) {
		assert.ok(
			referenced.has(name) || dynamic.includes(name),
			`.${name} is styled but no longer set anywhere`
		);
	}
});

await check("the stylesheet reaches the document once, marked as this plugin's", () => {
	// The main sandbox above has no DOM on purpose. This one has just enough of one, and
	// the factory is materialized twice so the marker's job — finding the existing tag
	// instead of adding a second copy — is exercised.
	const tags = [];
	const fakeDocument = {
		head: {
			appendChild(tag) {
				tags.push(tag);
			}
		},
		createElement: () => ({ dataset: {}, textContent: "" }),
		querySelector: (selector) => (tags.length > 0 && selector.includes("dsh-gitview/panel.css") ? tags[0] : null)
	};
	let loaded;
	const boot = () => {
		runInContext(
			source,
			createContext({
				window: {
					__ModuleLoader__: {
						load(value) {
							loaded = value;
						}
					}
				},
				document: fakeDocument,
				console,
				URLSearchParams,
				AbortController
			})
		);
		// The sheet is injected while the factory runs, not while it is registered.
		loaded.factory(() => ({ createElement: () => null }));
	};
	boot();
	tags[0].textContent = "old styles from before hot reload";
	boot();

	assert.equal(tags.length, 1, "a second load must find the marker, not add a copy");
	assert.equal(tags[0].dataset.plugin, "dsh-gitview");
	assert.equal(tags[0].dataset.pluginCss, "dsh-gitview/panel.css");
	assert.equal(tags[0].textContent, SHEET, "the tag carries the sheet verbatim");
	assert.equal(tags[0].textContent.includes(".gt_row:hover"), true, "hover lives in the sheet, not inline");
});

await check("CI and authentication reads carry only a session and selected remote, never a credential", async () => {
	fetchScript = () => ({ ok: true, status: 200, json: async () => ({ kind: "ready" }) });
	await face.loadCI("session-1", "upstream"); await face.loadAuth("session-1", "upstream");
	for (const [request, route] of [[fetched.at(-2), "ci"], [fetched.at(-1), "auth"]]) {
		assert.equal(request.url, `api/git.${route}?sessionId=session-1&remote=upstream`);
		assert.equal(request.init.body, undefined); assert.equal(request.init.headers.Authorization, undefined);
	}
});
await check("Ask AI appends revision-guarded text to the exact session without replacing drafts or submitting", () => {
	let focused = 0;
	const draft = { phase: "plain", draft: "Existing draft with @reference", draftRev: 7, occurrences: [{ offset: 20, length: 10 }] };
	const inserted = [];
	const scoped = { bail: (event, request) => { inserted.push({ event, request }); return true; } };
	ctx.sessions = { scope: (id) => { assert.equal(id, "session-1"); return scoped; } };
	ctx.conversation = { input: { for: (actx) => { assert.equal(actx, scoped); return { state: { getSnapshot: () => draft }, focus: () => { focused++; } }; } } };
	const before = fetched.length;
	assert.equal(face.askAI("session-1", "CI context"), true);
	assert.equal(focused, 1); assert.equal(fetched.length, before);
	assert.equal(inserted[0].event, "slash/input-insert-text");
	assert.equal(inserted[0].request.text, "\n\nCI context");
	assert.deepEqual(JSON.parse(JSON.stringify(inserted[0].request.span)), { start: draft.draft.length - 9, end: draft.draft.length - 9, draftRev: 7 });
	assert.equal(draft.draft, "Existing draft with @reference");
});
await check("Ask AI refuses unavailable sessions, busy drafts and rejected revision guards", () => {
	ctx.sessions = { scope: () => undefined }; assert.equal(face.askAI("missing", "context"), false);
	let phase = "submitting", attempts = 0;
	ctx.sessions = { scope: () => ({ bail: () => { attempts++; return undefined; } }) };
	ctx.conversation = { input: { for: () => ({ state: { getSnapshot: () => ({ phase, draft: "", draftRev: 1 }) }, focus: () => assert.fail("a rejected insertion must not focus") }) } };
	assert.equal(face.askAI("session-1", "context"), false); assert.equal(attempts, 0);
	phase = "plain";
	assert.equal(face.askAI("session-1", "context"), false); assert.equal(attempts, 1);
});
console.log(`\nPASS  ${passed} checks`);
