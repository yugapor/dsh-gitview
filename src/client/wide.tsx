/**
 * The conversation view: Git beside Chat and Trajectory, with the room to read.
 *
 * Two modes share one header. Review is about the working tree — the changed
 * files on the left, the selected file's patch filling the rest, and the commit
 * card under the files. Repository is about everything already recorded — the
 * branches and CI on the left, the commit ledger in the middle, and an
 * inspector that opens beside it for one commit or for CI.
 *
 * The two meet where a reader crosses between them: Blame's commits open in the
 * Repository inspector, and a clean working tree points at Repository.
 */
import { Fragment, h, primitives, react } from "./deps";
import { GROUPS, LANE_INSET, LANE_W, REBASE_ACTION_PREFIX, flatten, sliceTree, stateOf } from "./model";
import { branchColor, colorGraph, laneGutter } from "./graph";
import { ciDisplayState, ciInterval, useGitActions, useLiveLoad, useLoad } from "./data";
import { operationBanner, patchBody, patchParts, patchState, placeholder } from "./chrome";
import { BlameView, changeSection, identityDetails, refTags, rowActions, timeLabel, trackText } from "./views";
import { CIView, ciStatus, ciSummary, connectionMessage } from "./ci";
import type { BlameLine, GitActions, Branch, CI, CICheck, Commit, History, Patch, ReflogEntry, Resource, Status, StatusReady, TreeNode, Translate, ViewProps } from "./types";

type ReactNodeLike = ReturnType<typeof h> | null;
type Mode = "review" | "repository";
type Scope = "head" | "worktree" | "index";
/**
 * What the Repository side has open: a commit expanded in the ledger (with one
 * of its files in the inspector, or none), or CI in the inspector.
 */
type Inspect = { kind: "commit"; commit: Commit; path: string | null } | { kind: "ci" } | null;

interface Selection {
	path: string;
	scope: Scope;
}
interface ReviewFile {
	node: TreeNode;
	scope: Scope;
	group: string;
}

/** Which mode each session last showed; it outlives the view, which unmounts on a tab switch. */
const modes = new Map<string, Mode>();

/**
 * Side by side unless the reader asked for one column. Kept apart from the
 * sidebar's Auto/Split/Unified choice, which suits a narrow pane.
 */
const SPLIT_KEY = "dsh-gitview.wide-unified";
function readUnified() {
	try {
		return window.localStorage?.getItem(SPLIT_KEY) === "true";
	} catch {
		return false;
	}
}
function saveUnified(value: boolean) {
	try {
		window.localStorage?.setItem(SPLIT_KEY, String(value));
	} catch {
		// The choice still applies for this view.
	}
}

/** `sliceTree`, typed: one tree cut down to the files `keep` accepts, recounted. */
const slice = (tree: TreeNode, keep: (node: TreeNode) => boolean): TreeNode => sliceTree(tree, keep) as TreeNode;

/** The index side a section's rows open, matching the sidebar's rule. */
const scopeOf = (group: string): Scope => group === "staged" ? "index" : group === "unstaged" ? "worktree" : "head";

/** The rail lists files flat, VS Code style, unless the reader asked for the tree. */
const TREE_KEY = "dsh-gitview.wide-tree";
function readTree() {
	try {
		return window.localStorage?.getItem(TREE_KEY) === "true";
	} catch {
		return false;
	}
}
function saveTree(value: boolean) {
	try {
		window.localStorage?.setItem(TREE_KEY, String(value));
	} catch {
		// The choice still applies for this view.
	}
}

/**
 * The lanes that run on past an expanded commit, drawn beside its file list so
 * the graph does not break where the list opens.
 */
function laneContinuation(colors: (string | undefined)[], width: number) {
	return (
		<div aria-hidden="true" className="gt_wLanes" style={{ left: LANE_INSET, width }}>
			<svg width="100%" height="100%" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none">
				{colors.map((color, lane) => color === undefined ? null : (
					<line key={lane} x1={lane * LANE_W + LANE_W / 2} y1={0} x2={lane * LANE_W + LANE_W / 2} y2={100} stroke={color} strokeOpacity={0.7} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
				))}
			</svg>
		</div>
	);
}

/** One `diff --git` section of a patch, with its own line counts. */
export interface FileChunk {
	path: string;
	added: number;
	deleted: number;
	binary: boolean;
	text: string;
}

/**
 * Cut a patch into its files.
 *
 * Lines are counted only inside hunks, so a deleted line that happens to begin
 * with `--` is not mistaken for a file header.
 */
export function fileChunks(text: string, fallbackPath = ""): FileChunk[] {
	const chunks: (FileChunk & { lines: string[] })[] = [];
	let current: (FileChunk & { lines: string[] }) | null = null;
	let inHunk = false;
	for (const line of text.split("\n")) {
		if (current === null || line.startsWith("diff --git ")) {
			current = { path: fallbackPath, added: 0, deleted: 0, binary: false, text: "", lines: [] };
			chunks.push(current);
			inHunk = false;
			const named = /^diff --git .* "?b\/(.+?)"?$/.exec(line);
			if (named !== null) current.path = named[1];
		}
		if (line.startsWith("@@")) inHunk = true;
		else if (inHunk && line[0] === "+") current.added++;
		else if (inHunk && line[0] === "-") current.deleted++;
		else if (!inHunk && line.startsWith("Binary files ")) current.binary = true;
		current.lines.push(line);
	}
	return chunks
		.filter((chunk) => chunk.lines.some((line) => line !== ""))
		.map(({ lines, ...chunk }) => ({ ...chunk, text: lines.join("\n") }));
}

/** Patch parts without the header lines a file heading already says. */
function hunksOf(text: string, path: string) {
	return patchParts(text, path).filter((part: unknown) => typeof part !== "string" || !/^(diff --git |index |--- |\+\+\+ )/.test(part));
}

/** A path split into its quiet directory and its file name. */
function pathLabel(path: string) {
	const cut = path.lastIndexOf("/") + 1;
	return (
		<span className="gt_wPath" title={path}>
			{cut > 0 ? <span className="gt_wDir">{path.slice(0, cut)}</span> : null}
			<span className="gt_wFile">{path.slice(cut)}</span>
		</span>
	);
}

function diffStat(chunk: FileChunk | undefined) {
	if (chunk === undefined || chunk.binary) return null;
	return (
		<span className="gt_diffStat">
			<span className="gt_success">+{chunk.added}</span>
			<span className="gt_danger">−{chunk.deleted}</span>
		</span>
	);
}

