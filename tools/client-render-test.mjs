/**
 * Render test for the browser half.
 *
 * The smoke test proves the registration surface and the data channel but never
 * RUNS the panel. This one does: `lib/client.js` is materialized against a
 * recording `react` and a scripted `fetch`, and the tab body is driven by a
 * ~70-line hook runtime — enough of React to call a function component, settle
 * its effects, and observe what it drew.
 *
 * What this catches that a static check cannot:
 *
 *  - a hook called conditionally — the runtime records how many hooks each render
 *    consumed, and a count that changes between renders is exactly that bug;
 *  - a prop the container passes under one name and the view reads under another
 *    (the failure mode that made an earlier draft of this panel throw on render);
 *  - a handler wired to the wrong mutation, or a disabled state that is not;
 *  - a view that fetches when it is not on screen, or refetches when it should
 *    adopt the status a mutation already returned.
 *
 * Deliberately NOT covered: styling, and whether the shell's real `slots` runtime
 * spreads the injected share the way this harness does. Those need a browser.
 *
 * Run: node tools/client-render-test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { assignLanes } from "../lib/git.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "lib/client.js"), "utf8");

let passed = 0;
async function check(name, fn) {
	await fn();
	passed++;
	console.log(`  ok  ${name}`);
}

console.log("client-render-test");

//#region the hook runtime

/** Shallow dependency comparison, the same rule React applies. */
const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** The hooks object the module's `react` binding delegates to while rendering. */
let active = null;

/**
 * Drive one function component.
 *
 * Slots are addressed by call index, so a hook that appears on some renders and
 * not others breaks the correspondence — which is why `counts` is asserted on.
 * `settle()` renders until nothing changes, running queued effects and letting
 * the promises they start resolve between rounds.
 *
 * @param component - the function component under test.
 * @param props - fixed props for every render.
 */
function createDriver(component, props, onRender) {
	const slots = [];
	const pending = [];
	const counts = [];
	let cursor = 0;
	let changed = false;
	let tree = null;

	const hooks = {
		useRef(initial) { return hooks.useMemo(() => ({ current: initial }), []); },
		useState(initial) {
			const index = cursor++;
			if (slots[index] === undefined) slots[index] = { value: typeof initial === "function" ? initial() : initial };
			const slot = slots[index];
			return [
				slot.value,
				(next) => {
					const value = typeof next === "function" ? next(slot.value) : next;
					if (Object.is(value, slot.value)) return;
					slot.value = value;
					changed = true;
				}
			];
		},
		useEffect(fn, deps) {
			const index = cursor++;
			const slot = slots[index];
			if (slot !== undefined && sameDeps(slot.deps, deps)) return;
			const next = { deps };
			slots[index] = next;
			pending.push(() => { slot?.cleanup?.(); next.cleanup = fn(); });
		},
		useCallback(fn, deps) {
			const index = cursor++;
			const slot = slots[index];
			if (slot !== undefined && sameDeps(slot.deps, deps)) return slot.fn;
			slots[index] = { fn, deps };
			return fn;
		},
		useMemo(fn, deps) {
			const index = cursor++;
			const slot = slots[index];
			if (slot !== undefined && sameDeps(slot.deps, deps)) return slot.value;
			const value = fn();
			slots[index] = { value, deps };
			return value;
		}
	};

	const settle = async () => {
		for (let round = 0; round < 40; round++) {
			cursor = 0;
			changed = false;
			active = hooks;
			tree = component(props);
			counts.push(cursor);
			// Every pass is rendered, not just the settled one: React commits the tree
			// BEFORE running effects, so a view that derefs a resource still in its idle
			// state throws on exactly that pass.
			if (onRender !== undefined) onRender(tree);
			for (const fn of pending.splice(0)) fn();
			// Effects start promises; let every chained `.then` run to completion.
			for (let tick = 0; tick < 10; tick++) await Promise.resolve();
			await new Promise((resolve) => setTimeout(resolve, 0));
			if (!changed) return tree;
		}
		throw new Error("the component never settled");
	};

	return {
		settle,
		counts,
		unmount() { for (const slot of slots) slot?.cleanup?.(); },
		get tree() {
			return tree;
		}
	};
}

//#endregion

//#region element helpers

/** Flatten an element tree into a list, descending through arrays and children. */
function collect(node, out = []) {
	if (node === null || node === undefined || typeof node === "boolean") return out;
	if (Array.isArray(node)) {
		for (const child of node) collect(child, out);
		return out;
	}
	if (typeof node !== "object") return out;
	out.push(node);
	for (const child of node.children ?? []) collect(child, out);
	return out;
}

/** All rendered text under a node. */
function text(node) {
	if (node === null || node === undefined || typeof node === "boolean") return "";
	if (Array.isArray(node)) return node.map(text).join("");
	if (typeof node === "string" || typeof node === "number") return String(node);
	return (node.children ?? []).map(text).join("");
}

/** Elements of a named primitive. */
const primitivesNamed = (tree, name) => collect(tree).filter((element) => element.type?.displayName === name);

/** A primitive button by its exact label. */
const button = (tree, label) => primitivesNamed(tree, "Button").find((element) => (element.props["aria-label"] ?? text(element)) === label);

/**
 * Render function components the way React does.
 *
 * The container returns `h(StatusView, …)` — an ELEMENT, not output. Asserting on
 * the container alone therefore never runs a view, which is how a view that derefs
 * an idle resource slips through. This descends into every component while leaving
 * the primitives alone (their markers carry a `displayName`, which is also what the
 * lookups use to find them).
 */
function renderDeep(element) {
	if (element === null || element === undefined || typeof element === "boolean") return element;
	if (Array.isArray(element)) return element.map(renderDeep);
	if (typeof element !== "object") return element;
	const { type, props, children } = element;
	if (typeof type === "function" && type.displayName === undefined) return renderDeep(type(props));
	return { ...element, children: children.map(renderDeep) };
}

/** Text rendered by the patch surface, including highlighted source tokens. */
const patchText = (tree) => collect(renderDeep(tree)).filter((element) => element.props.className === "gt_patch").map(text).join("");

/** Any element whose tooltip starts with the given path, i.e. a file or dir row. */
const row = (tree, path) => collect(tree).find((element) => element.props?.title === path || element.props?.title?.startsWith(`${path}\n`));

//#endregion

//#region materializing the bundle

let registration;
const requests = [];
let responses = {};
const timers = new Map();
let now = 0, nextTimer = 0;
const visibilityListeners = new Set();
const focusListeners = { focus: new Set(), blur: new Set() };
let focused = true;
const resizeObservers = new Set();
const savedPreferences = new Map();
const fakeDocument = {
	visibilityState: "visible",
	hasFocus: () => focused,
	addEventListener: (name, fn) => { assert.equal(name, "visibilitychange"); visibilityListeners.add(fn); },
	removeEventListener: (name, fn) => { assert.equal(name, "visibilitychange"); visibilityListeners.delete(fn); }
};

const sandbox = {
	window: {
		localStorage: { getItem: (key) => savedPreferences.get(key), setItem: (key, value) => savedPreferences.set(key, value) },
		addEventListener: (name, fn) => focusListeners[name].add(fn),
		removeEventListener: (name, fn) => focusListeners[name].delete(fn),
		__ModuleLoader__: {
			load(value) {
				registration = value;
			}
		}
	},
	console,
	ResizeObserver: class {
		constructor(callback) { this.callback = callback; }
		observe(target) { this.target = target; resizeObservers.add(this); this.callback([{ contentRect: { width: target.width } }]); }
		disconnect() { resizeObservers.delete(this); }
	},
	URLSearchParams,
	AbortController,
	AbortSignal,
	document: fakeDocument,
	setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, due: now + delay }); return id; },
	clearTimeout: (id) => timers.delete(id),
	fetch: async (url, init) => {
		const key = `${init?.method ?? "GET"} ${String(url).split("?")[0]}`;
		const request = {
			key,
			url: String(url),
			init,
			body: init?.body === undefined || init.body === null ? null : JSON.parse(init.body)
		};
		requests.push(request);
		const respond = responses[key];
		if (respond === undefined) throw new Error(`no scripted response for ${key}`);
		return respond(request);
	}
};
runInContext(source, createContext(sandbox));

const react = {
	Fragment: "fragment",
	// React folds a `children` prop and positional children into one list; the
	// bundle passes labels both ways (`children:` in props, and as an argument).
	createElement: (type, props, ...children) => ({
		type,
		props: props ?? {},
		children: children.length > 0 ? children : props?.children === undefined ? [] : [props.children]
	}),
	useState: (...args) => active.useState(...args),
	useRef: (...args) => active.useRef(...args),
	useEffect: (...args) => active.useEffect(...args),
	useCallback: (...args) => active.useCallback(...args),
	useMemo: (...args) => active.useMemo(...args)
};
/** Primitives are markers: the tests only need their identity and their label. */
const marker = (name) => {
	const built = () => null;
	built.displayName = name;
	return built;
};
const highlights = [];
const primitives = {
	Button: marker("Button"),
	Tag: marker("Tag"),
	StateDot: marker("StateDot"),
	IconBranchOutlineRegular: marker("IconBranchOutlineRegular"),
	FileTypeIcon: marker("FileTypeIcon"),
	IconFolderOpenRegular: marker("IconFolderOpenRegular"),
	IconFolderCloseRegular: marker("IconFolderCloseRegular"),
	languageForPath: (path) => path.endsWith(".js") ? "javascript" : undefined,
	useCodeHighlighter: (language) => (code) => {
		highlights.push({ language, code });
		return language === undefined ? undefined : code.split("\n").map((line) => [{ text: line, style: { color: "var(--shiki-token-keyword)" } }]);
	},
	writeClipboard: async () => true,
	// Real functions, not markers: the panel calls these rather than rendering them.
	classifyFileType: (path) => (/\.[A-Za-z0-9]+$/.test(path) ? "code" : "other"),
	relativeTime: (at, now) => {
		const minutes = Math.floor(Math.max(0, now - at) / 60000);
		if (minutes < 1) return { unit: "now", n: 0 };
		if (minutes < 60) return { unit: "minutes", n: minutes };
		return { unit: "hours", n: Math.floor(minutes / 60) };
	}
};
const require = (spec) => {
	if (spec === "react") return react;
	if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
	throw new Error(`undeclared module request: ${spec}`);
};

const mod = registration.factory(require);
const internals = mod.__internals;

// Register through a recording context, mostly to capture the real dictionary: the
// tests substitute real English copy, which exercises the `{n}` placeholders too.
let dictionary = null;
let registeredSpec = null;
mod.apply({
	effect: (fn) => {
		fn();
		return () => {};
	},
	locale: {
		bind: () => (key) => key,
		register: (name, dictionaries) => {
			dictionary = dictionaries.en;
			return () => {};
		}
	},
	sidebarRightTabs: { register: () => () => {} },
	slots: {
		inject: (name, register) => register(),
		register: (spec) => {
			registeredSpec = spec;
			return () => {};
		}
	}
});
const t = (key) => dictionary[key] ?? key;
const business = registeredSpec.inject();

//#endregion

//#region fixtures

const STATUS = {
	kind: "ready",
	repoRoot: "/repo",
	branch: "main",
	upstream: null,
	ahead: 0,
	behind: 0,
	detached: false,
	unborn: false,
	head: "abc1234",
	state: { kind: null, branch: null, onto: null, commit: null, step: null, total: null },
	base: { name: "main", ahead: 0, behind: 0 },
	identity: {
		config: { name: { kind: "set", value: "Fixture", scope: "local", origin: "file:.git/config" }, email: { kind: "set", value: "fixture@example.test", scope: "global", origin: "file:/home/fixture/.gitconfig" } },
		author: { kind: "ready", name: "Fixture", email: "fixture@example.test" },
		committer: { kind: "ready", name: "Fixture", email: "fixture@example.test" }
	},
	changed: 3,
	truncated: false,
	tree: {
		type: "dir",
		name: "repo",
		path: "",
		total: 3,
		counts: { added: 1, modified: 1, untracked: 1 },
		children: [
			{
				type: "dir",
				name: "src",
				path: "src",
				total: 1,
				counts: { modified: 1 },
				children: [
					{
						type: "file",
						name: "a.js",
						path: "src/a.js",
						state: "modified",
						index: " ",
						worktree: "M",
						staged: false,
						unstaged: true,
						origPath: null
					}
				]
			},
			{
				type: "file",
				name: "note.md",
				path: "note.md",
				state: "untracked",
				index: "?",
				worktree: "?",
				staged: false,
				unstaged: true,
				origPath: null
			},
			{
				type: "file",
				name: "staged.txt",
				path: "staged.txt",
				state: "added",
				index: "A",
				worktree: " ",
				staged: true,
				unstaged: false,
				origPath: null
			}
		]
	}
};

