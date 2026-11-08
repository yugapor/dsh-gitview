/**
 * Worktrees: every checkout of the repository, and where this session works.
 *
 * DSH moves a session into a linked worktree when its agent creates one (the
 * "Change requests & worktrees" plugin) or changes directory. Both surfaces
 * draw this one section so the reader can see which checkout the session is
 * in, where else unfinished work sits, and act on it: move the session to
 * another checkout, start a new one, lock, remove or prune.
 *
 * Moving the session and removing a checkout are deliberate acts, so the
 * remove and prune buttons ask once inline before anything is sent, and
 * nothing here ever forces git past a refusal.
 */
import { Fragment, h, primitives, react } from "./deps";
import { messageOf } from "./data";
import { placeholder } from "./chrome";
import { timeLabel } from "./views";
import type { Envelope, Resource, Translate, Worktree, WorktreeActionResult, Worktrees } from "./types";

/** The words a worktree refusal is shown with; anything unlisted reads as generic. */
export const WORKTREE_REJECTIONS: Record<string, string> = {
	"unknown-action": "rejected.unknown-action",
	"unknown-worktree": "worktree.rejected.unknown",
	"bare-worktree": "worktree.rejected.bare",
	"missing-worktree": "worktree.rejected.missing",
	"already-here": "worktree.rejected.here",
	"enter-unavailable": "worktree.rejected.enterUnavailable",
	"create-unavailable": "worktree.rejected.createUnavailable",
	"session-idle": "worktree.rejected.idle",
	"invalid-name": "worktree.rejected.name",
	"invalid-rev": "rejected.invalid-rev",
	"main-worktree": "worktree.rejected.main",
	"current-worktree": "worktree.rejected.current",
	"locked-worktree": "worktree.rejected.locked",
	"already-locked": "worktree.rejected.alreadyLocked",
	"not-locked": "worktree.rejected.notLocked",
	"worktree-busy": "worktree.rejected.busy"
};

export interface WorktreeRunner {
	busy: boolean;
	run(body: { action: string; path?: string; name?: string; from?: string }): Promise<boolean>;
}

/**
 * Send worktree actions one at a time and report them through the view's notice.
 *
 * A success re-reads everything, because entering or creating a checkout
 * changes the session's directory and with it every other answer.
 */
export function useWorktreeRunner(options: {
	sessionId: string;
	signal?: AbortSignal;
	t: Translate;
	worktreeAction: (sessionId: string, body: object, signal?: AbortSignal) => Promise<Envelope<WorktreeActionResult>>;
	setNotice: (value: string | null) => void;
	onDone: () => void;
}): WorktreeRunner {
	const { sessionId, signal, t, worktreeAction, setNotice, onDone } = options;
	const [busy, setBusy] = react.useState(false);
	const run = react.useCallback(async (body: { action: string; path?: string; name?: string; from?: string }) => {
		setBusy(true);
		setNotice(null);
		try {
			const result = await worktreeAction(sessionId, body, signal);
			if (result.ok !== true) {
				setNotice(t("error").replace("{message}", messageOf(result.error)));
				return false;
			}
			const value = result.value;
			if (value.kind === "rejected") {
				setNotice(t(WORKTREE_REJECTIONS[value.code ?? ""] ?? "rejected.generic"));
				return false;
			}
			if (value.kind === "failed") {
				setNotice(value.message ?? t("rejected.generic"));
				return false;
			}
			if (value.kind !== "ready") {
				setNotice(value.kind === "no-workspace" ? t("noWorkspace") : t("noRepository"));
				return false;
			}
			if (value.entered) setNotice(t("worktree.entered").replace("{path}", value.entered));
			onDone();
			return true;
		} finally {
			setBusy(false);
		}
	}, [sessionId, signal, t, worktreeAction, setNotice, onDone]);
	return { busy, run };
}

/** What a row is called: its branch, else the detached commit, else its directory. */
export function worktreeTitle(entry: Worktree, t: Translate) {
	if (entry.bare) return t("worktree.bare");
	if (entry.branch) return entry.branch;
	return t("worktree.detachedAt").replace("{sha}", entry.short ?? entry.head?.slice(0, 7) ?? "?");
}

