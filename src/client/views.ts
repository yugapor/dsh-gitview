// @ts-nocheck -- moved verbatim from the hand-written bundle; type it when it is next changed.
import { primitives, h } from "./deps";
import { GROUPS, LANE_INSET, LANE_W, REBASE_ACTION_PREFIX, countsText, directoryPaths, flatten, sliceTree, stateOf, toggle } from "./model";
import { branchColor, colorGraph, laneGutter } from "./graph";
import { placeholder } from "./chrome";

/** The commit message box and its button. */
export function identityDetails(identity, t) {
	const label = (value) => value?.kind === "ready" ? `${value.name} <${value.email}>` : t(value?.kind === "unavailable" ? "identity.unavailable" : "identity.failed");
	const config = identity?.config;
	const configLabel = (value) => value?.kind === "set" ? `${value.value}\n${value.scope} · ${value.origin}` : t(value?.kind === "unset" ? "identity.unset" : "identity.failed");
	const overridden = identity?.author?.kind === "ready" && (config?.name?.value !== identity.author.name || config?.email?.value !== identity.author.email);
	return h("details", { key: "identity", className: "gt_identity" },
		h("summary", null, `${t("identity.label")}: ${label(identity?.author)}`),
		h("dl", null,
			h("dt", null, "user.name"), h("dd", null, configLabel(config?.name)),
			h("dt", null, "user.email"), h("dd", null, configLabel(config?.email)),
			h("dt", null, t("identity.author")), h("dd", null, label(identity?.author)),
			h("dt", null, t("identity.committer")), h("dd", null, label(identity?.committer))),
		overridden ? h("p", { className: "gt_warning" }, t("identity.override")) : null,
		h("p", { className: "gt_note" }, t("identity.hint")));
}

export function commitBox({ staged, busy, generating, generatedModel, identity, message, setMessage, onCommit, onGenerate, t }) {
	// A conflict is not committable, so it is not counted here: the button means
	// "commit what is resolved", which is exactly what git will accept.
	const blocked = busy || generating || staged === 0 || message.trim() === "";
	const submit = () => {
		if (!blocked) onCommit(message.trim());
	};
	return h(
		"div",
		{ key: "commit", className: "gt_commit" },
		identityDetails(identity, t),
		h("div", { className: "gt_meta" }, t("stagedCount").replace("{n}", String(staged))),
		h(
			"div",
			{ className: "gt_commitRow" },
			h("input", {
				className: "gt_input",
			key: "message",
			type: "text",
			value: message,
			placeholder: t("commitPlaceholder"),
			"aria-label": t("commitMessage"),
			disabled: busy || generating,
			onChange: (event) => setMessage(event.target.value),
			onKeyDown: (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					submit();
				}
			},
				style: { flex: "1 1 180px" }
			}),
			h(primitives.Button, {
				key: "generate", variant: "ghost", size: "sm",
				disabled: busy || generating || staged === 0 || message.trim() !== "",
				title: t(message.trim() === "" ? "generateHint" : "generateNeedsEmpty"),
				onClick: () => { if (!busy && !generating && staged > 0 && message.trim() === "") onGenerate(); },
				children: t(generating ? "generatingMessage" : "generateMessage")
			}),
			h(primitives.Button, {
				key: "commit",
				variant: "primary",
				size: "sm",
				disabled: blocked,
				onClick: submit,
				children: busy ? t("busy") : t("commit")
			})
		),
		generatedModel ? h("div", { className: "gt_meta", role: "status" }, t("generatedWith").replace("{model}", generatedModel)) : null
	);
}

/**
 * Render one section's visible tree rows, with per-file staging.
 *
 * `prefix` is the section id: it namespaces the collapse keys, so the same
 * directory can be open in one section and closed in another.
 */
/**
 * How far one level of nesting is indented.
 *
 * The shipped Files explorer gets this from a nested list whose stylesheet adds
 * 18px per level; this tree is drawn flat (its rows carry their own depth), so the
 * same step is applied as padding. The number has to match that stylesheet: a
 * noticeably different step reads as a different product.
 */
export const INDENT = 18;