const HISTORY = {
	kind: "ready",
	repoRoot: "/repo",
	base: { name: "main", ahead: 2, behind: 0 },
	total: 3,
	truncated: false,
	commits: [
		{
			sha: "aaaa1111111111111111111111111111111111111",
			short: "aaaa111",
			parents: ["bbbb222"],
			author: "Ann",
			email: "ann@example.com",
			date: "2026-01-02T03:04:05+09:00",
			refs: [{ kind: "head", name: "main" }],
			subject: "feat: newest",
			column: 0,
			width: 1,
			incoming: false,
			through: [],
			ends: [],
			starts: [],
			columns: [0],
			ahead: true
		},
		{
			sha: "bbbb2222222222222222222222222222222222222",
			short: "bbbb222",
			parents: ["cccc333"],
			author: "Bob",
			email: "bob@example.com",
			date: "2026-01-01T03:04:05+09:00",
			refs: [],
			subject: "fix: middle",
			// A merge: the node is in lane 1 and a parent curves away to lane 0.
			column: 1,
			width: 2,
			incoming: true,
			through: [0],
			ends: [],
			starts: [1],
			columns: [0],
			ahead: true
		},
		{
			sha: "cccc3333333333333333333333333333333333333",
			short: "cccc333",
			parents: [],
			author: "Ann",
			email: "ann@example.com",
			date: "2025-12-31T03:04:05+09:00",
			refs: [{ kind: "other", name: "origin/main" }],
			subject: "chore: root",
			column: 0,
			width: 1,
			incoming: true,
			through: [],
			ends: [],
			starts: [],
			columns: [],
			ahead: false
		}
	]
};

const BRANCHES = {
	kind: "ready",
	repoRoot: "/repo",
	state: { kind: null, branch: null, onto: null, commit: null, step: null, total: null },
	truncated: false,
	branches: [
		{
			name: "main",
			short: "aaaa111",
			current: true,
			remote: false,
			upstream: "origin/main",
			ahead: 1,
			behind: 2,
			gone: false,
			date: "2026-01-02T03:04:05+09:00",
			subject: "feat: newest"
		},
		{
			name: "origin/main",
			short: "cccc333",
			current: false,
			remote: true,
			upstream: null,
			ahead: 0,
			behind: 0,
			gone: false,
			date: "2025-12-31T03:04:05+09:00",
			subject: "chore: root"
		}
	]
};

const REFLOG = {
	kind: "ready",
	repoRoot: "/repo",
	truncated: false,
	entries: [
		{
			short: "aaaa111",
			selector: "HEAD@{0}",
			date: "2026-01-02T03:04:05+09:00",
			index: 0,
			action: "rebase (finish)",
			subject: "rebase (finish): returning to refs/heads/main"
		},
		{
			short: "cccc333",
			selector: "HEAD@{1}",
			date: "2025-12-31T03:04:05+09:00",
			index: 1,
			action: "commit",
			subject: "commit: chore: root"
		}
	]
};

const DIFF = { kind: "ready", path: "src/a.js", scope: "head", text: "diff --git a/src/a.js\n+one\n", truncated: false };

const reply = (value, status = 200) => () => ({ ok: status < 400, status, json: async () => value });

/** A status payload whose tree holds only the given files. */
const statusWith = (children, changed) => ({
	...STATUS,
	changed,
	tree: { ...STATUS.tree, total: changed, children }
});

/** A directory with one staged file and one unstaged file, for the sections. */
const TWO_SIDES = statusWith(
	[
		{
			type: "dir",
			name: "src",
			path: "src",
			total: 2,
			counts: { modified: 2 },
			children: [
				{ type: "file", name: "a.js", path: "src/a.js", state: "modified", index: "M", worktree: " ", staged: true, unstaged: false, origPath: null },
				{ type: "file", name: "b.js", path: "src/b.js", state: "modified", index: " ", worktree: "M", staged: false, unstaged: true, origPath: null }
			]
		}
	],
	2
);

/** One file dirty on both sides of the index, which git allows. */
const BOTH_SIDES = statusWith(
	[
		{ type: "file", name: "x.txt", path: "x.txt", state: "modified", index: "M", worktree: "M", staged: true, unstaged: true, origPath: null }
	],
	1
);

const BLAME = {
	kind: "ready",
	repoRoot: "/repo",
	path: "src/a.js",
	rev: "HEAD",
	commits: 2,
	authors: ["Ann", "Not Committed Yet"],
	newest: "2026-01-01T00:04:05.000Z",
	lines: [
		{
			sha: "a".repeat(40),
			short: "aaaaaaa",
			author: "Ann",
			date: "2026-01-01T00:04:05.000Z",
			summary: "feat: one",
			uncommitted: false,
			text: "const a = 1;"
		},
		{
			sha: "0".repeat(40),
			short: "0000000",
			author: "Not Committed Yet",
			date: "2026-01-01T00:04:05.000Z",
			summary: "Version of a.js from a.js",
			uncommitted: true,
			text: "let b = 2;"
		}
	],
	truncated: false
};

const ONLY_STAGED = statusWith(
	[STATUS.tree.children[2]],
	1
);

/** Mount the tab body with scripted routes. */
let mountedApp;
function mount(options = {}) {
	mountedApp?.driver.unmount();
	timers.clear(); now = 0; fakeDocument.visibilityState = "visible"; focused = true;
	requests.length = 0;
	const status = options.status ?? STATUS;
	responses = {
		"GET api/git.tree": options.onStatus ?? reply(status),
		"GET api/git.history": reply(options.history ?? HISTORY),
		"GET api/git.branches": reply(options.branches ?? BRANCHES),
		"GET api/git.reflog": reply(options.reflog ?? REFLOG),
		"GET api/git.diff": options.onDiff ?? reply(options.diff ?? DIFF),
		"GET api/git.blame": reply(options.blame ?? BLAME),
		"GET api/git.ci": options.onCI ?? reply(options.ci ?? { kind: "ready", remote: "origin", remotes: ["origin", "upstream"], provider: "github", host: "github.com", repository: "owner/repo", sha: "a".repeat(40), state: "failure", partial: false, checks: [{ name: "test", state: "failure", group: "Checks", url: "https://github.com/owner/repo/actions/runs/1" }] }),
		"GET api/git.auth": options.onAuth ?? reply(options.auth ?? { kind: "ready", login: "Fixture", source: "keyring", scopes: "repo", access: "ci-readable" }),
		"POST api/git.message": options.onGenerate ?? reply({ kind: "ready", message: "Add the staged file", model: { provider: "fixture", model: "selected" } }),
		"POST api/git.mutate": (request) =>
			reply(
				options.onMutate === undefined
					? { kind: "ready", action: request.body.action, status: options.mutated ?? ONLY_STAGED }
					: options.onMutate(request.body)
			)()
	};

	let boundCommands = null;
	let cwd = "cwd" in options ? options.cwd : "/repo";
	// A stable tab object, so the bindCommands effect has stable dependencies.
	const tab = {
		signal: options.signal,
		visible: options.tabVisible ?? true,
		actions: {
			bindCommands(commands) {
				boundCommands = commands;
				return () => {};
			}
		}
	};

	const props = {
		useTabInfo: () => ({ tab }),
		sessionId: "session-1",
		useSessions: (selector) => selector({ byId: { [props.sessionId]: { cwd } } }),
		t,
		...business,
		askAI: options.askAI ?? (() => true)
	};
	const driver = createDriver(
		internals.GitTreeBody,
		props,
		// Deep-render each pass, as the real renderer would.
		(tree) => {
			const pane = collect(tree).find((node) => node.props.className === "gt_pane");
			if (pane?.props.ref) pane.props.ref.current = { width: options.paneWidth ?? 340 };
			renderDeep(tree);
		}
	);

	mountedApp = {
		driver,
		async switchSession(id) { props.sessionId = id; return this.settle(); },
		async switchCwd(path) { cwd = path; return this.settle(); },
		async resize(width) { for (const observer of resizeObservers) observer.callback([{ contentRect: { width } }]); return this.settle(); },
		async advance(ms) {
			now += ms;
			for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.fn(); }
			return this.settle();
		},
		async visibility(state) {
			fakeDocument.visibilityState = state;
			for (const fn of visibilityListeners) fn();
			return this.settle();
		},
		async focus(value) {
			focused = value;
			for (const fn of focusListeners[value ? "focus" : "blur"]) fn();
			return this.settle();
		},
		async tabVisibility(value) { tab.visible = value; return this.settle(); },
		get commands() {
			return boundCommands;
		},
		async settle() {
			await driver.settle();
			// Deep-rendered, so every view actually runs.
			return renderDeep(driver.tree);
		},
		/** The fully rendered panel: container, active view and detail pane. */
		get deep() {
			return renderDeep(driver.tree);
		},
		/** Click a button by label inside the given tree. */
		async click(tree, label) {
			const found = button(tree, label);
			assert.ok(found, `no button labelled "${label}"`);
			found.props.onClick({ stopPropagation() {} });
			return this.settle();
		},
		/** The recorded requests, for asserting what travelled on the wire. */
		get requests() {
			return requests;
		},
		/** The URLs requested so far, as `METHOD path` keys. */
		get keys() {
			return requests.map((request) => request.key);
		}
	};
	return mountedApp;
}

//#endregion

//#region the tab body

await check("the panel reads the status as soon as a workspace is known", async () => {
	const app = mount();
	const tree = await app.settle();
	assert.deepEqual(app.keys, ["GET api/git.tree", "GET api/git.ci"], "status and the header CI badge fetch immediately");
	assert.equal(text(tree).includes("main"), true, "the branch must be shown");
	assert.equal(text(tree).includes("/repo"), true);
});

await check("a repository with nothing changed says so instead of drawing an empty list", async () => {
	const app = mount({ status: { ...STATUS, changed: 0, tree: { ...STATUS.tree, children: [], counts: {}, total: 0 } } });
	const tree = await app.settle();
	const view = app.deep;
	assert.equal(text(view).includes("Working tree clean."), true, `saw: ${text(view)}`);
});

await check("the container draws the six view tabs from the dictionary", async () => {
	const app = mount();
	const tree = await app.settle();
	for (const label of ["Changes", "History", "Branches", "Blame", "Reflog", "CI"]) {
		assert.ok(button(tree, label), `no "${label}" tab`);
	}
});

/**
 * The section container whose heading is the given label.
 *
 * Find the heading first, then its direct section container.
 */
const section = (tree, label) => {
	const heading = collect(tree).find(
		(element) =>
			element.props.className === "gt_section" &&
			(element.children ?? []).some((child) => text(child) === label)
	);
	if (heading === undefined) return undefined;
	return collect(tree).find((element) => (element.children ?? []).includes(heading));
};

await check("the status view groups the changes into the sections the index defines", async () => {
	const app = mount();
	await app.settle();
	const view = app.deep;
	const inSection = (label, path) => {
		const found = section(view, label);
		assert.ok(found, `no "${label}" section`);
		return row(found, path) !== undefined;
	};

	assert.equal(inSection("Unstaged", "src/a.js"), true, "a worktree edit belongs to Unstaged");
	assert.equal(inSection("Staged", "staged.txt"), true, "an index-only change belongs to Staged");
	assert.equal(inSection("Unstaged", "staged.txt"), false, "and not to Unstaged");
	assert.equal(inSection("Untracked", "note.md"), true, "an untracked file gets its own section");
	assert.equal(inSection("Unstaged", "note.md"), false, "rather than being counted as unstaged");
	// Each heading counts its own rows, not the repository's total.
	assert.equal(text(section(view, "Staged").children[0]), "Staged1");
	assert.equal(text(section(view, "Unstaged").children[0]), "Unstaged1");
	assert.equal(text(section(view, "Untracked").children[0]), "Untracked1");
	// A section with nothing in it is not drawn at all.
	assert.equal(section(view, "Conflicts"), undefined);
});

await check("a file dirty on both sides is offered in both sections with its own action", async () => {
	const app = mount({ status: BOTH_SIDES });
	const view = await app.settle();
	const staged = section(view, "Staged");
	const unstaged = section(view, "Unstaged");

	assert.equal(row(staged, "x.txt") !== undefined, true);
	assert.equal(row(unstaged, "x.txt") !== undefined, true);
	// Each side offers the action that applies to it, and only that one.
	assert.ok(button(staged, "Unstage"), "the staged half can be unstaged");
	assert.equal(button(staged, "Stage"), undefined, "and must not offer Stage");
	assert.ok(button(unstaged, "Stage"), "the worktree half can be staged");
	assert.equal(button(unstaged, "Unstage"), undefined, "and must not offer Unstage");
});

await check("collapsing a directory in one section leaves the other section alone", async () => {
	// The same path ("src") appears in two sections; the collapse key is namespaced
	// per section, so closing it in one must not hide the other's rows.
	const app = mount({ status: TWO_SIDES });
	let view = await app.settle();
	const dir = row(section(view, "Staged"), "src");
	assert.ok(dir, "the staged section should show its src directory");

	dir.props.onClick();
	view = await app.settle();
	assert.equal(row(section(view, "Staged"), "src/a.js"), undefined, "the clicked section collapses");
	assert.equal(row(section(view, "Unstaged"), "src/b.js") !== undefined, true, "the other section must stay open");
});

await check("collapse all covers every section at once", async () => {
	const app = mount({ status: TWO_SIDES });
	let view = await app.settle();
	view = await app.click(view, "Collapse all");
	assert.equal(row(section(view, "Staged"), "src/a.js"), undefined);
	assert.equal(row(section(view, "Unstaged"), "src/b.js"), undefined);
	view = await app.click(view, "Expand all");
	assert.equal(row(section(view, "Staged"), "src/a.js") !== undefined, true);
});