/**
 * The tags a row carries, in a fixed order so rows scan alike: where the session
 * is, which checkout is the main one, who made it, then what blocks acting on it.
 */
function worktreeTags(entry: Worktree, t: Translate) {
	return (
		<Fragment>
			{entry.current ? <primitives.Tag tone="success">{t("worktree.thisSession")}</primitives.Tag> : null}
			{entry.main ? <primitives.Tag tone="neutral">{t("worktree.main")}</primitives.Tag> : null}
			{entry.pool ? <span title={t("worktree.poolHint")}><primitives.Tag tone="info">{t("worktree.pool")}</primitives.Tag></span> : null}
			{entry.locked ? <span title={entry.lockReason ?? t("worktree.locked")}><primitives.Tag tone="warning">{t("worktree.locked")}</primitives.Tag></span> : null}
			{entry.prunable ? <span title={entry.prunableReason ?? t("worktree.missing")}><primitives.Tag tone="danger">{t("worktree.missing")}</primitives.Tag></span> : null}
		</Fragment>
	);
}

/** How much is unfinished in one checkout: changed paths, then commits not pushed. */
function worktreeState(entry: Worktree, t: Translate) {
	const parts: ReturnType<typeof h>[] = [];
	if (entry.changed !== null && entry.changed > 0) {
		parts.push(<span key="changed" className="gt_warning">{t("worktree.changed").replace("{n}", String(entry.changed))}</span>);
	} else if (entry.changed === 0) {
		parts.push(<span key="clean">{t("worktree.clean")}</span>);
	}
	if (entry.ahead > 0) parts.push(<span key="ahead" className="gt_success" title={t("ahead").replace("{n}", String(entry.ahead))}>↑{entry.ahead}</span>);
	if (entry.behind > 0) parts.push(<span key="behind" className="gt_danger" title={t("behind").replace("{n}", String(entry.behind))}>↓{entry.behind}</span>);
	return parts.length === 0 ? null : <span className="gt_wtState">{parts}</span>;
}

/**
 * The Worktrees section: one row per checkout, the section's own actions in its
 * heading, and the inline form that starts a new checkout.
 *
 * @param props.state - the `api/git.worktrees` resource.
 * @param props.runner - from {@link useWorktreeRunner}.
 * @param props.base - what a new checkout starts from by default (the current branch).
 * @param props.compact - the narrow sidebar: no subject line.
 * @param props.always - draw the section even for a repository with one checkout.
 */