/**
 * One row's leading icon: a folder that opens and closes, or the file's own type.
 *
 * Both come from the shell's primitives, which is what makes a tree of source
 * files scannable at a glance — the shape and colour of the glyph carry the type
 * before any text is read.
 */
export function rowIcon({ node, isDir, open }) {
	if (!isDir) {
		return h(primitives.FileTypeIcon, {
			key: "icon",
			kind: primitives.classifyFileType(node.name),
			// The primitive's own default is 28; a tree row is 16.
			size: 16,
			className: "gt_fileIcon"
		});
	}
	return open
		? h(primitives.IconFolderOpenRegular, { key: "icon", className: "gt_icon" })
		: h(primitives.IconFolderCloseRegular, { key: "icon", className: "gt_icon" });
}

/**
 * The action buttons a section offers one row.
 *
 * The SECTION decides which action is offered, not the file: a file can be both
 * staged and unstaged, and then it appears in both sections. Offering the union
 * in each would offer an action that does not apply where the user clicked.
 */
export function rowActions({ node, actions, busy, t, onStage, onUnstage }) {
	const buttons = [];
	const offer = (action, label, run) => {
		if (!actions.includes(action)) return;
		buttons.push(
			h(primitives.Button, {
				key: action,
				variant: "ghost",
				size: "sm",
				disabled: busy,
				title: label,
				"aria-label": label,
				onClick: (event) => {
					// The row opens the patch; the button must not also do that.
					event.stopPropagation();
					run();
				},
				children: action === "stage" ? "+" : "−"
			})
		);
	};
	offer("stage", t("stage"), () => onStage(node.path));
	offer("unstage", t("unstage"), () => onUnstage(node.path));
	if (buttons.length === 0) return null;
	return h("span", { key: "actions", className: "gt_actions" }, ...buttons);
}

/**
 * Walk the tree depth-first and draw one row per visible node.
 *
 * Rows are `div`s carrying `role="button"` rather than real buttons because a file
 * row also holds its own Stage/Unstage buttons, and a button may not contain
 * another button. Keyboard handling is therefore explicit, and the row is the
 * focus target.
 *
 * @param tree - one section's tree, already sliced and recounted.
 * @param prefix - the section id, so two sections' collapse keys cannot collide.
 * @param actions - the actions this section offers its rows.
 * @param collapsed - the set of collapsed keys, browser-only viewing state.
 * @param setCollapsed - updates that set.
 * @param busy - whether a mutation is in flight.
 * @param t - namespace-bound translate.
 * @param onOpenDiff - opens one file's patch.
 * @param onStage - stages one path.
 * @param onUnstage - unstages one path.
 * @param selected - the open patch's path and scope, or undefined.
 */