await check("the hook order is identical on every render", async () => {
	const app = mount();
	await app.settle();
	assert.ok(app.driver.counts.length >= 2, "the panel should have settled over more than one render");
	assert.equal(new Set(app.driver.counts).size, 1, `hook count changed between renders: ${app.driver.counts.join(", ")}`);
	assert.ok(app.driver.counts[0] > 20, `expected the panel's hooks, saw ${app.driver.counts[0]}`);
});

await check("the refresh command is bound for the sidebar's own chrome", async () => {
	const app = mount();
	await app.settle();
	assert.equal(typeof app.commands?.refresh, "function");
});

await check("the status view lists the tree and offers each file the action it needs", async () => {
	const app = mount();
	await app.settle();
	const view = app.deep;
	const flat = text(view);

	assert.equal(flat.includes("src"), true, "the directory row");
	assert.equal(flat.includes("a.js"), true);
	assert.equal(flat.includes("staged.txt"), true);
	assert.equal(flat.includes("3 changed"), true, `saw: ${flat}`);
	assert.equal(flat.includes("1 staged"), true, "the staged count must be derived from the one tree");

	// An unstaged file offers Stage; a staged file offers Unstage.
	const unstaged = row(view, "src/a.js");
	assert.equal(button(unstaged, "Stage") !== undefined, true, "an unstaged file needs Stage");
	assert.equal(button(unstaged, "Unstage"), undefined, "an unstaged file needs no Unstage");
	const staged = row(view, "staged.txt");
	assert.equal(button(staged, "Unstage") !== undefined, true);
	assert.equal(button(staged, "Stage"), undefined);
});

await check("an untracked file and a staged file read differently", async () => {
	const app = mount();
	await app.settle();
	const view = app.deep;
	// The letter pair and the state letter both come from the host's classification.
	const untracked = text(row(view, "note.md"));
	assert.equal(untracked.includes("??"), true, `saw: ${untracked}`);
	assert.equal(untracked.includes("?"), true);
	assert.equal(text(row(view, "staged.txt")).includes("A "), true);
});

await check("staging a file POSTs exactly its path and adopts the returned status", async () => {
	const app = mount();
	await app.settle();
	const before = app.deep;
	await app.click(before, "Stage");

	const posts = requests.filter((request) => request.key === "POST api/git.mutate");
	assert.equal(posts.length, 1, "one mutation per click");
	assert.deepEqual(posts[0].body, { action: "stage", paths: ["src/a.js"] });
	assert.equal(posts[0].init.method, "POST");
	// The mutation answered with a fresh status, so the tree must NOT be refetched:
	// that is what keeps the panel from flashing a loading state.
	assert.deepEqual(app.keys, ["GET api/git.tree", "GET api/git.ci", "POST api/git.mutate", "GET api/git.ci"]);

	const after = app.deep;
	assert.equal(text(after).includes("1 changed"), true, `saw: ${text(after)}`);
});

await check("stage-all and unstage-all send no paths", async () => {
	const app = mount();
	await app.settle();
	await app.click(app.deep, "Unstage all");
	assert.deepEqual(requests.findLast((request) => request.key === "POST api/git.mutate").body, { action: "unstage-all" });
	await app.click(app.deep, "Stage all");
	assert.deepEqual(requests.findLast((request) => request.key === "POST api/git.mutate").body, { action: "stage-all" });
	assert.equal(requests.filter((request) => request.key === "POST api/git.mutate").length, 2);
});

await check("collapse is browser-only viewing state", async () => {
	const app = mount();
	await app.settle();
	let view = app.deep;

	await app.click(view, "Collapse all");
	// Which directories are open is never a round trip.
	assert.equal(app.keys.includes("POST api/git.mutate"), false);
	view = app.deep;
	assert.equal(text(view).includes("a.js"), false, "a collapsed directory hides its files");
	assert.equal(text(view).includes("src"), true, `the directory row remains: ${text(view)}`);
	assert.equal(text(view).includes("staged.txt"), true, "and files outside it are untouched");

	await app.click(view, "Expand all");
	view = app.deep;
	assert.equal(text(view).includes("a.js"), true, "expanding brings the file back");
});

await check("folder chevrons follow click and keyboard expansion, including conflicts", async () => {
	const status = structuredClone(STATUS);
	Object.assign(status.tree.children[0].children[0], { state: "conflicted", index: "U", worktree: "U", staged: true });
	status.tree.children[0].counts = { conflicted: 1 };
	const app = mount({ status });
	await app.settle();
	const chevron = (folder) => collect(folder).find((element) => element.type === "svg");
	let folder = row(app.deep, "src");
	assert.equal(folder.props["aria-expanded"], true);
	assert.equal(chevron(folder).props.viewBox, "0 0 12 12");
	assert.equal(collect(folder).find((element) => element.props.className === "gt_disclosure").props["aria-hidden"], true);
	assert.match(source, /\.gt_row\[aria-expanded=true\] \.gt_disclosure svg \{ transform: rotate\(90deg\); \}/);
	assert.equal(chevron(row(app.deep, "src/a.js")), undefined, "files reserve the gutter but have no disclosure arrow");
	assert.equal(text(row(app.deep, "src/a.js")).includes("UU"), true);

	folder.props.onClick();
	await app.driver.settle();
	folder = row(app.deep, "src");
	assert.equal(folder.props["aria-expanded"], false);
	assert.ok(chevron(folder), "the closed folder keeps its arrow");
	assert.equal(row(app.deep, "src/a.js"), undefined);
	let prevented = false;
	folder.props.onKeyDown({ key: "Enter", preventDefault: () => { prevented = true; } });
	await app.driver.settle();
	assert.equal(prevented, true);
	assert.equal(row(app.deep, "src").props["aria-expanded"], true);
	assert.equal(text(row(app.deep, "src/a.js")).includes("UU"), true, "expansion preserves conflict state");
	assert.deepEqual(app.keys, ["GET api/git.tree", "GET api/git.ci"], "opening a folder never mutates the repository");
});

await check("committing needs a message, then sends it and clears the box", async () => {
	const app = mount();
	await app.settle();
	let view = app.deep;

	// A disabled commit is genuinely inert: clicking it must not reach the Host.
	await app.click(view, "Commit");
	assert.equal(requests.filter((request) => request.key === "POST api/git.mutate").length, 0);

	view = app.deep;
	const input = collect(view).find((element) => element.type === "input" && element.props.type !== "search");
	assert.ok(input, "the commit box must be an input");
	input.props.onChange({ target: { value: "feat: add a thing" } });
	await app.driver.settle();

	view = app.deep;
	const typed = collect(view).find((element) => element.type === "input" && element.props.type !== "search");
	assert.equal(typed.props.value, "feat: add a thing", "the box is controlled by the container");

	await app.click(view, "Commit");
	const post = requests.filter((request) => request.key === "POST api/git.mutate").at(-1);
	assert.deepEqual(post.body, { action: "commit", message: "feat: add a thing" });

	// A successful commit clears the box for the next one.
	view = app.deep;
	assert.equal(collect(view).find((element) => element.type === "input" && element.props.type !== "search").props.value, "");
});

await check("AI generation fills an editable draft without staging or committing", async () => {
	const app = mount();
	await app.settle();
	assert.match(button(app.deep, "AI generate").props.title, /staged diff.*selected model/);
	await app.click(app.deep, "AI generate");
	assert.deepEqual(app.keys, ["GET api/git.tree", "GET api/git.ci", "POST api/git.message"]);
	assert.deepEqual(requests.at(-1).body, { language: "en" });
	const input = collect(app.deep).find((element) => element.type === "input" && element.props.type !== "search");
	assert.equal(input.props.value, "Add the staged file");
	assert.equal(input.props.disabled, false);
	assert.equal(button(app.deep, "AI generate").props.disabled, true);
	assert.match(text(app.deep), /fixture\/selected.*Review before committing/);
	input.props.onChange({ target: { value: "My edited subject" } });
	await app.settle();
	await app.click(app.deep, "Commit");
	assert.deepEqual(requests.findLast((request) => request.key === "POST api/git.mutate").body, { action: "commit", message: "My edited subject" });
});

await check("AI generation never overwrites typed text and requires staged changes", async () => {
	const app = mount();
	await app.settle();
	collect(app.deep).find((element) => element.type === "input" && element.props.type !== "search").props.onChange({ target: { value: "Keep this" } });
	await app.settle();
	await app.click(app.deep, "AI generate");
	assert.deepEqual(app.keys, ["GET api/git.tree", "GET api/git.ci"]);
	assert.equal(collect(app.deep).find((element) => element.type === "input" && element.props.type !== "search").props.value, "Keep this");
	const empty = mount({ status: statusWith([], 0) });
	await empty.settle();
	await empty.click(empty.deep, "AI generate");
	assert.deepEqual(empty.keys, ["GET api/git.tree", "GET api/git.ci"]);
});

await check("a pending AI request blocks writes and preserves text entered in flight", async () => {
	let resolve;
	const app = mount({ onGenerate: () => new Promise((done) => { resolve = done; }) });
	await app.settle();
	const input = collect(app.deep).find((element) => element.type === "input" && element.props.type !== "search");
	await app.click(app.deep, "AI generate");
	assert.equal(button(app.deep, "Generating…").props.disabled, true);
	assert.equal(button(app.deep, "Stage all").props.disabled, true);
	assert.equal(button(app.deep, "Working…").props.disabled, true);
	assert.equal(collect(app.deep).find((element) => element.type === "input" && element.props.type !== "search").props.disabled, true);
	input.props.onChange({ target: { value: "Do not replace" } });
	resolve(reply({ kind: "ready", message: "Generated", model: { provider: "fixture", model: "selected" } })());
	await app.settle();
	assert.equal(collect(app.deep).find((element) => element.type === "input" && element.props.type !== "search").props.value, "Do not replace");
	assert.equal(app.keys.includes("POST api/git.mutate"), false);
});

await check("an AI refusal or transport failure leaves an empty draft and allows retry", async () => {
	for (const outcome of [{ kind: "rejected", code: "diff-too-large" }, { kind: "failed", message: "Provider unavailable" }]) {
		const app = mount({ onGenerate: reply(outcome) });
		await app.settle();
		await app.click(app.deep, "AI generate");
		assert.equal(collect(app.deep).find((element) => element.type === "input" && element.props.type !== "search").props.value, "");
		assert.equal(button(app.deep, "AI generate").props.disabled, false);
		assert.match(text(app.deep), outcome.kind === "rejected" ? /128 KiB/ : /Provider unavailable/);
	}
});

await check("a refused mutation is reported as a notice, not thrown", async () => {
	const app = mount({ onMutate: () => ({ kind: "rejected", code: "unknown-action" }) });
	await app.settle();
	const view = app.deep;
	const after = await app.click(view, "Stage");
	assert.equal(text(after).includes("That action is not supported."), true, `saw: ${text(after)}`);
});

await check("a git failure is reported with git's own words", async () => {
	const app = mount({ onMutate: () => ({ kind: "failed", action: "stage", message: "fatal: pathspec did not match" }) });
	await app.settle();
	const after = await app.click(app.deep, "Stage");
	assert.equal(text(after).includes("fatal: pathspec did not match"), true);
});

await check("opening a file loads its patch into the pane below", async () => {
	const app = mount();
	await app.settle();
	row(app.deep, "src/a.js").props.onClick();
	await app.driver.settle();

	const diff = requests.filter((request) => request.key === "GET api/git.diff");
	assert.equal(diff.length, 1);
	// The selected section's counts and patch must describe the same side.
	assert.match(diff[0].url, /scope=worktree/);
	assert.equal(patchText(app.driver.tree).includes("diff --git a/src/a.js"), true, "the patch must be shown");
});

await check("a staged-only file opens its staged patch", async () => {
	const app = mount();
	await app.settle();
	row(app.deep, "staged.txt").props.onClick();
	await app.driver.settle();
	assert.match(requests.filter((request) => request.key === "GET api/git.diff")[0].url, /scope=index/);
});

//#endregion

//#region the other views

await check("switching to History fetches the log lazily and draws the graph", async () => {
	const app = mount();
	const tree = await app.settle();
	await app.click(tree, "History");

	assert.equal(app.keys.includes("GET api/git.history"), true, "the history route must be called on demand");
	assert.equal(app.keys.filter((key) => key === "GET api/git.tree").length, 1, "and only the status is re-read, never eagerly");

	const view = app.deep;
	const flat = text(view);
	assert.equal(flat.includes("feat: newest"), true);
	assert.equal(flat.includes("fix: middle"), true);
	assert.equal(flat.includes("chore: root"), true);
	// The ahead-of-base marker is the panel's answer to "what is not in main yet".
	assert.equal(flat.includes("2 ahead of main"), true, `saw: ${flat}`);

	const graphs = collect(view).filter((element) => element.type === "svg" && element.props.className !== "gt_ciStatusIcon");
	assert.equal(graphs.length, 3, "one graph slice per commit");
	// The drawing space is the widest row's lane count, so a merge does not shift the
	// hashes of the rows around it.
	assert.equal(graphs[0].props.viewBox, "0 0 20 100", "the merge decides the column width");
	assert.equal(graphs[1].props.viewBox, "0 0 20 100", "and every row uses it");

	// Lane 0 is centred 5px in and lane 1 at 15px.
	const outgoing = collect(graphs[0]).find((child) => child.type === "path");
	assert.equal(outgoing.props.d.startsWith("M 5 50"), true, "the tip's edge starts at its node");
	assert.equal(outgoing.props.d.endsWith("5 100"), true, "and reaches the next row");

	// The merge's parent leaves the node in lane 1 and curves down into lane 0.
	const curve = collect(graphs[1]).find((child) => child.type === "path");
	assert.equal(curve.props.d.startsWith("M 15 50"), true, `the parent leaves its own lane: ${curve.props.d}`);
	assert.equal(curve.props.d.endsWith("5 100"), true, `and lands in lane 0's column: ${curve.props.d}`);
});