/**
 * How far a branch stands from its upstream: ahead in green, behind in red, as
 * bare numbers in that fixed order. The words are kept for the tooltip and for
 * screen readers, so colour is never the only cue.
 */
function trackCounts(track: { ahead: number; behind: number; gone?: boolean }, label: string | null) {
	if (track.gone) return <span className="gt_wTrack gt_neutral">{label}</span>;
	if (track.ahead === 0 && track.behind === 0) return null;
	return (
		<span className="gt_wTrack" title={label ?? undefined} aria-label={label ?? undefined}>
			{track.ahead > 0 ? <span className="gt_success" aria-hidden="true">{track.ahead}</span> : null}
			{track.behind > 0 ? <span className="gt_danger" aria-hidden="true">{track.behind}</span> : null}
		</span>
	);
}

function fileIcon(path: string) {
	return <primitives.FileTypeIcon kind={primitives.classifyFileType(path.slice(path.lastIndexOf("/") + 1))} size={16} className="gt_fileIcon" />;
}

/** The scroll areas of this view; scrolling stops at them. */
const SCROLLERS = ".gt_wLedger, .gt_wRailBody, .gt_wInspectBody, .gt_wDocBody";

/**
 * Bring an element into view by scrolling only its own pane.
 *
 * `scrollIntoView` scrolls every scrollable ancestor as well, which moved the
 * whole conversation view — rail and header with it — when a distant commit was
 * selected.
 */
export function reveal(element: Element | null | undefined, block: "nearest" | "center" | "start" = "nearest", smooth = false) {
	const pane = element?.closest(SCROLLERS);
	if (element == null || pane == null) return;
	const outer = pane.getBoundingClientRect();
	const inner = element.getBoundingClientRect();
	// Sticky headings cover the top of a pane; the start position clears them.
	const offset = block === "start" ? inner.top - outer.top - 40
		: block === "center" ? inner.top - outer.top - (outer.height - inner.height) / 2
		: inner.top < outer.top ? inner.top - outer.top - 8
		: inner.bottom > outer.bottom ? inner.bottom - outer.bottom + 8
		: 0;
	if (offset !== 0) pane.scrollBy({ top: offset, behavior: smooth ? "smooth" : "auto" });
}

/** An abort signal for this mount, created in an effect so a re-run effect gets a fresh one. */
function useMountSignal() {
	const [signal, setSignal] = react.useState<AbortSignal | undefined>(undefined);
	react.useEffect(() => {
		const controller = new AbortController();
		setSignal(controller.signal);
		return () => controller.abort();
	}, []);
	return signal;
}

/**
 * The commit card, at the top of the changes as in VS Code: the message (with
 * the AI draft as an icon inside it), then one full-width Commit button.
 */
function commitCard(staged: number, identity: unknown, actions: GitActions, t: Translate) {
	const { busy, generating, generatedModel, message, setMessage, onCommit, onGenerate } = actions;
	const blocked = busy || generating || staged === 0 || message.trim() === "";
	const submit = () => {
		if (!blocked) onCommit(message.trim());
	};
	const canGenerate = !busy && !generating && staged > 0 && message.trim() === "";
	return (
		<div className="gt_wCommit">
			<div className="gt_wMessageBox">
				<textarea
					className="gt_wMessage"
					rows={1}
					value={message}
					placeholder={t("commitPlaceholderShortcut")}
					aria-label={t("commitMessage")}
					disabled={busy || generating}
					onChange={(event) => setMessage(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							submit();
						}
					}}
				/>
				<primitives.Button
					variant="ghost"
					size="sm"
					className="gt_wGenerate"
					aria-label={t("generateMessage")}
					title={t(message.trim() === "" ? "generateHint" : "generateNeedsEmpty")}
					disabled={!canGenerate}
					onClick={() => onGenerate()}
				>
					<primitives.IconSparkleRegular className="gt_icon" />
				</primitives.Button>
			</div>
			<primitives.Button
				variant="primary"
				size="sm"
				className="gt_wCommitButton"
				icon={<primitives.IconCheckOutlineRegular />}
				disabled={blocked}
				title={t("commitShortcut")}
				onClick={submit}
			>
				{busy ? t("busy") : generating ? t("generatingMessage") : t("commit")}
			</primitives.Button>
			{generatedModel ? <div className="gt_meta" role="status">{t("generatedWith").replace("{model}", generatedModel)}</div> : null}
			<div className="gt_wCommitMeta">
				<span>{t("stagedCount").replace("{n}", String(staged))}</span>
				{identityDetails(identity, t)}
			</div>
		</div>
	);
}