export function treeRows({ tree, prefix, actions, collapsed, setCollapsed, busy, t, onOpenDiff, onStage, onUnstage, selected }) {
	const keyOf = (path) => `${prefix}:${path}`;
	const rows = flatten(tree, collapsed, 0, [], keyOf);

	return h(
		"div",
		{ key: "rows" },
		rows.map(({ node, depth, isDir, open }) => {
			const inset = depth === 0 ? undefined : { paddingLeft: 10 + depth * INDENT };
			// Named apart from the set helper on purpose: shadowing it here made the
			// closure call itself, which the render test caught as a stack overflow.
			const flip = () => setCollapsed((current) => toggle(current, keyOf(node.path)));
			const key = `${isDir ? "d" : "f"}:${node.path}`;
			const disclosure = h("span", { key: "disclosure", className: "gt_disclosure", "aria-hidden": true },
				isDir ? h("svg", { viewBox: "0 0 12 12", width: 12, height: 12, focusable: "false" },
					h("path", { d: "M4 2l4 4-4 4", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" })) : null);

			if (isDir) {
				return h(
					"div",
					{
						key,
						role: "button",
						tabIndex: 0,
						className: "gt_row",
						title: node.path,
						"aria-expanded": open,
						style: inset,
						onClick: flip,
						onKeyDown: (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								flip();
							}
						}
					},
					disclosure,
					rowIcon({ node, isDir, open }),
					h("span", { key: "name", className: "gt_name" }, node.name),
					h("span", { key: "counts", className: "gt_count" }, countsText(node.counts))
				);
			}

			// The letter pair is git's own `git status --short` encoding, so the row
			// says which side of the index changed without a legend. Its colour
			// carries the kind of change, which is what the removed badge used to
			// say in words.
			const state = stateOf(node.state);
			const scope = prefix === "staged" ? "index" : prefix === "unstaged" ? "worktree" : "head";
			const isSelected = selected?.path === node.path && selected.scope === scope;
			const stats = node.changes?.[prefix === "staged" ? "index" : "worktree"];
			const statLabel = stats == null || prefix === "conflicted" ? null : stats.binary ? t("binary") : t("lineChanges").replace("{added}", String(stats.added)).replace("{deleted}", String(stats.deleted));
			return h(
				"div",
				{
					key,
					role: "button",
					tabIndex: 0,
					className: "gt_row",
					title: `${node.path}\n${node.index}${node.worktree}${statLabel === null ? "" : `\n${statLabel}`}`,
					"aria-current": isSelected ? "true" : undefined,
					style: inset,
					onClick: () => onOpenDiff(node, scope),
					onKeyDown: (event) => {
						if (event.target !== event.currentTarget) return;
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							onOpenDiff(node, scope);
						}
					}
				},
				disclosure,
				rowIcon({ node, isDir, open }),
				h("span", { key: "name", className: "gt_name" }, node.name),
				node.origPath === null || node.origPath === undefined
					? null
					: h("span", { key: "orig", className: "gt_change gt_name", title: node.origPath }, `\u2190 ${node.origPath}`),
					statLabel === null ? null : h("span", { className: "gt_diffStat", title: statLabel },
						stats.binary ? statLabel : [h("span", { key: "added", className: "gt_success" }, `+${stats.added}`), h("span", { key: "deleted", className: "gt_danger" }, `−${stats.deleted}`)]),
				h("span", { key: "xy", className: `gt_change gt_${state.tone}` }, `${node.index}${node.worktree}`),
				rowActions({ node, actions, busy, t, onStage, onUnstage })
			);
		})
	);
}

export function changeSection({ section, t, collapsed, setCollapsed, busy, onOpenDiff, onStage, onUnstage, selected }) {
	return h(
		"div",
		{ key: section.id, className: "gt_group" },
		h(
			"div",
			{ className: "gt_section" },
			h("span", { key: "tag", className: `gt_${section.tone}` }, t(section.id)),
			h("span", { key: "n", className: "gt_count" }, String(section.tree.total))
		),
		treeRows({
			tree: section.tree,
			prefix: section.id,
			actions: section.actions,
			collapsed,
			setCollapsed,
			busy,
			t,
			onOpenDiff,
			onStage,
			onUnstage,
			selected
		})
	);
}

/**
 * The Status view: the changes grouped by side of the index, over a commit box.
 *
 * The groups are cut from the one tree the Host sent, so switching a file
 * between them costs no request — a mutation returns the fresh status and the
 * rows move immediately.
 */
export function StatusView({
	ready,
	collapsed,
	setCollapsed,
	busy,
	message,
	setMessage,
	generating,
	generatedModel,
	t,
	onOpenDiff,
	onStage,
	onUnstage,
	onCommit,
	onGenerate,
	onCommitAction,
	selected,
	filter = ""
}) {
	const sections = GROUPS.map((group) => ({
		id: group.id,
		tone: group.tone,
		actions: group.actions,
		tree: sliceTree(ready.tree, group.keep)
	})).filter((section) => section.tree.total > 0);
	const countOf = (id) => sections.find((section) => section.id === id)?.tree.total ?? 0;
	const staged = countOf("staged");
	const conflicted = countOf("conflicted");
	// Whether the index holds anything at all is git's question, not a section's:
	// an unmerged entry is in the index too, and "Unstage all" can clear it.
	const indexed = sliceTree(ready.tree, (node) => node.staged === true).total;
	const visible = filter ? sections.map((section) => ({ ...section, tree: sliceTree(section.tree, (node) => node.path.toLowerCase().includes(filter)) })).filter((section) => section.tree.total > 0) : sections;
	const collapseKeys = sections.flatMap((section) =>
		directoryPaths(section.tree).map((path) => `${section.id}:${path}`)
	);
	const allCollapsed = collapseKeys.length > 0 && collapseKeys.every((key) => collapsed.has(key));

	return h(
		"div",
		{ key: "status", style: { display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto", overflow: "auto" } },
		h(
			"div",
			{ className: "gt_toolbar" },
			h("div", { className: "gt_summary" }, t("changed").replace("{n}", String(ready.changed))),
			h(primitives.Button, {
				key: "stage-all",
				variant: "ghost",
				size: "sm",
				disabled: busy || ready.changed === 0,
				onClick: () => onCommitAction("stage-all"),
				children: t("stageAll")
			}),
			h(primitives.Button, {
				key: "unstage-all",
				variant: "ghost",
				size: "sm",
				disabled: busy || indexed === 0,
				onClick: () => onCommitAction("unstage-all"),
				children: t("unstageAll")
			}),
			h(primitives.Button, {
				key: "toggle",
				variant: "ghost",
				size: "sm",
				disabled: collapseKeys.length === 0,
				onClick: () => setCollapsed(allCollapsed ? new Set() : new Set(collapseKeys)),
				children: allCollapsed ? t("expandAll") : t("collapseAll")
			})
		),
		conflicted > 0
			? h("div", { key: "conflict", className: "gt_note" }, t("conflictHint"))
			: null,
		ready.truncated
			? h(
					"div",
					{ key: "truncated", className: "gt_note" },
					t("truncated").replace("{n}", String(ready.changed))
				)
			: null,
		h(
			"div",
			{ key: "list", className: "gt_body", style: { minHeight: 80 } },
			ready.changed === 0
				? h("div", { className: "gt_statusLine" }, t("clean"))
				: visible.length === 0 ? h("div", { className: "gt_statusLine" }, t("search.empty")) : visible.map((section) =>
						changeSection({
							section,
							t,
							collapsed,
							setCollapsed,
							busy,
							onOpenDiff,
							onStage,
							onUnstage,
							selected
						})
					)
		),
			commitBox({ staged, busy, generating, generatedModel, identity: ready.identity, message, setMessage, onCommit, onGenerate, t })
	);
}

/** Tags for a commit's refs, so a branch tip is visible in the graph. */
/**
 * Decoration kinds, mirroring `parseDecoration` in `lib/git.js`.
 *
 * Named rather than inlined so the tone below stays the first literal in its
 * property — the smoke test reads the paint vocabulary off the source.
 */
export const REF_HEAD = "head";
export const REF_TAG = "tag";

/** Tags for a commit's refs, so a branch tip is visible in the graph. */
export function refTags(refs, t) {
	return (refs ?? []).map((ref, index) =>
		h(
			primitives.Tag,
			{ key: `r${index}`, tone: ref.kind === REF_TAG ? "info" : "neutral" },
			ref.name === null || ref.kind === REF_TAG ? null : h("span", { className: "gt_refDot", "aria-hidden": "true", style: { background: branchColor(ref.name) } }),
			ref.kind === REF_HEAD && ref.name !== null ? `${ref.name} (HEAD)` : String(ref.name ?? "HEAD")
		)
	);
}

/**
 * The History view: the lane graph, with the base branch's ahead commits marked.
 *
 * The comparison against the base comes from the history payload itself, not
 * from the status: both list `main..HEAD`, and reading one count while marking
 * against the other is how they would come to disagree.
 */
/**
 * How long ago a commit landed, in the shell's own buckets.
 *
 * `relativeTime` returns a bucket rather than a string, so the words stay in this
 * plugin's dictionary. An unparsable date yields nothing rather than a NaN bucket.
 *
 * @param date - the commit's ISO author date.
 * @param now - the current time, injected so a render is a pure function of it.
 * @param t - namespace-bound translate.
 */
export function timeLabel(date, now, t) {
	const at = Date.parse(date);
	if (!Number.isFinite(at)) return null;
	const { unit, n } = primitives.relativeTime(at, now);
	return unit === "now" ? t("time.now") : t(`time.${unit}`).replace("{n}", String(n));
}

export function HistoryView({ state, t, onOpenCommit, selected, filter = "" }) {
	const placeholderText = placeholder(state, t);
	if (placeholderText !== null) {
		return h("div", { className: "gt_statusLine" }, placeholderText);
	}
	const history = state.value;
	const base = history.base ?? null;
	const commits = colorGraph(history.commits ?? []).filter((commit) => !filter || [commit.sha, commit.subject, commit.author, JSON.stringify(commit.refs)].some((value) => value?.toLowerCase().includes(filter)));
	// One width for every row: the slice is out of the flow, so a per-row width
	// would leave the hashes ragged. Merges need the widest one.
	const gutter = commits.reduce((widest, commit) => Math.max(widest, commit.width ?? 1), 1) * LANE_W;
	// One clock for the whole list: rows rendered together must agree on "now".
	const now = Date.now();
	if (commits.length === 0) {
		return h("div", { className: "gt_statusLine" }, t(filter ? "search.empty" : "historyEmpty"));
	}

	return h(
		"div",
		{ key: "history", className: "gt_body gt_history" },
		h(
			"div",
			{ style: { display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", flexWrap: "wrap" } },
			h("span", { className: "gt_meta" }, t("historyCount").replace("{n}", String(history.total))),
			base !== null && base.name !== null && base.ahead > 0
				? h(primitives.Tag, { tone: base.ahead > 0 ? "info" : "neutral" }, t("aheadOfBase").replace("{n}", String(base.ahead)).replace("{base}", base.name))
				: null,
			base !== null && base.behind > 0
				? h(primitives.Tag, { tone: "warning" }, t("behindBase").replace("{n}", String(base.behind)).replace("{base}", base.name))
				: null
		),
		history.truncated
			? h("div", { className: "gt_note" }, t("historyTruncated").replace("{n}", String(history.commits.length)))
			: null,
		commits.map((commit, index) => {
			const isSelected = selected === commit.sha;
			const ago = timeLabel(commit.date, now, t);
			const previous = commits[index - 1];
			const incoming = previous !== undefined && ((previous.columns ?? []).includes(commit.column) || (previous.through ?? []).includes(commit.column));
			return h(
				"div",
				{
					key: commit.sha,
					role: "button",
					tabIndex: 0,
					title: `${commit.short} ${commit.subject}`,
					onClick: () => onOpenCommit(commit),
					onKeyDown: (event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							onOpenCommit(commit);
						}
					},
					className: "gt_row",
					"aria-current": isSelected ? "true" : undefined,
					"data-ahead": commit.ahead === true,
					style: {
						// The slice is positioned against this row, so the row is the
						// containing block. Its height is the content's business — the
						// graph stretches to whatever that turns out to be.
						position: "relative",
						// Left padding reserves the graph column the slice is drawn in.
						padding: filter ? "0 8px" : `0 8px 0 ${LANE_INSET + gutter + 8}px`
					}
				},
				// Hidden commits cannot be joined by a truthful graph edge.
				filter ? null : laneGutter({ ...commit, incoming }, gutter),
				h(
					"div",
					{ className: "gt_stack" },
					h(
						"div",
						{ className: "gt_meta", style: { flexWrap: "wrap" } },
						h("span", { className: "gt_sha" }, commit.short),
						...refTags(commit.refs, t),
							commit.ahead === true && base?.name ? h(primitives.Tag, { tone: "info" }, t("notInBase").replace("{base}", base.name)) : null,
						ago === null ? null : h("span", { key: "ago", className: "gt_time" }, ago)
					),
					h("div", { className: "gt_subject" }, commit.subject)
				)
			);
		})
	);
}

/** How a branch stands relative to its upstream, in words. */
export function trackText(branch, t) {
	if (branch.gone) return t("upstreamGone");
	if (branch.upstream === null) return null;
	const parts = [];
	if (branch.ahead > 0) parts.push(t("ahead").replace("{n}", String(branch.ahead)));
	if (branch.behind > 0) parts.push(t("behind").replace("{n}", String(branch.behind)));
	return parts.length === 0 ? t("level") : parts.join(" · ");
}

/** One branch row. */
export function branchRow(branch, t, key) {
	const track = trackText(branch, t);
	return h(
		"div",
		{ key, className: "gt_branchRow" },
		h("span", { className: "gt_refDot", "aria-hidden": "true", style: { background: branchColor(branch.name), marginTop: 6 } }),
		h("div", { className: "gt_stack" },
		h("div", { className: "gt_subject" }, branch.name),
		h("div", { className: "gt_meta" },
		branch.current ? h(primitives.Tag, { tone: "success" }, t("current")) : null,
		// The base branch is what the History view marks against, so name it.
		branch.name === "main" || branch.name === "master" ? h(primitives.Tag, { tone: "neutral" }, t("base")) : null,
		// Naming the upstream is what makes the counts beside it mean anything.
		branch.upstream === null
			? null
			: h(
					"span",
					{ className: "gt_subject" },
					t("upstream").replace("{name}", branch.upstream)
				),
		track === null
			? null
			: h("span", null, track)))
	);
}

/** The Branches view: local then remote-tracking, with the operation banner above. */
export function BranchesView({ state, t, filter = "" }) {
	const placeholderText = placeholder(state, t);
	if (placeholderText !== null) {
		return h("div", { className: "gt_statusLine" }, placeholderText);
	}
	const value = state.value;
	const branches = (value.branches ?? []).filter((branch) => !filter || [branch.name, branch.upstream].some((value) => value?.toLowerCase().includes(filter)));
	const locals = branches.filter((branch) => branch.remote === false);
	const remotes = branches.filter((branch) => branch.remote === true);

	const section = (title, list, prefix) =>
		list.length === 0
			? null
			: h(
					"div",
					{ key: prefix, className: "gt_group" },
					h(
						"div",
						{ className: "gt_section" },
						title
					),
					list.map((branch, index) => branchRow(branch, t, `${prefix}:${index}`))
				);

	return h(
		"div",
		{ key: "branches", className: "gt_body" },
		branches.length === 0 ? h("div", { className: "gt_statusLine" }, t(filter ? "search.empty" : "noBranches")) : null,
		section(t("localBranches"), locals, "local"),
		section(t("remoteBranches"), remotes, "remote")
	);
}

/**
 * The Reflog view: what moved HEAD, newest first.
 *
 * This is the "record" half of a rebase — the operation banner says one is
 * happening now, and the reflog says what happened. Each entry carries its own
 * time, which the Host reads from the selector rather than the commit.
 */
export function ReflogView({ state, t }) {
	const placeholderText = placeholder(state, t);
	if (placeholderText !== null) {
		return h("div", { className: "gt_statusLine" }, placeholderText);
	}
	const value = state.value;
	const entries = value.entries ?? [];
	if (entries.length === 0) {
		return h("div", { className: "gt_statusLine" }, t("reflogEmpty"));
	}

	return h(
		"div",
		{ key: "reflog", className: "gt_body" },
		h("div", { className: "gt_note" }, t("reflogHint")),
		entries.map((entry, index) =>
			h(
				"div",
				{
					key: `${entry.selector}:${index}`,
					className: "gt_branchRow"
				},
				h("div", { className: "gt_stack" },
				h("div", { className: "gt_meta" },
				h("span", { className: "gt_sha" }, entry.short),
				h(
					primitives.Tag,
					{ tone: entry.action.startsWith(REBASE_ACTION_PREFIX) ? "warning" : "neutral" },
					entry.action
				),
				h(
					"span",
					{ className: "gt_time" },
					entry.date === null ? entry.selector : entry.date.slice(5, 16).replace("T", " ")
				)),
				h("div", { className: "gt_subject" }, entry.subject))
			)
		)
	);
}

/**
 * The Blame view: which commit last touched each line of one file.
 *
 * The path is typed here or handed over from a file patch; the view holds no
 * opinion about a "current file", because a sidebar tab has no editor
 * selection to read. Every row carries its own commit, and that commit's sha is
 * a button back into the patch — which is where the reason for a line lives.
 */
export function BlameView({ state, t, path, draft, setDraft, onShow, onOpenCommit, selected }) {
	const highlight = primitives.useCodeHighlighter(primitives.languageForPath(path));
	const highlighted = state.value?.kind === "ready" ? highlight((state.value.lines ?? []).map((line) => line.text).join("\n")) : undefined;
	let body = null;

	if (path === "") {
		// Nothing to ask for yet: the request is keyed on a path, so no fetch has
		// happened and none should.
		body = h("div", { key: "hint", className: "gt_statusLine" }, t("blameHint"));
	} else if (state.phase !== "ready") {
		body = h("div", { key: "wait", className: "gt_statusLine" }, placeholder(state, t));
	} else if (state.value?.kind === "failed") {
		// git's own words: it is the only thing that says WHICH way the path is
		// wrong (untracked, absent at the revision, not a file).
		body = h(
			"div",
			{ key: "failed", role: "alert", className: "gt_alert" },
			state.value.message
		);
	} else if (state.value?.kind === "rejected") {
		body = h("div", { key: "rejected", className: "gt_statusLine" }, t("rejected.generic"));
	} else if (state.value?.kind !== "ready") {
		body = h("div", { key: "other", className: "gt_statusLine" }, placeholder(state, t));
	} else if ((state.value.lines ?? []).length === 0) {
		body = h("div", { key: "empty", className: "gt_statusLine" }, t("blameEmpty"));
	} else {
		const lines = state.value.lines ?? [];
		body = h(
			"div",
			{ key: "lines", className: "gt_blame", style: { flex: "1 1 auto", minHeight: 0, overflow: "auto" } },
			lines.map((line, index) => {
				const groupStart = index === 0 || lines[index - 1].sha !== line.sha || lines[index - 1].uncommitted !== line.uncommitted;
				return h(
					"div",
					{
						key: `${line.sha}:${index}`,
						className: "gt_blameRow",
						"data-group-start": groupStart,
						title: `${line.uncommitted ? t("blameUncommitted") : line.short} · ${line.author}\n${line.summary}`,
						"aria-current": selected === line.sha ? "true" : undefined,
					},
					h(
						"span",
						{
							key: "no",
							className: "gt_blameLine"
						},
						String(index + 1)
					),
					h("span", { className: "gt_blameCommit" }, !groupStart ? null : line.uncommitted
						? h(
								"span",
								{
									key: "sha",
									title: line.summary,
									className: "gt_blameAuthor gt_blameUncommitted"
								},
								t("blameUncommitted")
							)
						: h(primitives.Button, {
								key: "sha",
								variant: "ghost",
								size: "sm",
								title: `${line.short} ${line.summary}`,
								onClick: () => onOpenCommit(line),
								children: line.short
							})),
					h(
						"span",
						{ key: "author", className: "gt_blameAuthor", title: line.author },
						groupStart ? line.author : null
					),
					// The source itself never wraps: a wrapped line of code stops
					// looking like code, and the commit that owns it is what matters.
					h(
						"span",
						{ key: "text", className: "gt_blameText" },
						highlighted?.[index] === undefined ? line.text : highlighted[index].map((token, i) => h("span", { key: i, style: token.style }, token.text))
					)
				);
			})
		);
	}

	const summary =
		state.phase === "ready" && state.value?.kind === "ready"
			? h(
					"div",
					{ key: "summary", className: "gt_note" },
					[
						t("blameSummary")
							.replace("{lines}", String((state.value.lines ?? []).length))
							.replace("{commits}", String(state.value.commits ?? 0))
							.replace("{authors}", String((state.value.authors ?? []).length)),
						state.value.newest === null ? null : t("blameNewest").replace("{date}", state.value.newest.slice(0, 10)),
						state.value.truncated === true
							? t("blameTruncated").replace("{n}", String((state.value.lines ?? []).length))
							: null
					]
						.filter((part) => part !== null)
						.join(" · ")
				)
			: null;

	return h(
		"div",
		{ key: "blame", style: { display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto" } },
		h(
			"div",
			{ key: "field", className: "gt_toolbar gt_commitRow" },
			h("input", {
				key: "input",
				type: "text",
				value: draft,
				placeholder: t("blamePathPlaceholder"),
				"aria-label": t("blamePath"),
				onChange: (event) => setDraft(event.target.value),
				onKeyDown: (event) => {
					if (event.key === "Enter") onShow();
				},
				className: "gt_input",
				style: {
					flex: "1 1 auto"
				}
			}),
			h(primitives.Button, {
				key: "show",
				variant: "primary",
				size: "sm",
				disabled: draft.trim() === "",
				onClick: onShow,
				children: t("blameShow")
			})
		),
		summary,
		body
	);
}