await check("a lane slice spans its whole row, whatever the row's height is", async () => {
	// The graph read as dashes twice. Both times the cause was the same shape of
	// mistake: the lanes were drawn in a coordinate space of a fixed height, and a row
	// turned out to be a different height. So the assertions here are not about a
	// number agreeing with another number — they are that no number is depended on.
	const app = mount();
	const tree = await app.settle();
	await app.click(tree, "History");

	const rows = collect(app.deep).filter((element) => {
		if (element.props?.role !== "button") return false;
		return collect(element).filter((child) => child.type === "svg").length === 1;
	});
	assert.equal(rows.length, 3, "one row per commit");

	for (const [index, element] of rows.entries()) {
		const slice = collect(element).find((child) => child.type === "div" && child.props?.style?.position === "absolute");
		assert.notEqual(slice, undefined, `row ${index}: the slice must be positioned against the row`);
		// `top`/`bottom` against the row's padding box is what makes one row's slice end
		// exactly where the next one begins. A pixel height would not survive a taller row.
		assert.equal(typeof slice.props.style.top, "number", `row ${index}: the slice must anchor to the top edge`);
		assert.equal(typeof slice.props.style.bottom, "number", `row ${index}: the slice must anchor to the bottom edge`);
		assert.equal(slice.props.style.height, undefined, `row ${index}: a fixed slice height is the bug`);

		const svg = collect(slice).find((child) => child.type === "svg");
		assert.equal(svg.props.height, "100%", `row ${index}: the drawing must fill the slice`);
		assert.equal(svg.props.preserveAspectRatio, "none", `row ${index}: the drawing is stretched, not scaled`);
		// The vertical axis is a share of the row, not pixels, so it cannot disagree with one.
		assert.equal(svg.props.viewBox.endsWith(" 100"), true, `row ${index}: viewBox is ${svg.props.viewBox}`);

		// A stroke is scaled by the stretch unless it opts out, and a sub-pixel stroke is
		// what a "broken" line looks like.
		for (const stroke of collect(svg).filter((child) => child.type === "line" || child.type === "path")) {
			assert.equal(stroke.props.vectorEffect, "non-scaling-stroke", `row ${index}: ${stroke.type} must not be scaled`);
		}
		// Stretching a circle makes an ellipse, so the node must not be one.
		assert.equal(collect(svg).some((child) => child.type === "circle"), false, `row ${index}: the node is not an svg circle`);
		const node = collect(slice).find((child) => child.props?.style?.borderRadius === "50%");
		assert.notEqual(node, undefined, `row ${index}: the node is drawn where it cannot be distorted`);

		// And nothing may clip the row: the ref badges are the shell's to size.
		assert.notEqual(element.props.style.height, 34, `row ${index}: the row must not be pinned to a lane height`);
	}
});

await check("every row reserves the same graph column", async () => {
	// The slice is out of the flow now, so if each row sized its own column the hashes
	// would step in and out with the merges.
	const app = mount();
	const tree = await app.settle();
	await app.click(tree, "History");

	const rows = collect(app.deep).filter((element) => {
		if (element.props?.role !== "button") return false;
		return collect(element).filter((child) => child.type === "svg").length === 1;
	});
	const pads = rows.map((element) => String(element.props.style.padding));
	const widths = new Set(pads.map((padding) => padding.split(" ")[3]));
	assert.equal(widths.size, 1, `rows must align: ${[...widths].join(", ")}`);

	const slices = rows.map((element) => collect(element).find((child) => child.type === "div" && child.props?.style?.position === "absolute"));
	const sliceWidths = new Set(slices.map((slice) => slice.props.style.width));
	assert.equal(sliceWidths.size, 1, `slices must share a width: ${[...sliceWidths].join(", ")}`);
	// The widest row decides it, so the two-lane merge row has to fit its own lanes.
	assert.equal([...sliceWidths][0] >= 20, true, `the merge row needs two lanes, saw ${[...sliceWidths][0]}`);
});

await check("real lane geometry connects tips, merges and roots without inventing incoming edges", () => {
	const rows = assignLanes([
		{ sha: "merge", parents: ["left", "right"] },
		{ sha: "left", parents: ["root"] },
		{ sha: "right", parents: ["root"] },
		{ sha: "root", parents: [] },
		{ sha: "unrelated", parents: [] }
	]);
	const view = internals.HistoryView({ state: { phase: "ready", value: { commits: rows, total: rows.length } }, t });
	const graphs = collect(view).filter((node) => node.type === "svg");
	for (const [index, commit] of rows.entries()) {
		const strokes = collect(graphs[index]).filter((node) => node.type === "line" || node.type === "path");
		const incoming = strokes.find((node) => node.props.key === "in");
		assert.equal(incoming !== undefined, [false, true, true, true, false][index], `${commit.sha}: incoming half`);
		if (incoming) assert.equal(incoming.props.y2, 50, "the incoming edge ends at the node");
		const outgoing = strokes.filter((node) => String(node.props.key).startsWith("p"));
		assert.equal(outgoing.length, commit.columns.length, `${commit.sha}: every parent has an edge, including the same lane`);
		for (const edge of outgoing) assert.match(edge.props.d, / 100$/, "parent edge reaches the next row");
	}
});

await check("opening a commit loads the whole commit, pathless", async () => {
	const app = mount();
	const tree = await app.settle();
	await app.click(tree, "History");
	const view = app.deep;
	row(view, "aaaa111 feat: newest").props.onClick();
	await app.driver.settle();

	const diff = requests.filter((request) => request.key === "GET api/git.diff").at(-1);
	assert.match(diff.url, /scope=commit/);
	assert.match(diff.url, /rev=aaaa111/);
	assert.equal(diff.url.includes("path="), false, "a whole commit names no path");
});

await check("the Branches view marks the current branch and splits remotes", async () => {
	const app = mount();
	const tree = await app.settle();
	await app.click(tree, "Branches");
	assert.equal(app.keys.includes("GET api/git.branches"), true);

	const flat = text(app.deep);
	assert.equal(flat.includes("Local"), true);
	assert.equal(flat.includes("Remote"), true);
	assert.equal(flat.includes("current"), true, "the current branch must be marked");
	assert.equal(flat.includes("→ origin/main"), true, "its upstream must be named");
	assert.equal(flat.includes("1 ahead · 2 behind"), true, `saw: ${flat}`);
});

await check("the Reflog view reports what moved HEAD", async () => {
	const app = mount();
	const tree = await app.settle();
	await app.click(tree, "Reflog");
	assert.equal(app.keys.includes("GET api/git.reflog"), true);

	const flat = text(app.deep);
	assert.equal(flat.includes("rebase (finish)"), true, "a rebase leaves exactly this record");
	assert.equal(flat.includes("commit: chore: root"), true);
	assert.equal(flat.includes("HEAD@{1}"), false, "the date is shown in place of the selector");
});

//#endregion

//#region the operation banner

const REBASING = {
	...STATUS,
	state: { kind: "rebase", branch: "feature", onto: "main", commit: null, step: 1, total: 3 }
};

await check("a rebase in progress is announced", async () => {
	const app = mount({ status: REBASING });
	const tree = await app.settle();
	const flat = text(tree);
	assert.equal(flat.includes("Rebase"), true, `saw: ${flat}`);
	assert.equal(flat.includes("branch feature"), true);
	assert.equal(flat.includes("onto main"), true);
	assert.equal(flat.includes("step 1 of 3"), true, "the progress must be counted");
	assert.equal(flat.includes("Resolve it in the terminal"), true, "and it must say where to act");
});

await check("the banner is visible from every view, not just Branches", async () => {
	const app = mount({ status: REBASING });
	let tree = await app.settle();
	for (const label of ["History", "Branches", "Reflog", "Changes"]) {
		tree = await app.click(tree, label);
		assert.equal(text(tree).includes("Rebase"), true, `the banner is missing on ${label}`);
	}
});

await check("a merge conflict names itself the same way", async () => {
	const app = mount({ status: { ...STATUS, state: { kind: "merge", branch: null, onto: null, commit: null, step: null, total: null } } });
	const tree = await app.settle();
	assert.equal(text(tree).includes("Merge"), true);
});

//#endregion

//#region placeholders

await check("a session without a workspace explains itself and asks for nothing", async () => {
	const app = mount({ cwd: undefined });
	const tree = await app.settle();
	assert.deepEqual(app.keys, [], "no workspace means no request at all");
	assert.equal(text(tree).includes("no workspace directory"), true, `saw: ${text(tree)}`);
});

await check("a directory that is not a repository says so, and offers no empty tabs", async () => {
	const app = mount({ status: { kind: "no-repository" } });
	const tree = await app.settle();
	assert.equal(text(tree).includes("Not a git repository"), true, `saw: ${text(tree)}`);
	// Only the header survives; the four tabs would all be dead ends.
	const labels = primitivesNamed(tree, "Button").map((element) => text(element));
	assert.deepEqual(labels, ["Refresh"], `saw: ${labels.join(", ")}`);
});

await check("an unreadable answer surfaces the transport message", async () => {
	const app = mount();
	responses["GET api/git.tree"] = () => {
		throw new Error("network down");
	};
	const tree = await app.settle();
	assert.equal(text(tree).includes("network down"), true, `saw: ${text(tree)}`);
});

//#endregion

//#region the diff pane in isolation

await check("the diff pane shows the patch, the scope and the truncation note", () => {
	const pane = internals.diffPane(
		{ phase: "ready", scope: "commit", label: "aaaa111 feat: newest", value: { text: "patch body", truncated: true } },
		t,
		() => {}
	);
	const flat = text(pane);
	assert.equal(patchText(pane).includes("patch body"), true);
	assert.equal(flat.includes("whole commit"), true);
	assert.equal(flat.includes("The diff is truncated."), true);
	assert.ok(collect(pane).some((element) => element.props.className === "gt_patch"));

	const empty = internals.diffPane({ phase: "ready", scope: "head", label: "x", value: { text: "" } }, t, () => {});
	assert.equal(text(empty).includes("No textual diff"), true);
});

await check("a binary file is explained rather than rendered", () => {
	const pane = internals.diffPane({ phase: "ready", scope: "head", label: "logo.png", value: { binary: true, text: "" } }, t, () => {});
	assert.equal(text(pane).includes("Binary file"), true);
});

await check("patches retain metadata and choose syntax separately for each file and side", () => {
	highlights.length = 0;
	const raw = [
		"diff --git a/one.js b/one.js", "--- a/one.js", "+++ b/one.js", "@@ -4,2 +4,2 @@",
		" const same = 1;", "-const old = 2;", "+const newer = 3;", "\\ No newline at end of file",
		"diff --git a/removed.js b/removed.js", "--- a/removed.js", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone();",
		"diff --git a/data.xyz b/data.xyz", "--- a/data.xyz", "+++ b/data.xyz", "@@ -0,0 +1 @@", "+<script>alert(1)</script>", ""
	].join("\n");
	const parts = internals.patchParts(raw);
	const hunks = parts.filter((part) => typeof part !== "string");
	assert.deepEqual([...hunks.map((hunk) => hunk.path)], ["one.js", "removed.js", "data.xyz"]);
	assert.equal(hunks[0].oldStart, 4);
	assert.equal(hunks[1].newStart, 0);
	const highlighted = renderDeep(internals.PatchHunk({ hunk: hunks[0] }));
	assert.deepEqual(highlights, [
		{ language: "javascript", code: "const same = 1;\nconst old = 2;" },
		{ language: "javascript", code: "const same = 1;\nconst newer = 3;" }
	], "syntax receives source without patch prefixes, separately for each side");
	assert.equal(collect(highlighted).filter((node) => node.props.className === "gt_patchCode").map(text).join(""), "const same = 1;const old = 2;const newer = 3; No newline at end of file");
	assert.equal(collect(highlighted).filter((node) => node.props.style?.color).length, 3, "source rows receive syntax tokens");
	assert.equal(collect(highlighted).filter((node) => node.props.className === "gt_patchLine gt_patchAdd").length, 1);
	assert.equal(collect(highlighted).filter((node) => node.props.className === "gt_patchLine gt_patchDelete").length, 1);
	const unknown = renderDeep(internals.PatchHunk({ hunk: hunks[2] }));
	assert.equal(text(unknown).includes("<script>alert(1)</script>"), true, "unknown syntax stays literal text");
	assert.equal(collect(unknown).some((node) => node.type === "script" || node.props.dangerouslySetInnerHTML), false);
	let copied;
	const pane = internals.diffPane({ phase: "ready", value: { text: raw } }, t, () => {}, undefined, { onCopy: (value) => { copied = value; } });
	button(pane, "Copy").props.onClick();
	assert.equal(copied, raw, "copy preserves the complete original patch, including its final newline");
});