export function WorktreeSection(props: {
	state: Resource<Worktrees | { kind: string }>;
	t: Translate;
	runner: WorktreeRunner;
	disabled?: boolean;
	base?: string | null;
	compact?: boolean;
	always?: boolean;
}) {
	const { state, t, runner, disabled = false, base = null, compact = false, always = false } = props;
	const [confirm, setConfirm] = react.useState<string | null>(null);
	const [creating, setCreating] = react.useState(false);
	const [from, setFrom] = react.useState("");
	const [name, setName] = react.useState("");
	const [copied, setCopied] = react.useState<string | null>(null);

	const value = state.phase === "ready" && state.value?.kind === "ready" ? state.value as Worktrees : null;
	const list = value?.worktrees ?? [];
	const actions = value?.actions ?? { running: false, enter: false, create: false };
	const busy = runner.busy || disabled;
	const missing = list.filter((entry) => entry.prunable).length;

	// A repository with one checkout and nothing to start has nothing to say here.
	if (!always && value !== null && list.length <= 1 && !actions.create) return null;
	if (!always && value === null && state.phase !== "error") return null;

	const idleHint = actions.running ? null : t("worktree.idleHint");
	const copy = async (path: string) => {
		if (await primitives.writeClipboard(path)) {
			setCopied(path);
			setTimeout(() => setCopied(null), 1000);
		}
	};
	const stop = (run: () => void) => (event: { stopPropagation(): void }) => {
		event.stopPropagation();
		run();
	};

	const row = (entry: Worktree) => {
		const asking = confirm === `remove:${entry.path}`;
		const canEnter = actions.enter && !entry.current && !entry.prunable && !entry.bare;
		const canRemove = !entry.main && !entry.current && !entry.locked && !entry.prunable && !entry.bare;
		const canLock = !entry.main && !entry.bare && !entry.prunable;
		const time = entry.date ? timeLabel(entry.date, Date.now(), t) : null;
		return (
			<div
				key={entry.path}
				className="gt_row gt_wtRow"
				data-current={entry.current}
				data-missing={entry.prunable}
				aria-current={entry.current ? "true" : undefined}
				title={[entry.path, entry.subject].filter(Boolean).join("\n")}
			>
				<span className="gt_wtIcon" aria-hidden="true">
					{entry.main ? <primitives.IconFolderCloseRegular className="gt_icon" /> : <primitives.IconBranchOutlineRegular className="gt_icon" />}
				</span>
				<span className="gt_wtBody">
					<span className="gt_wtLine gt_wtTitle">
						<span className="gt_name">{worktreeTitle(entry, t)}</span>
						{worktreeTags(entry, t)}
					</span>
					<span className="gt_wtLine gt_wtMeta">
						<span className="gt_wtDir">{entry.name}</span>
						{worktreeState(entry, t)}
					</span>
					{compact || !entry.subject ? null : (
						<span className="gt_wtLine gt_wtMeta">
							<span className="gt_sha">{entry.short}</span>
							<span className="gt_wtSubject">{entry.subject}</span>
							{time ? <span className="gt_time">{time}</span> : null}
						</span>
					)}
					{asking ? (
						<span className="gt_wtConfirm" role="group" aria-label={t("worktree.remove")}>
							<span>{t("worktree.removeConfirm").replace("{name}", entry.name)}</span>
							<primitives.Button variant="outline" size="sm" disabled={busy} onClick={stop(() => {
								setConfirm(null);
								runner.run({ action: "remove", path: entry.path });
							})}>{t("worktree.remove")}</primitives.Button>
							<primitives.Button variant="ghost" size="sm" onClick={stop(() => setConfirm(null))}>{t("worktree.cancel")}</primitives.Button>
						</span>
					) : (
						<span className="gt_wtActions">
							{canEnter ? (
								<primitives.Button
									variant="ghost"
									size="sm"
									disabled={busy || !actions.running}
									title={idleHint ?? t("worktree.enterHint")}
									onClick={stop(() => runner.run({ action: "enter", path: entry.path }))}
								>
									{entry.main ? t("worktree.return") : t("worktree.enter")}
								</primitives.Button>
							) : null}
							<primitives.Button variant="ghost" size="sm" title={entry.path} onClick={stop(() => copy(entry.path))}>
								{copied === entry.path ? t("copied") : t("worktree.copyPath")}
							</primitives.Button>
							{canLock ? (
								<primitives.Button
									variant="ghost"
									size="sm"
									disabled={busy}
									title={t(entry.locked ? "worktree.unlockHint" : "worktree.lockHint")}
									onClick={stop(() => runner.run({ action: entry.locked ? "unlock" : "lock", path: entry.path }))}
								>
									{t(entry.locked ? "worktree.unlock" : "worktree.lock")}
								</primitives.Button>
							) : null}
							{canRemove ? (
								<primitives.Button variant="ghost" size="sm" disabled={busy} title={t("worktree.removeHint")} onClick={stop(() => setConfirm(`remove:${entry.path}`))}>
									{t("worktree.remove")}
								</primitives.Button>
							) : null}
						</span>
					)}
				</span>
			</div>
		);
	};

	const startFrom = from.trim() || base || "HEAD";
	const create = () => {
		if (busy || !actions.running) return;
		runner.run({ action: "create", from: startFrom, ...(name.trim() === "" ? {} : { name: name.trim() }) }).then((ok) => {
			if (!ok) return;
			setCreating(false);
			setName("");
			setFrom("");
		});
	};
	const form = creating ? (
		<form
			className="gt_wtForm"
			onSubmit={(event) => {
				event.preventDefault();
				create();
			}}
		>
			<label className="gt_wtField">
				<span>{t("worktree.from")}</span>
				<input className="gt_input" value={from} placeholder={base ?? "HEAD"} aria-label={t("worktree.from")} onChange={(event) => setFrom(event.target.value)} />
			</label>
			<label className="gt_wtField">
				<span>{t("worktree.branchName")}</span>
				<input className="gt_input" value={name} placeholder={t("worktree.branchAuto")} aria-label={t("worktree.branchName")} onChange={(event) => setName(event.target.value)} />
			</label>
			<p className="gt_note">{t("worktree.createHint")}</p>
			<span className="gt_wtFormActions">
				<primitives.Button variant="primary" size="sm" disabled={busy || !actions.running} title={idleHint ?? undefined} onClick={(event: { preventDefault(): void }) => {
					// Whatever type the shell's Button renders, the form must not submit twice.
					event.preventDefault();
					create();
				}}>{t("worktree.create")}</primitives.Button>
				<primitives.Button variant="ghost" size="sm" onClick={(event: { preventDefault(): void }) => {
					event.preventDefault();
					setCreating(false);
				}}>{t("worktree.cancel")}</primitives.Button>
			</span>
		</form>
	) : null;

	const askingPrune = confirm === "prune";
	return (
		<div className="gt_group gt_wtGroup">
			<div className="gt_section">
				{t("worktree.title")}
				<span className="gt_count">{list.length || ""}</span>
				{actions.create && !creating ? (
					<primitives.Button variant="ghost" size="sm" disabled={busy} title={idleHint ?? t("worktree.newHint")} onClick={() => setCreating(true)}>{t("worktree.new")}</primitives.Button>
				) : null}
				{missing > 0 && !askingPrune ? (
					<primitives.Button variant="ghost" size="sm" disabled={busy} title={t("worktree.pruneHint")} onClick={() => setConfirm("prune")}>{t("worktree.prune")}</primitives.Button>
				) : null}
			</div>
			{askingPrune ? (
				<div className="gt_wtConfirm gt_wtSectionConfirm" role="group" aria-label={t("worktree.prune")}>
					<span>{t("worktree.pruneConfirm").replace("{n}", String(missing))}</span>
					<primitives.Button variant="outline" size="sm" disabled={busy} onClick={() => {
						setConfirm(null);
						runner.run({ action: "prune" });
					}}>{t("worktree.prune")}</primitives.Button>
					<primitives.Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>{t("worktree.cancel")}</primitives.Button>
				</div>
			) : null}
			{form}
			{value === null ? <p className="gt_note">{placeholder(state, t) ?? t("loading")}</p> : list.map(row)}
			{value?.truncated ? <p className="gt_note">{t("worktree.truncated")}</p> : null}
		</div>
	);
}

/**
 * The header's mark for a session working in a linked worktree, naming the
 * checkout it belongs to so the path beside it is not mistaken for the project.
 */
export function linkedBadge(checkout: { linked: boolean; mainRoot: string | null } | undefined, t: Translate) {
	if (!checkout?.linked) return null;
	const title = checkout.mainRoot ? t("worktree.linkedOf").replace("{path}", checkout.mainRoot) : t("worktree.linked");
	return <span className="gt_wtBadge" title={title}><primitives.Tag tone="info">{t("worktree.linked")}</primitives.Tag></span>;
}

/** A branch row's mark when another checkout has that branch, so it is not checked out twice. */
export function branchWorktreeTag(branch: { worktree?: string | null; current?: boolean }, t: Translate) {
	if (!branch.worktree || branch.current) return null;
	return <span title={t("worktree.branchElsewhere").replace("{path}", branch.worktree)}><primitives.Tag tone="neutral">{t("worktree.branchTag")}</primitives.Tag></span>;
}