export function GitWideView(props: ViewProps) {
	const { sessionId, useSessions, t, loadStatus, loadHistory, loadBranches, loadReflog, loadBlame, loadDiff, loadCI, loadAuth, askAI, generateMessage, mutate } = props;
	const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd);
	const signal = useMountSignal();

	const [mode, setModeState] = react.useState<Mode>(() => modes.get(sessionId) ?? "review");
	react.useEffect(() => setModeState(modes.get(sessionId) ?? "review"), [sessionId]);
	const setMode = react.useCallback((next: Mode) => {
		modes.set(sessionId, next);
		setModeState(next);
	}, [sessionId]);

	const [statusNonce, setStatusNonce] = react.useState(0);
	const [dataNonce, setDataNonce] = react.useState(0);
	const adopt = react.useRef<((value: Status) => void) | null>(null);
	const actions: GitActions = useGitActions({ sessionId, signal, t, mutate, generateMessage, adopt });
	const { busy, notice, setNotice, runMutation } = actions;
	// Nothing is read until this mount owns a signal to cancel it with.
	const live = signal !== undefined && cwd !== undefined;
	const statusKey = live ? `status:${sessionId}:${cwd}:${statusNonce}` : null;
	const [status, setStatus] = useLiveLoad(statusKey, (s: AbortSignal) => loadStatus(sessionId, s), signal, 3000, busy, true) as [Resource<Status>, (value: Resource<Status>) => void];
	adopt.current = (value) => {
		setStatus({ phase: "ready", key: statusKey ?? undefined, value, updatedAt: Date.now() });
		setDataNonce((n) => n + 1);
	};
	const statusState: Resource<Status> | { phase: "no-workspace" } = cwd === undefined ? { phase: "no-workspace" } : status;
	const ready: StatusReady | null = statusState.phase === "ready" && "value" in statusState && statusState.value?.kind === "ready" ? statusState.value : null;

	// Review
	const [selection, setSelection] = react.useState<Selection | null>(null);
	const [pane, setPane] = react.useState<"diff" | "blame">("diff");
	const [filter, setFilter] = react.useState("");
	const [collapsed, setCollapsed] = react.useState<Set<string>>(() => new Set());
	const [unified, setUnified] = react.useState(readUnified);
	const [asTree, setAsTree] = react.useState(readTree);
	const [wrapped, setWrapped] = react.useState(false);
	const [copied, setCopied] = react.useState<string | null>(null);
	const [hunk, setHunk] = react.useState(-1);
	const [doc, setDoc] = react.useState<HTMLDivElement | null>(null);
	// Repository
	const [list, setList] = react.useState<"commits" | "reflog">("commits");
	const [repoFilter, setRepoFilter] = react.useState("");
	const [inspect, setInspect] = react.useState<Inspect>(null);
	const [ciRemote, setCIRemote] = react.useState("");
	const [authNonce, setAuthNonce] = react.useState(0);
	const [expanded, setExpanded] = react.useState<Record<string, boolean>>({});
	const root = react.useRef<HTMLDivElement | null>(null);
	const [ledgerElement, setLedgerElement] = react.useState<HTMLDivElement | null>(null);
	// Where the HEAD row sits relative to the ledger's scrolled window.
	const [headPlace, setHeadPlace] = react.useState<"visible" | "above" | "below">("visible");

	// Paths and commits belong to one repository; another session starts empty.
	react.useEffect(() => {
		setSelection(null);
		setPane("diff");
		setFilter("");
		setInspect(null);
		setRepoFilter("");
		setCIRemote("");
		setAuthNonce(0);
		setExpanded({});
	}, [sessionId, cwd]);

	const repository = mode === "repository" && ready !== null;
	const [history] = useLoad(repository ? `history:${sessionId}:${cwd}:${dataNonce}` : null, () => loadHistory(sessionId, signal)) as [Resource<History>];
	const [branches] = useLoad(repository ? `branches:${sessionId}:${cwd}:${dataNonce}` : null, () => loadBranches(sessionId, signal)) as [Resource<{ kind: string; branches?: Branch[] }>];
	const [reflog] = useLoad(repository && list === "reflog" ? `reflog:${sessionId}:${cwd}:${dataNonce}` : null, () => loadReflog(sessionId, signal)) as [Resource<{ kind: string; entries?: ReflogEntry[] }>];
	const [ci] = useLiveLoad(live && ready !== null ? `ci:${sessionId}:${cwd}:${ciRemote}:${dataNonce}` : null, (s: AbortSignal) => loadCI(sessionId, ciRemote, s), signal, ciInterval) as [Resource<CI>];
	const [auth] = useLoad(inspect?.kind === "ci" && authNonce > 0 ? `auth:${sessionId}:${ciRemote}:${authNonce}` : null, () => loadAuth(sessionId, ciRemote, signal)) as [Resource<unknown>];
	const reviewing = mode === "review" && ready !== null && selection !== null;
	const [patch] = useLiveLoad(
		reviewing && pane === "diff" ? JSON.stringify([sessionId, cwd, selection.scope, selection.path, dataNonce]) : null,
		(s: AbortSignal) => loadDiff(sessionId, selection?.path ?? "", selection?.scope ?? "head", "", s),
		signal, 3000, busy
	) as [Resource<Patch>];
	const [blame] = useLoad(reviewing && pane === "blame" ? `blame:${sessionId}:${selection.path}:${dataNonce}` : null, () => loadBlame(sessionId, selection?.path ?? "", signal)) as [Resource<unknown>];
	const inspectSha = inspect?.kind === "commit" ? inspect.commit.sha : null;
	const [commitPatch] = useLoad(inspectSha !== null ? `commit:${sessionId}:${cwd}:${inspectSha}` : null, () => loadDiff(sessionId, "", "commit", inspectSha ?? "", signal)) as [Resource<Patch>];

	// The rail's files, in the order they are drawn: the order J and K walk.
	const query = filter.trim().toLowerCase();
	const tree: TreeNode | null = ready === null ? null : query ? slice(ready.tree, (node) => node.path.toLowerCase().includes(query)) : ready.tree;
	const sections = tree === null ? [] : GROUPS
		.map((group: { id: string; tone: string; actions: string[]; keep: (node: TreeNode) => boolean }) => ({ id: group.id, tone: group.tone, actions: group.actions, tree: slice(tree, group.keep) }))
		.filter((section: { tree: TreeNode }) => (section.tree.total ?? 0) > 0);
	const files: ReviewFile[] = sections.flatMap((section: { id: string; tree: TreeNode }) => {
		const rows: ReviewFile[] = flatten(section.tree, asTree ? collapsed : new Set(), 0, [], (path: string) => `${section.id}:${path}`)
			.filter((row: { isDir: boolean }) => !row.isDir)
			.map((row: { node: TreeNode }) => ({ node: row.node, scope: scopeOf(section.id), group: section.id }));
		return asTree ? rows : rows.sort((a, b) => a.node.path.localeCompare(b.node.path));
	});
	const at = files.findIndex((file) => file.node.path === selection?.path && file.scope === selection?.scope);
	const current = at === -1 ? undefined : files[at];

	// Keep a file selected: after staging, the same path in its new section; after
	// it disappears, whatever now sits where it was.
	const lastIndex = react.useRef(0);
	const fileKey = files.map((file) => `${file.scope}:${file.node.path}`).join("\n");
	react.useEffect(() => {
		if (mode !== "review" || ready === null) return;
		if (at !== -1) {
			lastIndex.current = at;
			return;
		}
		const next = files.find((file) => file.node.path === selection?.path) ?? files[Math.min(lastIndex.current, files.length - 1)];
		setSelection(next === undefined ? null : { path: next.node.path, scope: next.scope });
	}, [mode, fileKey, selection, ready === null]);
	react.useEffect(() => setHunk(-1), [selection?.path, selection?.scope]);
	// The row that keys moved to is brought into view.
	react.useEffect(() => {
		root.current?.querySelectorAll?.<HTMLElement>("[aria-current=true]").forEach((row) => reveal(row));
	}, [selection?.path, selection?.scope, inspectSha, mode]);

	const select = react.useCallback((node: TreeNode, scope: Scope) => {
		setSelection({ path: node.path, scope });
		setPane("diff");
	}, []);
	const toggleStage = (file: ReviewFile) => runMutation({ action: file.group === "staged" ? "unstage" : "stage", paths: [file.node.path] });

	const historyValue = history.phase === "ready" && history.value?.kind === "ready" ? history.value : null;
	const repoQuery = repoFilter.trim().toLowerCase();
	const commits: Commit[] = colorGraph(historyValue?.commits ?? []).filter((commit: Commit) =>
		!repoQuery || [commit.sha, commit.subject, commit.author, JSON.stringify(commit.refs)].some((value) => value?.toLowerCase().includes(repoQuery)));
	const headCommit = historyValue?.commits.find((commit) => (commit.refs ?? []).some((ref) => ref.kind === "head"));
	const headShown = mode === "repository" && list === "commits" && headCommit !== undefined && commits.some((commit) => commit.sha === headCommit.sha);
	react.useEffect(() => {
		const row = headShown ? ledgerElement?.querySelector?.("[data-head=true]") : null;
		if (row == null || typeof IntersectionObserver === "undefined") {
			setHeadPlace("visible");
			return undefined;
		}
		const observer = new IntersectionObserver(([entry]) =>
			setHeadPlace(entry.isIntersecting ? "visible" : entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) ? "above" : "below"),
		{ root: ledgerElement });
		observer.observe(row);
		return () => observer.disconnect();
	}, [ledgerElement, headShown, headCommit?.sha, repoQuery]);
	const scrollToHead = () => reveal(ledgerElement?.querySelector?.("[data-head=true]"), "center", true);

	/** Expand a commit in the ledger; pressing an expanded commit folds it again. */
	const expand = (commit: Commit, toggle = false) =>
		setInspect(toggle && inspect?.kind === "commit" && inspect.commit.sha === commit.sha ? null : { kind: "commit", commit, path: null });
	/** Show one commit from elsewhere, opening the given file's change in it when there is one. */
	const openCommit = react.useCallback((commit: Commit, path: string | null = null) => {
		setMode("repository");
		setList("commits");
		setInspect({ kind: "commit", commit, path });
	}, [setMode]);

	const refresh = () => {
		setStatusNonce((n) => n + 1);
		setDataNonce((n) => n + 1);
		setNotice(null);
	};
	const copy = async (text: string, what: string) => {
		if (await primitives.writeClipboard(text)) {
			setCopied(what);
			setTimeout(() => setCopied(null), 1000);
		}
	};
	const navigateHunk = (direction: number) => {
		const targets = doc?.querySelectorAll<HTMLElement>("[data-hunk]");
		if (!targets?.length) return;
		const next = Math.min(targets.length - 1, Math.max(0, hunk + direction));
		reveal(targets[next], "start");
		targets[next].focus({ preventScroll: true });
		setHunk(next);
	};

	const onKeyDown = (event: { key: string; target: EventTarget; metaKey: boolean; ctrlKey: boolean; altKey: boolean; defaultPrevented: boolean; preventDefault(): void }) => {
		const target = event.target as HTMLElement;
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName ?? "") || target.isContentEditable) return;
		if (event.key === "Escape" && inspect !== null) {
			setInspect(inspect.kind === "commit" && inspect.path !== null ? { ...inspect, path: null } : null);
			return;
		}
		const step = event.key === "j" ? 1 : event.key === "k" ? -1 : 0;
		if (mode === "review") {
			if (step !== 0) {
				const next = files[Math.max(0, Math.min(files.length - 1, at + step))];
				if (next !== undefined) select(next.node, next.scope);
				event.preventDefault();
			} else if ((event.key === "s" || event.key === "u") && current !== undefined && !busy) {
				// Each key does only what its name says, so S on a staged file is a no-op.
				if ((event.key === "s") === (current.group !== "staged")) toggleStage(current);
				event.preventDefault();
			}
		} else if (step !== 0 && list === "commits") {
			const index = commits.findIndex((commit) => commit.sha === inspectSha);
			const next = commits[Math.max(0, Math.min(commits.length - 1, index + step))];
			if (next !== undefined) expand(next);
			event.preventDefault();
		}
	};

	const ciValue = ci.value;
	const base = ready?.base;
	const header = (
		<header className="gt_wHead">
			<div className="gt_wRepo">
				<primitives.IconBranchOutlineRegular className="gt_icon" />
				<span className="gt_wBranch" title={ready?.branch ?? undefined}>{ready?.detached ? t("detached") : ready?.branch ?? "Git"}</span>
				{ready?.unborn ? <primitives.Tag tone="neutral">{t("unborn")}</primitives.Tag> : null}
				{base?.name && base.ahead > 0 ? <span className="gt_wNote">{t("aheadOfBase").replace("{n}", String(base.ahead)).replace("{base}", base.name)}</span> : null}
				{ready ? <span className="gt_wRepoPath" title={ready.repoRoot}>{ready.repoRoot}</span> : null}
			</div>
			<primitives.SegmentedControl
				id={`gt-mode-${sessionId}`}
				value={mode}
				options={[{ value: "review", label: t("mode.review") }, { value: "repository", label: t("mode.repository") }]}
				onChange={setMode}
				label={t("mode.label")}
				disabled={ready === null}
			/>
			<div className="gt_wHeadEnd">
				{ciValue ? (
					<primitives.Button
						variant="ghost"
						size="sm"
						title={t("repo.ciOpen")}
						aria-pressed={mode === "repository" && inspect?.kind === "ci"}
						onClick={() => {
							if (mode === "repository" && inspect?.kind === "ci") {
								setInspect(null);
								return;
							}
							setMode("repository");
							setInspect({ kind: "ci" });
						}}
					>
						<span className="gt_wCi">CI {ci.pollError || ciValue.kind !== "ready" ? "!" : ciSummary(ciValue, t)}</span>
					</primitives.Button>
				) : null}
				<primitives.Button variant="ghost" size="sm" onClick={refresh}>{t("refresh")}</primitives.Button>
			</div>
		</header>
	);

	if (ready === null) {
		return (
			<div className="gt_wView" ref={root}>
				{header}
				<p className="gt_statusLine">{placeholder(statusState, t) ?? t("loading")}</p>
			</div>
		);
	}

	const notes = (
		<Fragment>
			{status.pollError ? <div className="gt_note gt_warning" role="status">{t("status.stale")}</div> : null}
			{operationBanner(ready.state ?? null, t)}
			{notice === null ? null : (
				<div role="alert" className="gt_alert">
					{notice}
					<primitives.Button variant="ghost" size="sm" onClick={() => setNotice(null)}>{t("diffClose")}</primitives.Button>
				</div>
			)}
		</Fragment>
	);
	const panel = { id: `gt-mode-${sessionId}-${mode}-panel`, role: "tabpanel", "aria-labelledby": `gt-mode-${sessionId}-${mode}` };

	let body;
	if (mode === "review") {
		const staged = sections.find((section: { id: string }) => section.id === "staged")?.tree.total ?? 0;
		const conflicted = sections.find((section: { id: string }) => section.id === "conflicted")?.tree.total ?? 0;
		const indexed = slice(ready.tree, (node) => node.staged === true).total ?? 0;
		const stagePath = (path: string) => runMutation({ action: "stage", paths: [path] });
		const unstagePath = (path: string) => runMutation({ action: "unstage", paths: [path] });
		/** One file in the flat list: name, quiet folder, git's letter at the end, actions on hover. */
		const flatRow = (file: ReviewFile, sectionActions: string[]) => {
			const { node } = file;
			const state = stateOf(node.state);
			const cut = node.path.lastIndexOf("/");
			const open = () => select(node, file.scope);
			return (
				<div
					key={`${file.group}:${node.path}`}
					role="button"
					tabIndex={0}
					className="gt_row gt_wFileRow"
					title={`${node.path}\n${(node as { index?: string }).index ?? ""}${(node as { worktree?: string }).worktree ?? ""}`}
					aria-current={file === current ? "true" : undefined}
					onClick={open}
					onKeyDown={(event) => {
						if (event.target !== event.currentTarget) return;
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							open();
						}
					}}
				>
					{fileIcon(node.path)}
					<span className="gt_name">{node.path.slice(cut + 1)}</span>
					<span className="gt_wDir">{cut > 0 ? node.path.slice(0, cut) : ""}</span>
					{rowActions({ node, actions: sectionActions, busy, t, onStage: stagePath, onUnstage: unstagePath })}
					<span className={`gt_change gt_${state.tone}`}>{state.letter}</span>
				</div>
			);
		};
		const rail = (
			<aside className="gt_wRail" aria-label={t("view.status")}>
				<div className="gt_wRailHead">
					<span className="gt_wRailTitle">{t("changed").replace("{n}", String(ready.changed))}</span>
					<primitives.Button
						variant="ghost"
						size="sm"
						aria-label={t(asTree ? "view.asList" : "view.asTree")}
						title={t(asTree ? "view.asList" : "view.asTree")}
						onClick={() => {
							setAsTree(!asTree);
							saveTree(!asTree);
						}}
					>
						{asTree ? <primitives.IconFlatListOutlineRegular className="gt_icon" /> : <primitives.IconWorkspaceTreeOutlineRegular className="gt_icon" />}
					</primitives.Button>
					<primitives.Button variant="ghost" size="sm" disabled={busy || ready.changed === 0} onClick={() => runMutation({ action: "stage-all" })}>{t("stageAll")}</primitives.Button>
					<primitives.Button variant="ghost" size="sm" disabled={busy || indexed === 0} onClick={() => runMutation({ action: "unstage-all" })}>{t("unstageAll")}</primitives.Button>
				</div>
				{commitCard(staged, ready.identity, actions, t)}
				<div className="gt_wFilter">
					<input
						className="gt_input"
						type="search"
						value={filter}
						placeholder={t("search.status")}
						aria-label={t("search.status")}
						onChange={(event) => setFilter(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") setFilter("");
						}}
					/>
				</div>
				{conflicted > 0 ? <p className="gt_note">{t("conflictHint")}</p> : null}
				{ready.truncated ? <p className="gt_note">{t("truncated").replace("{n}", String(ready.changed))}</p> : null}
				<div className="gt_wRailBody">
					{ready.changed === 0
						? <p className="gt_note">{t("clean")}</p>
						: sections.length === 0
							? <p className="gt_note">{t("search.empty")}</p>
							: asTree
								? sections.map((section: unknown) => changeSection({
									section, t, collapsed, setCollapsed, busy, selected: selection,
									onOpenDiff: select, onStage: stagePath, onUnstage: unstagePath
								}))
								: sections.map((section: { id: string; tone: string; actions: string[]; tree: TreeNode }) => (
									<div key={section.id} className="gt_group">
										<div className="gt_section">
											<span className={`gt_${section.tone}`}>{t(section.id)}</span>
											<span className="gt_count">{section.tree.total}</span>
										</div>
										{files.filter((file) => file.group === section.id).map((file) => flatRow(file, section.actions))}
									</div>
								))}
				</div>
				{ready.changed > 0 ? <p className="gt_wKeys">{t("review.keys")}</p> : null}
			</aside>
		);

		let main;
		if (ready.changed === 0) {
			main = (
				<div className="gt_wEmpty">
					<p className="gt_wEmptyTitle">{t("clean")}</p>
					<p>{t("review.cleanHint")}</p>
					<primitives.Button variant="outline" size="sm" onClick={() => setMode("repository")}>{t("review.openRepository")}</primitives.Button>
				</div>
			);
		} else if (selection === null) {
			main = <p className="gt_statusLine">{t(query ? "search.empty" : "loading")}</p>;
		} else if (pane === "blame") {
			main = (
				<div className="gt_wDoc">
					<div className="gt_wDocHead">
						<primitives.Button variant="ghost" size="sm" onClick={() => setPane("diff")}>{t("review.backToDiff")}</primitives.Button>
						{fileIcon(selection.path)}
						{pathLabel(selection.path)}
						<primitives.Tag tone="neutral">{t("view.blame")}</primitives.Tag>
					</div>
					<div className="gt_wDocBody">
						{h(BlameView, {
							state: blame, t, path: selection.path, field: false, draft: selection.path, setDraft: () => {}, onShow: () => {}, selected: null,
							onOpenCommit: (line: BlameLine) => openCommit({ sha: line.sha, short: line.short, subject: line.summary, author: line.author, date: line.date }, selection.path)
						})}
					</div>
				</div>
			);
		} else {
			const text = patch.value?.text ?? "";
			const chunk = fileChunks(text, selection.path)[0];
			const parts = hunksOf(text, selection.path);
			const hunkCount = parts.filter((part: unknown) => typeof part !== "string").length;
			const split = !unified;
			main = (
				<div className="gt_wDoc" ref={setDoc}>
					<div className="gt_wDocHead">
						{fileIcon(selection.path)}
						{pathLabel(selection.path)}
						<primitives.Tag tone="neutral">{t(`scope.${selection.scope}`)}</primitives.Tag>
						{diffStat(chunk)}
						<div className="gt_wTools">
							{current !== undefined ? (
								<primitives.Button variant="ghost" size="sm" disabled={busy} onClick={() => toggleStage(current)}>
									{t(current.group === "staged" ? "unstage" : "stage")}
								</primitives.Button>
							) : null}
							<primitives.Button variant="ghost" size="sm" title={t("blameHint")} onClick={() => setPane("blame")}>{t("blameShow")}</primitives.Button>
							<primitives.Button
								variant="ghost"
								size="sm"
								aria-label={t("diff.split")}
								aria-pressed={split}
								title={t(split ? "diff.toUnified" : "diff.toSplit")}
								onClick={() => {
									setUnified(split);
									saveUnified(split);
								}}
							>
								<primitives.IconCompareSplitOutlineRegular className="gt_icon" />
							</primitives.Button>
							<primitives.Button variant="ghost" size="sm" aria-pressed={wrapped} onClick={() => setWrapped((value) => !value)}>{t(wrapped ? "unwrap" : "wrap")}</primitives.Button>
							<primitives.Button variant="ghost" size="sm" disabled={text === ""} onClick={() => copy(text, "diff")}>{t(copied === "diff" ? "copied" : "copy")}</primitives.Button>
							{hunkCount > 0 ? (
								<span className="gt_meta">
									<primitives.Button variant="ghost" size="sm" aria-label={t("previousHunk")} title={t("previousHunk")} disabled={hunk <= 0} onClick={() => navigateHunk(-1)}>↑</primitives.Button>
									<span aria-live="polite">{`${Math.max(1, Math.min(hunk + 1, hunkCount))}/${hunkCount}`}</span>
									<primitives.Button variant="ghost" size="sm" aria-label={t("nextHunk")} title={t("nextHunk")} disabled={hunk >= hunkCount - 1} onClick={() => navigateHunk(1)}>↓</primitives.Button>
								</span>
							) : null}
						</div>
					</div>
					<div className="gt_wDocBody">{patchState(patch, t) ?? patchBody(parts, t, { split, wrapped })}</div>
					{patch.pollError ? <p className="gt_note gt_warning" role="status">{t("diff.stale")}</p> : null}
					{patch.value?.truncated ? <p className="gt_note">{t("diffTruncated")}</p> : null}
				</div>
			);
		}
		body = (
			<div className="gt_wReview">
				{rail}
				<section className="gt_wMain" {...panel}>{main}</section>
			</div>
		);
	} else {
		const branchList = branches.value?.branches ?? [];
		const tipOf = (name: string) => historyValue?.commits.find((commit) => (commit.refs ?? []).some((ref) => ref.name === name));
		const branchRow = (branch: Branch) => {
			const tip = tipOf(branch.name);
			const track = trackText(branch, t);
			return (
				<button
					key={`${branch.remote}:${branch.name}`}
					type="button"
					className="gt_row gt_wBranchRow"
					disabled={tip === undefined}
					title={tip === undefined ? branch.name : t("repo.goToCommit")}
					aria-current={tip !== undefined && tip.sha === inspectSha ? "true" : undefined}
					onClick={() => tip !== undefined && expand(tip)}
				>
					<span className="gt_refDot" aria-hidden="true" style={{ background: branchColor(branch.name) }} />
					<span className="gt_name">{branch.name}</span>
					{branch.current ? <primitives.Tag tone="success">{t("current")}</primitives.Tag> : null}
					{trackCounts(branch, track)}
				</button>
			);
		};
		const locals = branchList.filter((branch) => !branch.remote);
		const remotes = branchList.filter((branch) => branch.remote);
		const checks: CICheck[] = ciValue?.kind === "ready" ? ciValue.checks ?? [] : [];
		const openCI = () => setInspect({ kind: "ci" });
		const toggleCI = () => setInspect(inspect?.kind === "ci" ? null : { kind: "ci" });

		// CI is about the HEAD commit, so it is summarized where HEAD is: one line,
		// plus a row for each job that still needs a look.
		const tally = new Map<string, number>();
		for (const check of checks) tally.set(check.state, (tally.get(check.state) ?? 0) + 1);
		const attention = checks.filter((check) => ["failure", "running", "pending", "blocked"].includes(check.state));
		const upstreamTrack = ready.upstream === null ? null
			: ready.ahead === 0 && ready.behind === 0 ? t("here.levelUpstream")
			: [ready.ahead > 0 ? t("ahead").replace("{n}", String(ready.ahead)) : null, ready.behind > 0 ? t("behind").replace("{n}", String(ready.behind)) : null].filter(Boolean).join(" · ");
		const here = (
			<section className="gt_wHere" aria-label={t("here.title")}>
				<div className="gt_wHereTitle">{t("here.title")}</div>
				<div className="gt_wHereBranch">
					<primitives.IconBranchOutlineRegular className="gt_icon" />
					<span className="gt_name">{ready.detached ? t("detached") : ready.branch ?? "HEAD"}</span>
					{upstreamTrack === null ? null : trackCounts(ready, upstreamTrack)}
				</div>
				{ready.upstream === null ? null : <div className="gt_wHereSub">{t("upstream").replace("{name}", ready.upstream)}</div>}
				<button
					type="button"
					className="gt_row"
					disabled={headCommit === undefined}
					title={t("here.head")}
					aria-current={headCommit !== undefined && headCommit.sha === inspectSha ? "true" : undefined}
					onClick={() => {
						if (headCommit === undefined) return;
						setRepoFilter("");
						expand(headCommit);
					}}
				>
					<span className="gt_sha">{headCommit?.short ?? "HEAD"}</span>
					<span className="gt_name">{headCommit?.subject ?? (historyValue === null ? t("loading") : "")}</span>
				</button>
				<button type="button" className="gt_row" onClick={() => setMode("review")}>
					<span className={ready.changed > 0 ? "gt_name gt_warning" : "gt_name"}>
						{ready.changed > 0 ? t("here.uncommitted").replace("{n}", String(ready.changed)) : t("here.clean")}
					</span>
				</button>
				<button type="button" className="gt_row" title={t("repo.ciOpen")} aria-expanded={inspect?.kind === "ci"} onClick={toggleCI}>
					<span className="gt_name">{t("view.ci")}</span>
					{ciValue === undefined
						? <span className="gt_count">{ci.phase === "error" ? ci.message : t("loading")}</span>
						: ciValue.kind !== "ready"
							? <span className="gt_count" title={connectionMessage(ciValue, t)}>!</span>
							: <Fragment>
								{ciStatus(ciDisplayState(ciValue.state ?? "none", checks), t)}
								<span className="gt_count">{[...tally].filter(([state]) => !["failure", "running", "pending", "blocked"].includes(state)).map(([state, n]) => `${n} ${t(`ci.state.${state}`)}`).join(" · ")}</span>
							</Fragment>}
				</button>
				{attention.map((check, index) => (
					<button key={`${check.group}:${check.name}:${index}`} type="button" className="gt_row gt_wHereCheck" onClick={openCI}>
						<span className="gt_name">{check.name}</span>
						{ciStatus(check.state, t)}
					</button>
				))}
			</section>
		);

		const rail = (
			<aside className="gt_wRail" aria-label={t("view.branches")}>
				<div className="gt_wRailBody">
					{here}
					<div className="gt_group">
						<div className="gt_section">{t("localBranches")}<span className="gt_count">{locals.length || ""}</span></div>
						{placeholder(branches, t) !== null ? <p className="gt_note">{placeholder(branches, t)}</p> : locals.length === 0 ? <p className="gt_note">{t("noBranches")}</p> : locals.map(branchRow)}
					</div>
					{remotes.length > 0 ? (
						<details className="gt_group gt_wRemotes">
							<summary className="gt_section">{t("remoteBranches")}<span className="gt_count">{remotes.length}</span></summary>
							{remotes.map(branchRow)}
						</details>
					) : null}
				</div>
			</aside>
		);

		// The expanded commit's files, listed in the ledger under its row.
		const commitMessage = patchState(commitPatch, t);
		const commitChunks = commitMessage === null ? fileChunks(commitPatch.value?.text ?? "") : [];
		const openPath = inspect?.kind === "commit" ? inspect.path : null;
		const commitFiles = (indent: number, lanes: ReactNodeLike) => (
			<div className="gt_wCommitFiles" role="group" aria-label={t("files")} style={{ paddingLeft: indent }}>
				{lanes}
				{commitMessage !== null
					? <p className="gt_note">{commitMessage}</p>
					: commitChunks.map((chunk, index) => (
						<button
							key={`${chunk.path}:${index}`}
							type="button"
							className="gt_row gt_wFileRow"
							aria-current={chunk.path === openPath ? "true" : undefined}
							onClick={() => inspect?.kind === "commit" && setInspect({ ...inspect, path: chunk.path === openPath ? null : chunk.path })}
						>
							{fileIcon(chunk.path)}
							<span className="gt_name">{chunk.path.slice(chunk.path.lastIndexOf("/") + 1)}</span>
							<span className="gt_wDir">{chunk.path.includes("/") ? chunk.path.slice(0, chunk.path.lastIndexOf("/")) : ""}</span>
							{diffStat(chunk)}
						</button>
					))}
				{commitPatch.value?.truncated ? <p className="gt_note">{t("diffTruncated")}</p> : null}
			</div>
		);

		let ledger;
		if (list === "reflog") {
			const entries = reflog.value?.entries ?? [];
			ledger = placeholder(reflog, t) !== null
				? <p className="gt_statusLine">{placeholder(reflog, t)}</p>
				: entries.length === 0
					? <p className="gt_statusLine">{t("reflogEmpty")}</p>
					: entries.map((entry, index) => (
						<div
							key={`${entry.selector}:${index}`}
							role="button"
							tabIndex={0}
							className="gt_row gt_wLedgerRow"
							aria-current={entry.short === inspectSha ? "true" : undefined}
							onClick={() => expand({ sha: entry.short, short: entry.short, subject: entry.subject }, true)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									expand({ sha: entry.short, short: entry.short, subject: entry.subject }, true);
								}
							}}
						>
							<span className="gt_wSubject">
								<primitives.Tag tone={entry.action.startsWith(REBASE_ACTION_PREFIX) ? "warning" : "neutral"}>{entry.action}</primitives.Tag>
								<span className="gt_wSubjectText">{entry.subject}</span>
							</span>
							<span className="gt_wAuthor">{entry.selector}</span>
							<span className="gt_sha">{entry.short}</span>
							<span className="gt_time">{entry.date === null ? "" : entry.date.slice(5, 16).replace("T", " ")}</span>
						</div>
					)).flatMap((row, index) => entries[index].short === inspectSha ? [row, <Fragment key="files">{commitFiles(10, null)}</Fragment>] : [row]);
		} else if (placeholder(history, t) !== null) {
			ledger = <p className="gt_statusLine">{placeholder(history, t)}</p>;
		} else if (commits.length === 0) {
			ledger = <p className="gt_statusLine">{t(repoQuery ? "search.empty" : "historyEmpty")}</p>;
		} else {
			const gutter = commits.reduce((widest, commit) => Math.max(widest, commit.width ?? 1), 1) * LANE_W;
			const now = Date.now();
			ledger = commits.map((commit, index) => {
				const previous = commits[index - 1];
				const incoming = previous !== undefined && ((previous.columns ?? []).includes(commit.column ?? -1) || (previous.through ?? []).includes(commit.column ?? -1));
				const open = () => expand(commit, true);
				const isOpen = commit.sha === inspectSha;
				const row = (
					<div
						key={commit.sha}
						role="button"
						tabIndex={0}
						className="gt_row gt_wLedgerRow"
						data-ahead={commit.ahead === true}
						data-head={commit.sha === headCommit?.sha}
						aria-current={isOpen ? "true" : undefined}
						aria-expanded={isOpen}
						title={`${commit.short} ${commit.subject}`}
						style={{ position: "relative", paddingLeft: repoQuery ? 10 : LANE_INSET + gutter + 12 }}
						onClick={open}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								open();
							}
						}}
					>
						{/* Hidden commits cannot be joined by a truthful graph edge. */}
						{repoQuery ? null : laneGutter({ ...commit, incoming }, gutter)}
						<span className="gt_wSubject">
							{refTags(commit.refs, t)}
							<span className="gt_wSubjectText">{commit.subject}</span>
						</span>
						<span className="gt_wAuthor">{commit.author}</span>
						<span className="gt_sha">{commit.short}</span>
						<span className="gt_time">{timeLabel(commit.date, now, t)}</span>
					</div>
				);
				if (!isOpen) return row;
				const indent = repoQuery ? 10 : LANE_INSET + gutter + 12;
				return (
					<Fragment key={commit.sha}>
						{row}
						{commitFiles(indent, repoQuery ? null : laneContinuation((commit as { afterColors?: (string | undefined)[] }).afterColors ?? [], gutter))}
					</Fragment>
				);
			});
		}

		let inspector = null;
		if (inspect?.kind === "ci") {
			inspector = (
				<Fragment>
					<div className="gt_wInspectHead">
						<div className="gt_wInspectTitle">
							<strong>{t("view.ci")}</strong>
							<primitives.Button variant="ghost" size="sm" onClick={() => setInspect(null)}>{t("diffClose")}</primitives.Button>
						</div>
					</div>
					<div className="gt_wInspectBody">
						{h(CIView, {
							state: ci, auth, authRequested: authNonce > 0, remote: ciRemote, t, expanded,
							onExpand: (key: string, open: boolean) => setExpanded((value) => ({ ...value, [key]: open })),
							onAsk: (check: CICheck, step?: unknown) => {
								const context = { repository: ciValue?.repository, provider: ciValue?.provider, host: ciValue?.host, sha: ciValue?.sha, job: check.name, state: check.state, url: check.url, ...(step ? { phase: step } : { phases: check.steps }), stepsError: check.stepsError };
								try {
									if (!askAI(sessionId, `${t("ci.askPrompt")}\n\n${JSON.stringify(context, null, 2)}`)) setNotice(t("ci.askError"));
								} catch {
									setNotice(t("ci.askError"));
								}
							},
							onAuth: () => setAuthNonce((n) => n + 1),
							onRemote: (remote: string) => {
								setCIRemote(remote);
								setAuthNonce(0);
							}
						})}
					</div>
				</Fragment>
			);
		} else if (inspect?.kind === "commit" && inspect.path !== null) {
			// A commit reached from Blame or the reflog carries only what that row knew.
			const known = historyValue?.commits.find((commit) => commit.sha.startsWith(inspect.commit.sha));
			const commit: Commit = { ...inspect.commit, ...known };
			const chunk = commitChunks.find((candidate) => candidate.path === inspect.path);
			const split = !unified;
			inspector = (
				<Fragment>
					<div className="gt_wInspectHead">
						<div className="gt_wInspectTitle">
							<strong>{commit.subject || commit.short || commit.sha}</strong>
							<primitives.Button variant="ghost" size="sm" onClick={() => setInspect({ ...inspect, path: null })}>{t("diffClose")}</primitives.Button>
						</div>
						<div className="gt_meta">
							<code className="gt_sha" title={commit.sha}>{commit.short ?? commit.sha.slice(0, 7)}</code>
							<primitives.Button variant="ghost" size="sm" onClick={() => copy(commit.sha, "sha")}>{t(copied === "sha" ? "copied" : "repo.copySha")}</primitives.Button>
							{commit.author ? <span>{commit.author}</span> : null}
							{commit.date ? <time dateTime={commit.date}>{new Date(commit.date).toLocaleString()}</time> : null}
							{(commit.parents?.length ?? 0) > 1 ? <primitives.Tag tone="info">{`${t("parents")} ${commit.parents?.length}`}</primitives.Tag> : null}
							{refTags(commit.refs, t)}
						</div>
					</div>
					<div className="gt_wFileHead">
						{fileIcon(inspect.path)}
						{pathLabel(inspect.path)}
						{diffStat(chunk)}
						<primitives.Button
							variant="ghost"
							size="sm"
							aria-label={t("diff.split")}
							aria-pressed={split}
							title={t(split ? "diff.toUnified" : "diff.toSplit")}
							onClick={() => {
								setUnified(split);
								saveUnified(split);
							}}
						>
							<primitives.IconCompareSplitOutlineRegular className="gt_icon" />
						</primitives.Button>
					</div>
					<div className="gt_wInspectBody">
						{commitMessage !== null
							? <p className="gt_statusLine">{commitMessage}</p>
							: chunk === undefined
								? <p className="gt_statusLine">{t("diffNone")}</p>
								: chunk.binary
									? <p className="gt_statusLine">{t("diffBinary")}</p>
									: patchBody(hunksOf(chunk.text, chunk.path), t, { split, wrapped })}
					</div>
				</Fragment>
			);
		}

		body = (
			<div className="gt_wRepository">
				{rail}
				<section className="gt_wMain" {...panel}>
					<div className="gt_wListHead">
						<primitives.SegmentedControl
							id={`gt-list-${sessionId}`}
							value={list}
							options={[{ value: "commits", label: t("repo.commits") }, { value: "reflog", label: t("view.reflog") }]}
							onChange={setList}
							label={t("repo.list")}
						/>
						{list === "commits" ? (
							<input
								className="gt_input"
								type="search"
								value={repoFilter}
								placeholder={t("search.history")}
								aria-label={t("search.history")}
								onChange={(event) => setRepoFilter(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape") setRepoFilter("");
								}}
							/>
						) : null}
						{list === "commits" && historyValue !== null ? (
							<span className="gt_meta">
								{t("historyCount").replace("{n}", String(historyValue.total))}
								{historyValue.base?.name && historyValue.base.ahead > 0 ? <primitives.Tag tone="info">{t("aheadOfBase").replace("{n}", String(historyValue.base.ahead)).replace("{base}", historyValue.base.name)}</primitives.Tag> : null}
								{historyValue.base?.name && historyValue.base.behind > 0 ? <primitives.Tag tone="warning">{t("behindBase").replace("{n}", String(historyValue.base.behind)).replace("{base}", historyValue.base.name)}</primitives.Tag> : null}
							</span>
						) : null}
					</div>
					{list === "commits" && historyValue?.truncated ? <p className="gt_note">{t("historyTruncated").replace("{n}", String(historyValue.commits.length))}</p> : null}
					<div className="gt_wLedger" ref={setLedgerElement}>{ledger}</div>
					{headShown && headPlace !== "visible" ? (
						<button type="button" className="gt_wJump" data-place={headPlace} title={t("here.head")} onClick={scrollToHead}>
							{headPlace === "above" ? "↑" : "↓"} {t("here.jump")}
						</button>
					) : null}
				</section>
				{inspector === null ? null : <aside className="gt_wInspector" data-kind={inspect?.kind} aria-label={t(inspect?.kind === "ci" ? "view.ci" : "repo.inspector")}>{inspector}</aside>}
			</div>
		);
	}

	return (
		<div className="gt_wView" ref={root} onKeyDown={onKeyDown}>
			{header}
			{notes}
			{body}
		</div>
	);
}