await check("keyboard staging does not bubble into opening a file patch", async () => {
	const app = mount();
	const tree = await app.settle();
	const file = row(tree, "src/a.js");
	file.props.onKeyDown({ key: "Enter", target: {}, currentTarget: file, preventDefault() {} });
	assert.equal(app.keys.includes("GET api/git.diff"), false);
	file.props.onKeyDown({ key: "Enter", target: file, currentTarget: file, preventDefault() {} });
	await app.settle();
	assert.equal(app.keys.includes("GET api/git.diff"), true);
});

//#endregion

//#region the Blame view

/** The Blame view's path field. */
const pathField = (tree) => collect(tree).find((element) => element.type === "input" && element.props.type !== "search");

/** Type into the path field, as a change event would. */
const typePath = (tree, value) => pathField(tree).props.onChange({ target: { value } });

/** The blame request's parameters. */
const blameParams = (app) => {
	const request = app.requests?.find((entry) => entry.key === "GET api/git.blame");
	return request === undefined ? null : new URL(request.url, "http://localhost").searchParams;
};

await check("the Blame view asks for nothing until a path is named", async () => {
	const app = mount();
	const tree = await app.settle();
	const view = await app.click(tree, "Blame");
	// Switching views must not re-read the status, and must not guess a path.
	assert.deepEqual(app.keys, ["GET api/git.tree", "GET api/git.ci"], "no path means no request");
	assert.equal(text(view).includes("Name a tracked file"), true, `saw: ${text(view)}`);
	assert.equal(pathField(view).props.value, "");
	// Nothing to ask for, so the action that would ask is not available.
	assert.equal(button(view, "Show blame").props.disabled, true, "an empty path cannot be blamed");
	// Typing makes it available, and the field keeps what was typed.
	typePath(view, "src/a.js");
	const typed = await app.settle();
	assert.equal(button(typed, "Show blame").props.disabled, false);
	assert.equal(pathField(typed).props.value, "src/a.js");
	assert.deepEqual(app.keys, ["GET api/git.tree", "GET api/git.ci"], "typing alone must not fetch");
});

await check("naming a path blames it and draws each line's commit", async () => {
	const app = mount();
	const tree = await app.settle();
	let view = await app.click(tree, "Blame");
	typePath(view, "src/a.js");
	view = await app.settle();
	view = await app.click(view, "Show blame");

	const params = blameParams(app);
	assert.equal(params.get("path"), "src/a.js", "the path must travel as a parameter");
	assert.equal(params.get("sessionId"), "session-1");
	assert.deepEqual(app.keys, ["GET api/git.tree", "GET api/git.ci", "GET api/git.blame", "GET api/git.ci"]);
	// The header counts lines, commits and authors — three different numbers.
	assert.equal(text(view).includes("2 lines · 2 commits · 2 authors"), true, `saw: ${text(view)}`);
	// Each row carries its own line number, commit and source.
	assert.equal(text(view).includes("const a = 1;"), true);
	assert.equal(text(view).includes("let b = 2;"), true);
	assert.ok(button(view, "aaaaaaa"), "a committed line offers its commit");
	// A line git has not committed is labelled instead of given a fake commit.
	assert.equal(button(view, "0000000"), undefined, "an uncommitted line must not offer a sha");
	assert.equal(text(view).includes("uncommitted"), true);
	const source = collect(view).filter((element) => element.props.className === "gt_blameText");
	assert.equal(source.every((element) => collect(element).some((token) => token.props.style?.color)), true, "blame source is highlighted too");
});

await check("clicking a blamed line opens that commit's patch", async () => {
	const app = mount();
	const tree = await app.settle();
	let view = await app.click(tree, "Blame");
	typePath(view, "src/a.js");
	view = await app.settle();
	view = await app.click(view, "Show blame");
	await app.click(view, "aaaaaaa");

	const diff = requests.filter((request) => request.key === "GET api/git.diff").at(-1);
	assert.match(diff.url, /scope=commit/);
	assert.match(diff.url, /rev=aaaaaaaaaa/);
	assert.equal(text(app.deep).includes("aaaaaaa feat: one"), true);
});

await check("a path git cannot blame shows git's own words", async () => {
	const app = mount({ blame: { kind: "failed", path: "nope.txt", message: "fatal: no such path 'nope.txt' in HEAD" } });
	const tree = await app.settle();
	let view = await app.click(tree, "Blame");
	typePath(view, "nope.txt");
	view = await app.settle();
	view = await app.click(view, "Show blame");
	assert.equal(text(view).includes("fatal: no such path"), true, `saw: ${text(view)}`);
});

await check("a file patch hands its path to the Blame view", async () => {
	const app = mount();
	await app.settle();
	row(app.deep, "src/a.js").props.onClick();
	await app.driver.settle();

	// The pane offers blame for a file patch, and the view is what it should leave.
	const pane = app.deep;
	assert.ok(button(pane, "Show blame"), "a file patch should offer blame");
	const view = await app.click(pane, "Show blame");
	assert.equal(pathField(view).props.value, "src/a.js", "the path is carried over, not retyped");
	const params = blameParams(app);
	assert.equal(params.get("path"), "src/a.js");
	// The patch pane was cleared on the view switch rather than left hanging below.
	assert.equal(text(view).includes("diff --git"), false, "the pane closes with the switch");
});

await check("a whole-commit patch offers no blame, because there is no one path", async () => {
	const app = mount();
	const tree = await app.settle();
	await app.click(tree, "History");
	row(app.deep, "aaaa111 feat: newest").props.onClick();
	await app.driver.settle();
	assert.equal(button(app.deep, "Show blame"), undefined, "a commit has nothing to blame");
	assert.equal(blameParams(app), null, "and no blame may be requested");
});

await check("a path is re-read when it is asked for again", async () => {
	const app = mount();
	const tree = await app.settle();
	let view = await app.click(tree, "Blame");
	typePath(view, "src/a.js");
	view = await app.settle();
	view = await app.click(view, "Show blame");
	const before = requests.filter((request) => request.key === "GET api/git.blame").length;
	// The same path, asked for again: the key would be identical, so the view must
	// bump its nonce or a reader would be stuck with a stale answer.
	view = await app.click(view, "Show blame");
	assert.equal(requests.filter((request) => request.key === "GET api/git.blame").length, before + 1);
});

//#endregion

//#region payload skew between the two halves

// The Host half is frozen when the server starts; this bundle is re-read live. So a
// payload CAN legitimately be missing a field the view expects, and it did: the
// status payload the running server sent had no `state`, and the banner dereferenced
// it, which blanked the whole pane. A missing field must degrade, never crash.
const without = (object, ...keys) => {
	const copy = { ...object };
	for (const key of keys) delete copy[key];
	return copy;
};

await check("a status payload from an older Host half does not blank the pane", async () => {
	const app = mount({ status: without(STATUS, "state") });
	const view = await app.settle();
	// The crash took the whole slot entry with it, so the tree is the proof it lived.
	assert.equal(text(view).includes("staged.txt"), true, `saw: ${text(view)}`);
	assert.equal(row(view, "src/a.js") !== undefined, true, "the rows still render");
	// With no operation reported, the banner simply says nothing.
	assert.equal(text(view).includes(t("op.hint")), false, "no banner without an operation");
});

await check("a rebase in progress with an older payload still does not crash", async () => {
	// The same shape as the real failure, but on a repository mid-rebase, where the
	// banner is the thing that wanted the missing field.
	const app = mount({ status: without(STATUS, "state") });
	const view = await app.settle();
	assert.equal(text(view).includes("main"), true, "the header still renders");
});

await check("a view whose payload is missing its list still renders", async () => {
	const app = mount({
		history: without(HISTORY, "commits"),
		branches: without(BRANCHES, "branches"),
		reflog: without(REFLOG, "entries"),
		blame: without(BLAME, "lines", "authors")
	});
	let view = await app.settle();

	for (const label of ["History", "Branches", "Reflog"]) {
		view = await app.click(view, label);
		assert.equal(typeof text(view), "string", `${label} must render`);
	}
	view = await app.click(view, "Blame");
	typePath(view, "src/a.js");
	view = await app.settle();
	view = await app.click(view, "Show blame");
	assert.equal(text(view).includes("No lines to blame.") || text(view).includes("lines"), true, `saw: ${text(view)}`);
});

//#endregion

await check("graph colours survive merges and a new tip, without tying identity to column numbers", () => {
	const records = [
		{ sha: "merge", parents: ["left", "right"], refs: [{ kind: "head", name: "main" }] },
		{ sha: "left", parents: ["base"], refs: [] },
		{ sha: "right", parents: ["base"], refs: [{ kind: "other", name: "topic" }] },
		{ sha: "base", parents: [], refs: [] },
		{ sha: "orphan", parents: [], refs: [{ kind: "other", name: "independent" }] }
	];
	const geometry = assignLanes(records);
	const rows = internals.colorGraph(geometry);
	assert.notEqual(rows[0].afterColors[0], rows[0].afterColors[1], "live branches are distinguishable");
	assert.equal(rows[1].color, rows[0].color, "first-parent history keeps its colour");
	assert.equal(rows[2].color, rows[0].afterColors[1], "the side history keeps its colour until it joins");
	assert.equal(rows[3].color, rows[0].color, "shared ancestry continues the surviving colour");
	assert.equal(rows[4].color, internals.branchColor("independent"), "a freed column is seeded by its new tip, not its old owner");
	for (const [index, row] of rows.entries()) {
		if (index) assert.deepEqual([...row.beforeColors], [...rows[index - 1].afterColors]);
		const strokes = internals.laneGutter(row).children[0].children;
		for (const stroke of strokes) {
			const key = String(stroke.props.key);
			if (key.startsWith("p")) assert.equal(stroke.props.stroke, row.afterColors[Number(key.slice(1))]);
			if (key.startsWith("e") || key.startsWith("t")) assert.equal(stroke.props.stroke, row.beforeColors[Number(key.slice(1))]);
		}
	}
	const refreshed = internals.colorGraph(assignLanes([{ sha: "new", parents: ["merge"], refs: [{ kind: "head", name: "main" }] }, ...records]));
	assert.deepEqual([...refreshed.slice(1).map((row) => row.color)], [...rows.map((row) => row.color)]);
	assert.equal(geometry.some((row) => row.color !== undefined), false, "colouring never mutates the host payload");
});

await check("HEAD, ahead commits and selected history each have a non-colour cue", async () => {
	const app = mount();
	await app.settle();
	await app.click(app.deep, "History");
	const head = collect(app.deep).find((node) => node.props["data-head"] === true);
	assert.match(head.props.style.boxShadow, /currentColor/, "HEAD has a double ring");
	assert.equal(collect(app.deep).filter((node) => node.props["data-ahead"] === true).length, 2);
	assert.equal(text(app.deep).includes("Not yet in main"), true);
	const ref = collect(app.deep).find((node) => node.props.className === "gt_refDot");
	assert.equal(ref.props.style.background, internals.branchColor("main"));
	row(app.deep, "aaaa111 feat: newest").props.onClick();
	await app.settle();
	assert.equal(row(app.deep, "aaaa111 feat: newest").props["aria-current"], "true");
	assert.ok(collect(app.deep).some((node) => node.props.className === "gt_paneTitle"));
});

await check("each section's counts, selection and patch all use the same index side", async () => {
	const status = JSON.parse(JSON.stringify(STATUS));
	const file = status.tree.children[0].children[0];
	Object.assign(file, { staged: true, index: "M", changes: { index: { added: 12, deleted: 4 }, worktree: { added: 3, deleted: 2 } } });
	const app = mount({ status });
	await app.settle();
	let rows = collect(app.deep).filter((node) => node.props.role === "button" && node.props.title?.startsWith("src/a.js\n"));
	assert.equal(rows.length, 2);
	assert.equal(text(rows[0]).includes("+12−4"), true);
	assert.equal(text(rows[1]).includes("+3−2"), true);
	rows[0].props.onClick();
	await app.settle();
	rows = collect(app.deep).filter((node) => node.props.role === "button" && node.props.title?.startsWith("src/a.js\n"));
	assert.deepEqual(rows.map((node) => node.props["aria-current"]), ["true", undefined]);
	assert.match(app.requests.at(-1).url, /scope=index/);
	rows[1].props.onClick();
	await app.settle();
	rows = collect(app.deep).filter((node) => node.props.role === "button" && node.props.title?.startsWith("src/a.js\n"));
	assert.deepEqual(rows.map((node) => node.props["aria-current"]), [undefined, "true"]);
	assert.match(app.requests.at(-1).url, /scope=worktree/);
	assert.match(rows[1].props.title, /3 added · 2 deleted/, "counts remain available in the narrow row's tooltip");
});

