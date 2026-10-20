// @ts-nocheck -- moved verbatim from the hand-written bundle; type it when it is next changed.


/**
 * How each git state is painted: a short letter and the colour its row's index
 * letters take. Kept beside the dictionary so a state with no entry degrades to
 * a neutral colour instead of throwing.
 */
export const STATES = {
	added: { letter: "A", dot: "done", tone: "success" },
	modified: { letter: "M", dot: "warning", tone: "warning" },
	deleted: { letter: "D", dot: "error", tone: "danger" },
	renamed: { letter: "R", dot: "ongoing", tone: "info" },
	copied: { letter: "C", dot: "ongoing", tone: "info" },
	typechange: { letter: "T", dot: "warning", tone: "warning" },
	conflicted: { letter: "U", dot: "error", tone: "danger" },
	untracked: { letter: "?", dot: "idle", tone: "neutral" },
	ignored: { letter: "!", dot: "idle", tone: "neutral" }
};
export const stateOf = (name) => STATES[name] ?? { letter: "•", dot: "idle", tone: "neutral" };

/** The five views, in tab order. */
export const VIEWS = ["status", "history", "branches", "blame", "reflog", "ci"];

/**
 * The Status view's sections, in the order they are drawn.
 *
 * A file dirty on BOTH sides of the index appears in both Staged and Unstaged,
 * because both actions are meaningful for it. Conflicts and untracked files
 * are held out of those two and given their own section instead, so every
 * changed file is accounted for exactly once — except that deliberate pair.
 *
 * Conflicts are excluded from Staged rather than counted in it because git
 * refuses to commit while the index holds unmerged entries: keeping them
 * separate is what makes "Commit" mean "commit what is resolved".
 */
export const GROUPS = [
	// `actions` is the section's, not the file's: a file dirty on both sides
	// appears in two sections, and each one offers the action that belongs to
	// the side it is showing. Offering both everywhere would put "Stage" on
	// something already staged.
	{ id: "conflicted", tone: "danger", actions: ["stage"], keep: (node) => node.state === "conflicted" },
	{ id: "staged", tone: "success", actions: ["unstage"], keep: (node) => node.staged === true && node.state !== "conflicted" },
	{
		id: "unstaged",
		tone: "warning",
		actions: ["stage"],
		keep: (node) => node.unstaged === true && node.state !== "untracked" && node.state !== "conflicted"
	},
	{ id: "untracked", tone: "neutral", actions: ["stage"], keep: (node) => node.state === "untracked" }
];

/** Mutation rejections, mapped to dictionary keys with one shared fallback. */
export const REJECTIONS = {
	"unknown-action": "rejected.unknown-action",
	"no-paths": "rejected.no-paths",
	"empty-message": "rejected.empty-message",
	"invalid-path": "rejected.invalid-path",
	"invalid-rev": "rejected.invalid-rev",
	"invalid-body": "rejected.invalid-body"
};

/** Reflog actions that begin with this are the rebase trail worth spotting. */
export const REBASE_ACTION_PREFIX = "rebase";

/** Width of one lane of the history graph, in pixels. */
export const LANE_W = 10;
/**
 * Vertical coordinate space a lane slice is drawn in. Abstract, not pixels: the
 * slice is stretched to whatever height its row turns out to be.
 *
 * Pinning a row to a height we choose does not work here. A row is two lines
 * tall, and one of those lines holds ref badges drawn by the shell, whose font
 * and padding decide its height — so any row height we pick either leaves gaps
 * between lanes (a slice drawn `0 .. span` inside a taller row reads as a
 * dashed graph) or clips the badges. Stretching removes the question: a slice
 * spans its own row exactly, whatever that row's height turns out to be.
 */
export const LANE_SPAN = 100;
/** Left inset of the graph column, and its minimum width. */
export const LANE_INSET = 4;
/**
 * How far a slice reaches past its own row, in pixels.
 *
 * A stroke centred on the row's edge is half clipped by the SVG viewport, which
 * at 1px is a hairline of background between two rows — enough to read as
 * broken. Overlapping the neighbours hides it, and since the overlaps paint the
 * same colour at the same opacity, they are invisible.
 */
export const LANE_BLEED = 1;

/**
 * Walk the tree depth-first and emit one row per node that is visible.
 *
 * The Host sends the whole tree every time; which directories are open is
 * browser-only viewing state, so it stays here and never costs a round trip.
 *
 * @param node - the current node.
 * @param collapsed - directory paths that are closed.
 * @param depth - indentation level.
 * @param rows - the accumulator.
 */
export function flatten(node, collapsed, depth, rows, keyOf = (path) => path) {
	for (const child of node.children ?? []) {
		const isDir = child.type === "dir";
		// The key, not the path, decides collapse: the same directory appears in
		// several sections, and closing it in one must not close it in another.
		const open = isDir && !collapsed.has(keyOf(child.path));
		rows.push({ node: child, depth, isDir, open });
		if (isDir && open) flatten(child, collapsed, depth + 1, rows, keyOf);
	}
	return rows;
}

/** Every directory path in the tree, for "collapse all". */
export function directoryPaths(node, into = []) {
	for (const child of node.children ?? []) {
		if (child.type !== "dir") continue;
		into.push(child.path);
		directoryPaths(child, into);
	}
	return into;
}

/** Counts as a short, stable string: `3M 1A 2?`. */
export function countsText(counts) {
	return Object.entries(counts ?? {})
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([state, n]) => `${n}${stateOf(state).letter}`)
		.join(" ");
}

/**
 * A sub-tree holding only the files a predicate accepts.
 *
 * The Host sends ONE tree, with staged and unstaged files mixed together; the
 * Status view's sections are that tree filtered four ways, so the grouping
 * costs no extra request and reacts instantly when a mutation hands back a
 * fresh status. Directories are rebuilt from the surviving paths and their
 * badges recomputed, so a section header's count is the count of its own rows.
 *
 * Child order needs no re-sorting: the traversal follows the Host's sorted
 * tree, so a directory is created by the first file seen under it and files
 * and subdirectories land in the order git's own sort put them in.
 *
 * @param tree - the whole working-tree tree.
 * @param keep - decides whether one file node belongs in this section.
 */
export function sliceTree(tree, keep) {
	const root = { type: "dir", name: tree?.name ?? "", path: tree?.path ?? "", children: [], counts: {}, total: 0 };
	const built = new Map([["", root]]);

	/** Walk (and create) the directories of one path, returning root-first. */
	const chainFor = (segments) => {
		const chain = [root];
		let current = root;
		let path = "";
		for (const segment of segments) {
			path = path === "" ? segment : `${path}/${segment}`;
			let node = built.get(path);
			if (node === undefined) {
				node = { type: "dir", name: segment, path, children: [], counts: {}, total: 0 };
				built.set(path, node);
				current.children.push(node);
			}
			chain.push(node);
			current = node;
		}
		return chain;
	};

	for (const row of flatten(tree ?? { children: [] }, new Set(), 0, [])) {
		if (row.isDir || !keep(row.node)) continue;
		const segments = row.node.path.split("/");
		const name = segments.pop();
		const chain = chainFor(segments);
		chain[chain.length - 1].children.push({ ...row.node, name });
		for (const node of chain) {
			node.counts[row.node.state] = (node.counts[row.node.state] ?? 0) + 1;
			node.total += 1;
		}
	}
	return root;
}

/** Immutable Set toggle, so React sees a new reference. */
export function toggle(current, path) {
	const next = new Set(current);
	if (next.has(path)) next.delete(path);
	else next.add(path);
	return next;
}