await check("patch line numbers advance only on their own side, including empty files and multiple hunks", () => {
	const hunks = internals.patchParts("@@ -9,2 +20,2 @@\n context\n-old\n+new\n\\ No newline at end of file\n@@ -0,0 +1 @@\n+fresh\n@@ -1 +0,0 @@\n-removed\n");
	const numbers = hunks.map((hunk) => collect(renderDeep(internals.PatchHunk({ hunk }))).filter((node) => node.props.className === "gt_patchNumber").map(text));
	assert.deepEqual([...numbers], [["9", "20", "10", "", "", "21", "", ""], ["", "1"], ["1", ""]]);
});

await check("Blame elides repeated metadata only within a contiguous commit group", async () => {
	const makeLine = (sha, source, uncommitted = false) => ({ sha, short: sha.slice(0, 7), author: "Ann", summary: "work", text: source, uncommitted });
	const lines = [makeLine("a".repeat(40), "one"), makeLine("a".repeat(40), "two"), makeLine("b".repeat(40), "three"), makeLine("a".repeat(40), "four"), makeLine("0".repeat(40), "five", true), makeLine("0".repeat(40), "six", true)];
	const app = mount({ blame: { ...BLAME, lines, commits: 3, authors: ["Ann"], newest: null } });
	await app.settle();
	await app.click(app.deep, "Blame");
	typePath(app.deep, "src/a.js");
	await app.settle();
	await app.click(app.deep, "Show blame");
	const rows = collect(app.deep).filter((node) => node.props.className === "gt_blameRow");
	assert.deepEqual(rows.map((node) => node.props["data-group-start"]), [true, false, true, true, true, false]);
	assert.deepEqual(rows.map((node) => text(collect(node).find((child) => child.props.className === "gt_blameAuthor"))), ["Ann", "", "Ann", "Ann", "Ann", ""]);
	assert.equal(primitivesNamed(app.deep, "Button").filter((node) => text(node) === "aaaaaaa").length, 2, "a separated recurrence gets its own clickable group header");
	assert.match(rows[1].props.title, /aaaaaaa · Ann/, "continuation lines retain their owner in the tooltip");
	assert.equal(text(rows[5]).includes("six"), true, "no source lines are hidden");
});

await check("commit identity is visible beside the message and expands to scoped configuration", async () => {
	const app = mount(); await app.settle();
	const details = collect(app.deep).find((node) => node.type === "details" && node.props.className === "gt_identity");
	assert.ok(details);
	assert.equal(text(collect(details).find((node) => node.type === "summary")), "Commit as: Fixture <fixture@example.test>");
	assert.match(text(details), /user\.nameFixture\nlocal · file:\.git\/config/);
	assert.match(text(details), /user\.emailfixture@example\.test\nglobal/);
	assert.deepEqual(app.keys, ["GET api/git.tree", "GET api/git.ci"]);
});
await check("identity overrides and missing settings have explicit, separate explanations", async () => {
	const status = { ...STATUS, identity: { ...STATUS.identity, author: { kind: "ready", name: "Other Author", email: "other@example.test" } } };
	const app = mount({ status }); await app.settle();
	assert.match(text(app.deep), /Commit as: Other Author/); assert.match(text(app.deep), /Effective identity differs/);
	const missing = mount({ status: { ...STATUS, identity: { config: { name: { kind: "unset" }, email: { kind: "failed" } }, author: { kind: "unavailable" }, committer: { kind: "unavailable" } } } });
	await missing.settle(); assert.match(text(missing.deep), /Not configured/); assert.match(text(missing.deep), /identity unavailable/);
});
await check("CI fetches for the header badge, displays the SHA and opens safe external log links", async () => {
	const app = mount(); await app.settle(); assert.deepEqual(app.keys, ["GET api/git.tree", "GET api/git.ci"]);
	await app.click(app.deep, "CI"); assert.equal(app.keys.includes("GET api/git.ci"), true); assert.equal(app.keys.includes("GET api/git.auth"), false);
	assert.match(text(app.deep), /HEAD aaaaaaaaaaaa/); assert.match(text(app.deep), /testChecksFailed/);
	const link = collect(app.deep).find((node) => node.type === "a"); assert.equal(link.props.target, "_blank"); assert.equal(link.props.rel, "noopener noreferrer");
	assert.equal(app.keys.some((key) => key.startsWith("POST")), false);
});
await check("gh authentication is an explicit check, with account/source/scopes but no token UI", async () => {
	const app = mount(); await app.settle(); await app.click(app.deep, "CI");
	await app.click(app.deep, "Check gh authentication");
	assert.equal(app.keys.includes("GET api/git.auth"), true); assert.match(text(app.deep), /Account: Fixture/); assert.match(text(app.deep), /Credential source: keyring/); assert.match(text(app.deep), /Reported scopes: repo/);
	assert.equal(collect(app.deep).some((node) => node.type === "input" && node.props.type === "password"), false);
});
await check("CI groups repository, result and refresh metadata without an idle authentication panel", async () => {
	const app = mount(); await app.settle(); await app.click(app.deep, "CI");
	const overview = collect(app.deep).find((node) => node.props.className === "gt_ciOverview");
	assert.equal(overview.props["aria-label"], "CI overview");
	assert.match(text(overview), /owner\/repogithub · github\.comFailedHEAD aaaaaaaaaaaa1 checksAuto-refresh/);
	const refresh = collect(overview).find((node) => node.props.className === "gt_ciPoll");
	assert.match(refresh.props.title, /15s.*60s/);
	assert.equal(collect(app.deep).some((node) => node.props.className === "gt_connection"), false);
	assert.equal(app.keys.includes("GET api/git.auth"), false);
	await app.click(app.deep, "Check gh authentication");
	const auth = collect(app.deep).find((node) => node.props.className === "gt_connection");
	assert.equal(auth.type, "details"); assert.equal(auth.props.open, true);
	assert.equal(text(collect(auth).find((node) => node.type === "summary")), "Connection account");
	assert.match(text(auth), /CI access verifiedAccount: Fixture/);
});
await check("CI job cards keep long names, states and phase controls in separate readable regions", async () => {
	const name = "very-long-workflow-name/".repeat(8);
	const app = mount({ ci: { kind: "ready", state: "failure", checks: [
		{ name, group: "Checks", state: "failure", steps: [{ number: 1, name: "Long phase ".repeat(8), state: "failure", durationSeconds: 0 }] },
		{ name: "Another job", state: "success", steps: [] }
	] } });
	await app.settle(); await app.click(app.deep, "CI");
	const cards = collect(app.deep).filter((node) => node.props.className === "gt_ciRow");
	assert.equal(cards.length, 2); assert.equal(cards[0].type, "article");
	const head = collect(cards[0]).find((node) => node.props.className === "gt_ciJobHead");
	assert.equal(text(collect(head).find((node) => node.props.className === "gt_subject")), name);
	assert.equal(text(collect(head).find((node) => node.props.className?.startsWith("gt_ciState "))), "Failed");
	const steps = collect(cards[0]).find((node) => node.type === "summary");
	assert.equal(text(collect(steps).find((node) => node.props.className === "gt_ciStepCount")), "1/1 finished");
	const meta = collect(cards[0]).find((node) => node.props.className === "gt_meta gt_ciStepMeta");
	assert.equal(text(meta), "Failed · 0sAsk AI");
	assert.match(source, /@container \(max-width: 340px\) \{ \.gt_ciStepMeta \{ grid-column: 2 \/ -1/);
});
await check("CI state icons remain decorative and every state retains a readable label", async () => {
	for (const state of ["success", "failure", "blocked", "canceled", "skipped", "unknown", "running", "pending"]) {
		const app = mount({ ci: { kind: "ready", state, checks: [{ name: "job", state }] } });
		await app.settle(); await app.click(app.deep, "CI");
		const card = collect(app.deep).find((node) => node.props.className === "gt_ciRow");
		const status = collect(card).find((node) => node.props.className?.startsWith("gt_ciState "));
		assert.equal(text(status), t(`ci.state.${state}`));
		const icon = collect(status).find((node) => ["gt_ciSpinner", "gt_ciStatusIcon"].includes(node.props.className));
		assert.equal(icon.props["aria-hidden"], true);
		if (icon.type === "svg") assert.equal(icon.props.focusable, "false");
	}
});
await check("CI phases expand in order with progress, duration and an accessible current step", async () => {
	const app = mount({ ci: { kind: "ready", state: "running", checks: [{ name: "CI job", state: "running", steps: [
		{ number: 1, name: "Checkout", state: "success", durationSeconds: 2 },
		{ number: 2, name: "Syntax", state: "failure", durationSeconds: 1 },
		{ number: 3, name: "Test phase", state: "running", durationSeconds: null },
		{ number: 4, name: "Package phase", state: "not-started", durationSeconds: null },
		{ number: 5, name: "Optional phase", state: "skipped", durationSeconds: null }
	] }] } });
	await app.settle(); await app.click(app.deep, "CI");
	const details = collect(app.deep).find((node) => node.type === "details");
	assert.equal(details.props.open, true); assert.match(text(details), /Steps3\/5 finished/);
	const list = collect(details).find((node) => node.type === "ol"); assert.equal(list.props["aria-label"], "Steps");
	const rows = collect(list).filter((node) => node.type === "li"); assert.equal(rows.length, 5);
	assert.match(text(rows[0]), /CheckoutPassed · 2s/); assert.match(text(rows[1]), /SyntaxFailed · 1s/);
	assert.equal(rows[2].props["aria-current"], "step"); assert.match(text(rows[3]), /Not started/); assert.match(text(rows[4]), /Skipped/);
	assert.equal(rows[3].props["aria-current"], undefined); assert.equal(app.keys.some((key) => key.startsWith("POST")), false);
});
await check("CI step errors and limits preserve the known job result and explain missing detail", async () => {
	for (const [stepsError, expected] of [["forbidden", "Access denied"], ["limit", "limited to 10 jobs"], ["unavailable", "Step details unavailable"]]) {
		const app = mount({ ci: { kind: "ready", state: "success", checks: [{ name: "test", state: "success", stepsError }] } });
		await app.settle(); await app.click(app.deep, "CI"); assert.match(text(app.deep), /testPassed/); assert.equal(text(app.deep).includes(expected), true);
	}
});
await check("queued jobs do not invent phases before the runner provides them", async () => {
	const app = mount({ ci: { kind: "ready", state: "pending", checks: [{ name: "test", state: "pending", steps: [] }] } });
	await app.settle(); await app.click(app.deep, "CI"); assert.match(text(app.deep), /Step details appear when the runner starts/);
	assert.equal(text(app.deep).includes("0/0"), false);
});
const liveResult = (state, sha = "a".repeat(40)) => ({ kind: "ready", state, sha, checks: [{ name: "Live job", state, steps: [{ number: 1, name: "Live phase", state }] }] });
await check("CI discovers runs, follows phases automatically, then watches for a new HEAD more slowly", async () => {
	const values = [{ kind: "ready", state: "none", checks: [] }, liveResult("pending"), liveResult("running"), liveResult("success"), liveResult("pending", "b".repeat(40))];
	let calls = 0;
	const app = mount({ onCI: () => reply(values[calls++])() });
	await app.settle(); await app.click(app.deep, "CI"); assert.equal(calls, 1);
	await app.advance(14999); assert.equal(calls, 1);
	await app.advance(1); assert.equal(calls, 2); assert.equal(collect(app.deep).filter((node) => node.props.className === "gt_ciSpinner").length, 4);
	await app.advance(15000); assert.equal(calls, 3); assert.match(text(app.deep), /Live jobRunning/);
	await app.advance(15000); assert.equal(calls, 4); assert.equal(collect(app.deep).some((node) => node.props.className === "gt_ciSpinner"), false);
	await app.advance(59999); assert.equal(calls, 4);
	await app.advance(1); assert.equal(calls, 5); assert.match(text(app.deep), /HEAD bbbbbbbbbbbb/);
	assert.equal(app.keys.some((key) => key.includes("git.auth") || key.startsWith("POST")), false);
	assert.match(source, /prefers-reduced-motion: reduce/);
});
await check("CI polling never overlaps requests or blanks the phases while updating", async () => {
	let calls = 0, finish;
	const app = mount({ onCI: () => ++calls === 1 ? reply(liveResult("running"))() : new Promise((resolve) => { finish = resolve; }) });
	await app.settle(); await app.click(app.deep, "CI");
	await app.advance(15000); assert.equal(calls, 2); assert.match(text(app.deep), /Checking CI/); assert.match(text(app.deep), /Live phase/);
	await app.advance(60000); assert.equal(calls, 2);
	finish(await reply(liveResult("success"))()); await app.settle(); assert.match(text(app.deep), /Live jobPassed/); assert.equal(text(app.deep).includes("Checking CI"), false);
});
await check("hidden browser pages pause CI polling and resume with an immediate check", async () => {
	let calls = 0;
	const app = mount({ onCI: () => { calls++; return reply(liveResult("running"))(); } });
	await app.settle(); await app.click(app.deep, "CI"); await app.visibility("hidden");
	assert.equal(timers.size, 0); await app.advance(120000); assert.equal(calls, 1);
	await app.visibility("visible"); assert.equal(calls, 2); await app.advance(15000); assert.equal(calls, 3);
});
await check("window blur pauses CI and refocusing replaces the timer without starting duplicate loops", async () => {
	let calls = 0;
	const app = mount({ onCI: () => { calls++; return reply(liveResult("running"))(); } });
	await app.settle(); await app.click(app.deep, "CI"); await app.advance(5000);
	await app.focus(false); assert.equal(timers.size, 0);
	await app.advance(120000); assert.equal(calls, 1);
	await app.focus(true); assert.equal(calls, 2); assert.equal(timers.size, 2);
	await app.advance(5000); await app.focus(true); assert.equal(calls, 3); assert.equal(timers.size, 2);
	await app.advance(10000); assert.equal(calls, 3);
	await app.advance(5000); assert.equal(calls, 4); assert.equal(timers.size, 2);
	app.driver.unmount(); assert.equal(focusListeners.focus.size, 0); assert.equal(focusListeners.blur.size, 0);
});
await check("window blur aborts a pending CI request and focus resumes after its late response", async () => {
	let calls = 0, finish, request;
	const app = mount({ onCI: (value) => { calls++; request = value; return calls === 1 ? new Promise((resolve) => { finish = resolve; }) : reply(liveResult("success"))(); } });
	await app.settle(); await app.click(app.deep, "CI"); await app.focus(false);
	assert.equal(request.init.signal.aborted, true);
	await app.focus(true); assert.equal(calls, 1);
	finish(await reply(liveResult("failure"))()); await app.settle();
	assert.equal(text(app.deep).includes("Live jobFailed"), false);
	await app.advance(0); assert.equal(calls, 2); assert.match(text(app.deep), /Live jobPassed/);
});
await check("hiding a page aborts in-flight CI and ignores the late response", async () => {
	let calls = 0, finish, request;
	const app = mount({ onCI: (value) => { calls++; request = value; return calls === 1 ? new Promise((resolve) => { finish = resolve; }) : reply(liveResult("success"))(); } });
	await app.settle(); await app.click(app.deep, "CI"); await app.visibility("hidden"); assert.equal(request.init.signal.aborted, true);
	finish(await reply(liveResult("failure"))()); await app.settle(); assert.equal(text(app.deep).includes("Live jobFailed"), false); assert.equal(timers.size, 0);
	await app.visibility("visible"); assert.equal(calls, 2); assert.match(text(app.deep), /Live jobPassed/);
});
await check("closed sidebars stop polling, but other views retain the live CI badge without checking auth", async () => {
	let calls = 0;
	const app = mount({ tabVisible: false, onCI: () => { calls++; return reply(liveResult("running"))(); } });
	await app.settle(); assert.equal(calls, 0); assert.equal(app.keys.length, 0);
	await app.tabVisibility(true); await app.click(app.deep, "CI"); assert.equal(calls, 1);
	const request = app.requests.find(({ key }) => key === "GET api/git.ci");
	await app.tabVisibility(false); assert.equal(request.init.signal.aborted, true); assert.equal(timers.size, 0);
	await app.advance(120000); assert.equal(calls, 1);
	await app.tabVisibility(true); assert.equal(calls, 2);
	await app.click(app.deep, "Changes"); assert.equal(timers.size, 2); assert.equal(visibilityListeners.size, 2);
	await app.advance(120000); assert.equal(calls, 3);
	await app.click(app.deep, "CI"); assert.equal(calls, 3);
	app.driver.unmount(); assert.equal(timers.size, 0); assert.equal(visibilityListeners.size, 0);
	assert.equal(app.keys.includes("GET api/git.auth"), false);
});
await check("CI transport failures mark old results stale, back off and recover automatically", async () => {
	let calls = 0;
	const app = mount({ onCI: () => { if (++calls === 2) throw new Error("offline"); return reply(liveResult(calls === 1 ? "success" : "running"))(); } });
	await app.settle(); await app.click(app.deep, "CI");
	await app.advance(60000); assert.equal(calls, 2); assert.match(text(app.deep), /showing the previous result/); assert.match(text(app.deep), /Live phase/);
	await app.advance(59999); assert.equal(calls, 2);
	await app.advance(1); assert.equal(calls, 3); assert.equal(text(app.deep).includes("showing the previous result"), false); assert.match(text(app.deep), /Live jobRunning/);
	await app.advance(15000); assert.equal(calls, 4);
});
await check("failed CI still polls quickly while another job is running, but API failures back off", async () => {
	let calls = 0;
	const app = mount({ onCI: () => reply(++calls === 1 ? { ...liveResult("failure"), checks: [{ name: "test", state: "running" }] } : { kind: "failed", code: "forbidden" })() });
	await app.settle(); await app.click(app.deep, "CI"); await app.advance(15000); assert.equal(calls, 2); assert.match(text(app.deep), /Access denied/);
	await app.advance(59999); assert.equal(calls, 2); await app.advance(1); assert.equal(calls, 3);
});
await check("Actions detail rate limits and denied permissions slow polling even for active jobs", async () => {
	for (const stepsError of ["rate-limit", "forbidden"]) {
		let calls = 0;
		const app = mount({ onCI: () => { calls++; return reply({ ...liveResult("running"), checks: [{ name: "test", state: "running", stepsError }] })(); } });
		await app.settle(); await app.click(app.deep, "CI"); await app.advance(10000); assert.equal(calls, 1);
		await app.advance(50000); assert.equal(calls, 2);
	}
});
await check("session switches cancel old CI and cannot publish its late result into the new session", async () => {
	let calls = 0, finish;
	const app = mount({ onCI: () => ++calls === 1 ? new Promise((resolve) => { finish = resolve; }) : reply(liveResult("success", "b".repeat(40)))() });
	await app.settle(); await app.click(app.deep, "CI");
	const previous = app.requests.find(({ key }) => key === "GET api/git.ci");
	await app.switchSession("session-2"); assert.equal(previous.init.signal.aborted, true);
	const current = app.requests.filter(({ key }) => key === "GET api/git.ci").at(-1);
	assert.equal(new URL(current.url, "https://host/").searchParams.get("sessionId"), "session-2");
	finish(await reply(liveResult("failure"))()); await app.settle();
	assert.match(text(app.deep), /HEAD bbbbbbbbbbbb/); assert.equal(text(app.deep).includes("Live jobFailed"), false); assert.equal(calls, 2);
});
await check("switching remotes refetches CI and clears the previous authentication result", async () => {
	const app = mount(); await app.settle(); await app.click(app.deep, "CI"); await app.click(app.deep, "Check gh authentication");
	const select = collect(app.deep).find((node) => node.type === "select"); select.props.onChange({ target: { value: "upstream" } }); await app.settle();
	assert.equal(app.requests.find(({ key }) => key === "GET api/git.ci").init.signal.aborted, true);
	const request = app.requests.filter(({ key }) => key === "GET api/git.ci").at(-1);
	assert.equal(new URL(request.url, "https://host/").searchParams.get("remote"), "upstream");
	const button = primitivesNamed(app.deep, "Button").find((node) => text(node) === "Check gh authentication");
	assert.match(button.props.title, /Authentication has not been checked/); assert.equal(text(app.deep).includes("Account: Fixture"), false);
	assert.equal(collect(app.deep).some((node) => node.props.className === "gt_connection"), false);
});
await check("CI absence, failures and partial results are not rendered as successful checks", async () => {
	for (const [ci, expected] of [[{ kind: "no-remote", remotes: [] }, "No Git remote"], [{ kind: "failed", code: "forbidden" }, "Access denied"], [{ kind: "ready", state: "none", checks: [] }, "No CI results"], [{ kind: "ready", state: "unknown", partial: true, checks: [] }, "Results are incomplete"]]) {
		const app = mount({ ci }); await app.settle(); await app.click(app.deep, "CI"); assert.equal(text(app.deep).includes(expected), true);
	}
});
await check("a repository without remotes still offers a github.com gh authentication check", async () => {
	const app = mount({ ci: { kind: "no-remote", remotes: [] }, auth: { kind: "ready", login: "Fixture", access: "account-verified" } });
	await app.settle(); await app.click(app.deep, "CI"); await app.click(app.deep, "Check gh authentication");
	assert.match(text(app.deep), /github\.com authentication verified \(no remote configured\)/);
});
const searchField = (tree) => collect(tree).find((node) => node.type === "input" && node.props.type === "search");
const commitField = (tree) => collect(tree).find((node) => node.type === "input" && node.props.type !== "search");
await check("Changes follows external edits while preserving draft, filters and folder state", async () => {
	let value = STATUS;
	const app = mount({ onStatus: () => reply(value)() }); await app.settle();
	commitField(app.deep).props.onChange({ target: { value: "Keep my draft" } });
	await app.click(app.deep, "Collapse all");
	value = { ...STATUS, branch: "external-branch", changed: 2 };
	await app.advance(3000);
	assert.match(text(app.deep), /external-branch.*2 changed/);
	assert.equal(commitField(app.deep).props.value, "Keep my draft");
	assert.ok(button(app.deep, "Expand all"));
	assert.equal(app.keys.filter((key) => key === "GET api/git.tree").length, 2);
	await app.visibility("hidden"); await app.advance(120000);
	assert.equal(app.keys.filter((key) => key === "GET api/git.tree").length, 2);
	await app.visibility("visible");
	assert.equal(app.keys.filter((key) => key === "GET api/git.tree").length, 3);
});
await check("Changes requests never overlap and stale responses cannot overwrite a mutation", async () => {
	let calls = 0, finish, request;
	const app = mount({ onStatus: (value) => ++calls === 1 ? reply(STATUS)() : new Promise((resolve) => { finish = resolve; request = value; }) });
	await app.settle(); await app.advance(3000); await app.advance(3000);
	assert.equal(calls, 2); assert.match(text(app.deep), /3 changed/);
	await app.click(app.deep, "Stage all"); assert.equal(request.init.signal.aborted, true);
	finish(await reply({ ...STATUS, branch: "obsolete" })()); await app.settle();
	assert.doesNotMatch(text(app.deep), /obsolete/); assert.match(text(app.deep), /1 changed/);
});
await check("Changes keeps a failed refresh visible and recovers after backoff", async () => {
	let calls = 0;
	const app = mount({ onStatus: () => { if (++calls === 2) throw new Error("offline"); return reply(STATUS)(); } });
	await app.settle(); await app.advance(3000);
	assert.match(text(app.deep), /Changes could not be refreshed/); assert.ok(row(app.deep, "src/a.js"));
	await app.advance(3000); assert.equal(calls, 2);
	await app.advance(57000); assert.equal(calls, 3); assert.doesNotMatch(text(app.deep), /Changes could not/);
});
await check("changing workspace cancels old status and loads the new repository", async () => {
	let calls = 0, finish, oldRequest;
	const app = mount({ onStatus: (request) => ++calls === 1 ? new Promise((resolve) => { finish = resolve; oldRequest = request; }) : reply({ ...STATUS, branch: "new-repository" })() });
	await app.settle(); await app.switchCwd("/other");
	assert.equal(oldRequest.init.signal.aborted, true);
	finish(await reply({ ...STATUS, branch: "old-repository" })()); await app.settle();
	assert.match(text(app.deep), /new-repository/); assert.doesNotMatch(text(app.deep), /old-repository/);
});
await check("path filtering reveals matching folders without changing commit counts or bulk actions", async () => {
	const app = mount(); await app.settle(); await app.click(app.deep, "Collapse all");
	searchField(app.deep).props.onChange({ target: { value: "SRC/A" } }); await app.settle();
	assert.ok(row(app.deep, "src/a.js")); assert.equal(row(app.deep, "staged.txt"), undefined);
	assert.match(text(app.deep), /1 staged/); assert.equal(button(app.deep, "Unstage all").props.disabled, false);
	await app.click(app.deep, "Collapse all"); assert.equal(row(app.deep, "src/a.js"), undefined);
	searchField(app.deep).props.onKeyDown({ key: "Escape", preventDefault() {} }); await app.settle();
	assert.ok(button(app.deep, "Expand all")); assert.ok(row(app.deep, "staged.txt"));
	searchField(app.deep).props.onChange({ target: { value: "not present" } }); await app.settle();
	assert.match(text(app.deep), /No matches/); assert.doesNotMatch(text(app.deep), /Working tree clean/);
	await app.click(app.deep, "Stage all");
	assert.deepEqual(app.requests.findLast((request) => request.key === "POST api/git.mutate").body, { action: "stage-all" });
});
await check("history and branch filters stay independent, and filtered history draws no false edges", async () => {
	const app = mount(); await app.settle(); await app.click(app.deep, "History");
	searchField(app.deep).props.onChange({ target: { value: "AAAA111" } }); await app.settle();
	assert.match(text(app.deep), /feat: newest/); assert.doesNotMatch(text(app.deep), /fix: middle/);
	assert.equal(collect(app.deep).filter((node) => node.type === "svg" && node.props.className !== "gt_ciStatusIcon").length, 0);
	await app.click(app.deep, "Branches"); assert.equal(searchField(app.deep).props.value, "");
	searchField(app.deep).props.onChange({ target: { value: "nonexistent" } }); await app.settle(); assert.match(text(app.deep), /No matches/);
	await app.click(app.deep, "History"); assert.equal(searchField(app.deep).props.value, "AAAA111");
	searchField(app.deep).props.onKeyDown({ key: "Escape", preventDefault() {} }); await app.settle(); assert.match(text(app.deep), /fix: middle/);
});
await check("an open working diff follows edits but a closed diff ignores late responses", async () => {
	let calls = 0, finish, request;
	const app = mount({ onDiff: (value) => {
		calls++;
		if (calls < 3) return reply(calls === 1 ? DIFF : { ...DIFF, text: "@@ -1 +1 @@\n-old\n+external edit\n" })();
		return new Promise((resolve) => { finish = resolve; request = value; });
	} });
	await app.settle(); row(app.deep, "src/a.js").props.onClick(); await app.settle();
	await app.advance(3000); assert.equal(calls, 2); assert.match(patchText(app.driver.tree), /external edit/);
	await app.advance(3000); assert.equal(calls, 3); assert.match(patchText(app.driver.tree), /external edit/);
	const pane = collect(app.deep).find((node) => node.props.className === "gt_pane");
	await app.click(pane, "Close"); assert.equal(request.init.signal.aborted, true);
	finish(await reply(DIFF)()); await app.settle(); assert.equal(collect(app.deep).some((node) => node.props.className === "gt_pane"), false);
});
await check("diff resize supports bounded keyboard and pointer input, hunks scroll and focus locally", () => {
	const raw = "@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d\n";
	let height, hunk, captured = false, scrolled = [], focused = [];
	const targets = [0, 1].map((index) => ({ scrollIntoView() { scrolled.push(index); }, focus() { focused.push(index); } }));
	const pane = internals.diffPane({ phase: "ready", value: { text: raw } }, t, () => {}, undefined, { height: 55, onResize: (value) => { height = value; }, hunk: 0, onHunk: (value) => { hunk = value; } });
	const separator = collect(pane).find((node) => node.props.role === "separator");
	separator.props.onKeyDown({ key: "ArrowUp", preventDefault() {} }); assert.equal(height, 60);
	separator.props.onKeyDown({ key: "Home", preventDefault() {} }); assert.equal(height, 20);
	const handle = { setPointerCapture() { captured = true; }, hasPointerCapture() { return captured; }, releasePointerCapture() { captured = false; }, closest() { return { getBoundingClientRect: () => ({ height: 500, bottom: 500 }) }; } };
	separator.props.onPointerDown({ currentTarget: handle, pointerId: 1, preventDefault() {} });
	separator.props.onPointerMove({ currentTarget: handle, pointerId: 1, clientY: -500 }); assert.equal(height, 80);
	separator.props.onPointerMove({ currentTarget: handle, pointerId: 1, clientY: 490 }); assert.equal(height, 20);
	separator.props.onPointerUp({ currentTarget: handle, pointerId: 1 }); assert.equal(captured, false);
	collect(pane).find((node) => node.props["aria-label"] === "Next hunk").props.onClick({ currentTarget: { closest: () => ({ querySelectorAll: () => targets }) } });
	assert.equal(hunk, 1); assert.deepEqual(scrolled, [1]); assert.deepEqual(focused, [1]);
});
await check("CI badge stays live outside CI and opens the current result", async () => {
	let calls = 0;
	const app = mount({ onCI: () => reply(liveResult(++calls === 1 ? "running" : "failure"))() }); await app.settle();
	assert.ok(button(app.deep, "CIRunning")); await app.advance(15000); assert.ok(button(app.deep, "CIFailed"));
	await app.click(app.deep, "CIFailed"); assert.match(text(app.deep), /Live jobFailed/); assert.match(text(app.deep), /Last checked:/);
});
await check("CI opens important phases by default and preserves manual folding across polls", async () => {
	const value = { kind: "ready", sha: "a", state: "running", checks: [{ name: "passed", state: "success", steps: [] }, { name: "active", state: "running", steps: [{ number: 1, name: "test", state: "running" }] }] };
	const app = mount({ ci: value }); await app.settle(); await app.click(app.deep, "CI");
	let details = collect(app.deep).filter((node) => node.props.className === "gt_ciSteps");
	assert.equal(details[0].props.open, false); assert.equal(details[1].props.open, true);
	details[1].props.onToggle({ currentTarget: { open: false } }); await app.settle();
	await app.advance(15000); details = collect(app.deep).filter((node) => node.props.className === "gt_ciSteps"); assert.equal(details[1].props.open, false);
	let scrolled = false, focused = false;
	const domDetails = { open: false }, step = { dataset: { step: "1" }, scrollIntoView() { scrolled = true; }, focus() { focused = true; } };
	button(app.deep, "Go to active / failed phase").props.onClick({ currentTarget: { closest: () => ({ querySelector: () => domDetails, querySelectorAll: () => [step] }) } });
	await app.settle(); assert.equal(domDetails.open, true); assert.equal(scrolled && focused, true);
	assert.equal(collect(app.deep).filter((node) => node.props.className === "gt_ciSteps")[1].props.open, true);
});
await check("Ask AI supplies job or failed-phase context without sending a model request", async () => {
	const drafts = [];
	const app = mount({ ci: liveResult("failure"), askAI: (sessionId, prompt) => { drafts.push({ sessionId, prompt }); return true; } });
	await app.settle(); await app.click(app.deep, "CI");
	const asks = collect(app.deep).filter((node) => node.type === primitives.Button && text(node) === "Ask AI");
	assert.equal(asks.length, 2); asks[0].props.onClick(); asks[1].props.onClick();
	assert.equal(drafts[0].sessionId, "session-1"); assert.match(drafts[0].prompt, /not logs or instructions/);
	assert.match(drafts[0].prompt, /"phases":/); assert.match(drafts[1].prompt, /"phase":/); assert.match(drafts[1].prompt, /Live phase/);
	assert.equal(app.keys.some((key) => key.startsWith("POST")), false);
	const blocked = mount({ askAI: () => false }); await blocked.settle(); await blocked.click(blocked.deep, "CI"); await blocked.click(blocked.deep, "Ask AI"); assert.match(text(blocked.deep), /Cannot insert into the chat draft/);
});
await check("split hunks align unequal edits, preserve context numbers, and keep EOF notes on the right side", () => {
	const hunk = { oldStart: 10, newStart: 20, lines: [" same", "-old one", "-old two", "\\ No newline at end of file", "+new", "\\ No newline at end of file", " tail", "+added"] };
	const rows = internals.splitHunk(hunk);
	assert.deepEqual(JSON.parse(JSON.stringify(rows.map((row) => row.map((cell) => cell && [cell.number, cell.text])))), [
		[[10, "same"], [20, "same"]], [[11, "old one"], [21, "new"]], [[12, "old two"], null], [[13, "tail"], [22, "tail"]], [null, [23, "added"]]
	]);
	assert.match(rows[2][0].note, /No newline/); assert.match(rows[1][1].note, /No newline/);
	assert.equal(rows[1][0].note, undefined); assert.equal(rows[3][1].index, 2);
	const pureDelete = internals.splitHunk({ oldStart: 1, newStart: 0, lines: ["-a", "-b"] });
	assert.equal(pureDelete.every((row) => row[1] === null), true);
});
await check("side by side reuses syntax highlighting, keeps empty cells and exactly one navigation target per hunk", () => {
	const hunk = internals.patchParts("@@ -1,2 +1 @@\n-old\n-extra\n+new\n", "code.js")[0];
	const tree = [0, 1].map((side) => renderDeep(internals.PatchHunk({ hunk, side, t })));
	const nodes = collect(tree);
	assert.equal(nodes.filter((node) => node.props["data-hunk"]).length, 1);
	assert.equal(nodes.filter((node) => node.props["data-empty"] === true).length, 1);
	assert.ok(nodes.some((node) => node.props.className === "gt_patchLine gt_patchAdd"));
	assert.equal(nodes.filter((node) => node.props.className === "gt_patchLine gt_patchDelete").length, 2);
	assert.match(text(tree), /old/); assert.match(text(tree), /new/);
	assert.ok(highlights.some((entry) => JSON.stringify(entry).includes("old\\nextra")));
});
await check("automatic layout follows pane width, explicit choice persists and both layouts copy the original patch", async () => {
	savedPreferences.clear();
	const app = mount({ paneWidth: 340 }); await app.settle(); row(app.deep, "src/a.js").props.onClick(); await app.settle();
	const patch = () => collect(app.deep).find((node) => node.props.className === "gt_patch");
	assert.equal(patch().props["data-layout"], "unified"); await app.resize(900); assert.equal(patch().props["data-layout"], "split");
	await app.click(app.deep, "Unified"); await app.resize(1200); assert.equal(patch().props["data-layout"], "unified");
	await app.click(app.deep, "Side by side"); await app.resize(280); assert.equal(patch().props["data-layout"], "split");
	assert.equal(savedPreferences.get("dsh-gitview.diff-layout"), "split");
	const next = mount(); await next.settle(); row(next.deep, "src/a.js").props.onClick(); await next.settle();
	assert.equal(button(next.deep, "Side by side").props["aria-pressed"], true);
	for (const layout of ["split", "unified"]) {
		let copied;
		const pane = internals.diffPane({ phase: "ready", value: DIFF }, t, () => {}, undefined, { layout, onCopy: (text) => { copied = text; } });
		button(pane, "Copy").props.onClick(); assert.equal(copied, DIFF.text);
	}
	next.driver.unmount(); assert.equal(resizeObservers.size, 0); savedPreferences.clear();
});
await check("invalid or blocked stored layout preferences safely fall back to automatic", async () => {
	savedPreferences.set("dsh-gitview.diff-layout", "unknown");
	let app = mount(); await app.settle(); row(app.deep, "src/a.js").props.onClick(); await app.settle(); assert.equal(button(app.deep, "Auto").props["aria-pressed"], true);
	const storage = sandbox.window.localStorage;
	sandbox.window.localStorage = { getItem() { throw new Error("disabled"); }, setItem() { throw new Error("disabled"); } };
	try { app = mount(); await app.settle(); row(app.deep, "src/a.js").props.onClick(); await app.settle(); await app.click(app.deep, "Side by side"); assert.equal(button(app.deep, "Side by side").props["aria-pressed"], true); }
	finally { sandbox.window.localStorage = storage; savedPreferences.clear(); }
});
await check("old unfinished checks get a warning, never a success or permanent spinner, and polling slows", async () => {
	const stale = { name: "Cloudflare Pages", state: "running", source: "external", startedAt: new Date(Date.now() - 48 * 3600000).toISOString() };
	const value = { kind: "ready", state: "running", checks: [{ name: "test", state: "success", source: "actions" }, stale], groups: [{ source: "actions", state: "success", count: 1 }, { source: "external", state: "running", count: 1 }] };
	let calls = 0;
	const app = mount({ onCI: () => { calls++; return reply(value)(); } }); await app.settle(); await app.click(app.deep, "CI");
	assert.match(text(app.deep), /ActionsPassed/); assert.match(text(app.deep), /External checksLong-running \/ unconfirmed/);
	assert.match(text(app.deep), /Unfinished for 48h/); assert.equal(collect(app.deep).some((node) => node.props.className === "gt_ciSpinner"), false);
	assert.equal(value.state, "running"); assert.equal(stale.state, "running");
	await app.advance(15000); assert.equal(calls, 1); await app.advance(45000); assert.equal(calls, 2);
});
await check("stale detection requires a real start time and does not hide fresh work or failures", () => {
	const now = Date.now();
	const old = { state: "running", startedAt: new Date(now - 24 * 3600000).toISOString() };
	assert.equal(internals.ciOverdue(old, now), true);
	assert.equal(internals.ciOverdue(old, now - 1), false);
	for (const startedAt of [null, "not a date", new Date(now + 3600000).toISOString()]) assert.equal(internals.ciOverdue({ state: "running", startedAt }, now), false);
	assert.equal(internals.ciOverdue({ ...old, state: "success" }, now), false);
	assert.equal(internals.ciDisplayState("running", [old, { state: "pending" }], now), "running");
	assert.equal(internals.ciDisplayState("failure", [old, { state: "failure" }], now), "failure");
	assert.equal(internals.ciInterval({ kind: "ready", state: "running", checks: [old, { state: "pending" }] }), 15000);
});
await check("split panes synchronize horizontal scroll, clamp short sides, and ignore mirrored scroll events", () => {
	const pane = internals.diffPane({ phase: "ready", value: DIFF }, t, () => {}, undefined, { layout: "split" });
	const sides = collect(pane).filter((node) => node.props.className === "gt_splitSide");
	assert.equal(sides.length, 2);
	const left = { dataset: {}, scrollLeft: 150, scrollWidth: 500, clientWidth: 200 };
	const right = { dataset: {}, scrollLeft: 0, scrollWidth: 250, clientWidth: 200 };
	left.parentElement = right.parentElement = { children: [left, right] };
	sides[0].props.onScroll({ currentTarget: left }); assert.equal(right.scrollLeft, 50);
	sides[1].props.onScroll({ currentTarget: right }); assert.equal(left.scrollLeft, 150);
	right.scrollLeft = 20; sides[1].props.onScroll({ currentTarget: right }); assert.equal(left.scrollLeft, 20);
});
console.log(`\nPASS  ${passed} checks`);
