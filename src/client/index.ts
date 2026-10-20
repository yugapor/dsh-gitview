// @ts-nocheck -- `ctx` is a cordis context whose types are not installed here.
import "./styles";
import { NS, en, ja } from "./locales";
import { GROUPS, VIEWS, countsText, directoryPaths, flatten, sliceTree, stateOf } from "./model";
import { branchColor, colorGraph, laneGutter } from "./graph";
import { ROUTES, ciDisplayState, ciInterval, ciOverdue, query, read, readBlame, readBranches, readDiff, readHistory, readReflog, readStatus, sendMutation, write } from "./data";
import { PatchHunk, diffPane, operationBanner, patchParts, placeholder, splitHunk } from "./chrome";
import { BlameView, BranchesView, HistoryView, ReflogView, StatusView, changeSection, commitBox, identityDetails, treeRows } from "./views";
import { CIView } from "./ci";
import { GitTreeBody, TAB_ID, gitTreeDefinition } from "./sidebar";
import { GitWideView, fileChunks, reveal } from "./wide";
import { PlacementRow, placementStore } from "./settings";

/**
 * Host-side services this plugin waits for.
 *
 * `slots` is the body seat, `locale` the dictionaries, `sidebarRightTabs` the
 * type registry. The data channel is NOT a cordis service: a hand-written
 * external package cannot publish a Remote face (see the README), so the body
 * reaches the Host over HTTP routes on the GUI's own origin instead.
 */
const inject = ["slots", "locale", "sidebarRightTabs", "sessions", "conversation"];

/**
 * Client plugin body: register the dictionaries, the placement setting, and
 * the surfaces that setting asks for — the sidebar tab, the conversation view,
 * or both.
 *
 * Every registration sits inside its own `ctx.effect`, so unloading the plugin
 * (or disabling its Loader row) disposes exactly what it added.
 *
 * @param ctx - client root context carrying the registries.
 */
function apply(ctx) {
	const t = ctx.locale.bind(NS);

	ctx.effect(() => ctx.locale.register(NS, { en, ja }), "dsh-gitview: dictionaries");

	const business = {
		askAI: (sessionId, text) => {
			const actx = ctx.sessions.scope(sessionId);
			if (!actx) return false;
			const input = ctx.conversation.input.for(actx);
			const state = input.state.getSnapshot();
			if (state.phase !== "plain") return false;
			// Revision-guarded insertion preserves existing text and reference chips.
			// DSH's edit coordinates count each reference chip as one placeholder.
			const end = state.draft.length - (state.occurrences ?? []).reduce((extra, chip) => extra + chip.length - 1, 0);
			const inserted = actx.bail("slash/input-insert-text", { text: `${state.draft ? "\n\n" : ""}${text}`, span: { start: end, end, draftRev: state.draftRev } });
			if (inserted !== true) return false;
			// The draft is for reading before sending, so a folded composer opens first.
			input.focus();
			return true;
		},
		loadCI: (sessionId, remote, signal) => read(ROUTES.ci, { sessionId, remote }, signal),
		loadAuth: (sessionId, remote, signal) => read(ROUTES.auth, { sessionId, remote }, signal),
		loadStatus: (sessionId, signal) => readStatus(sessionId, signal),
		loadDiff: (sessionId, path, scope, rev, signal) => readDiff(sessionId, path, scope, rev, signal),
		loadHistory: (sessionId, signal) => readHistory(sessionId, signal),
		loadBranches: (sessionId, signal) => readBranches(sessionId, signal),
		loadReflog: (sessionId, signal) => readReflog(sessionId, signal),
		loadBlame: (sessionId, path, signal) => readBlame(sessionId, path, signal),
		mutate: (sessionId, body, signal) => sendMutation(sessionId, body, signal),
		generateMessage: (sessionId, language, signal) => write(ROUTES.message, sessionId, { language }, signal)
	};

	// Each surface is registered while the placement asks for it, and withdrawn
	// (type, body and all) the moment it stops: the shell then falls back to Chat
	// for a session that was showing the conversation view.
	const placement = placementStore();
	ctx.effect(() => {
		let shown = null;
		const withdrawals = [];
		const sync = () => {
			const value = placement.get();
			if (value === shown) return;
			shown = value;
			for (const withdraw of withdrawals.splice(0)) withdraw();
			// `slots.inject` waits for the slot's declaration epoch: the sidebar may load
			// after this plugin, and a re-declaration must re-register the body.
			// `inject` must be a FACTORY: the slot renderer calls it with the scope args
			// and spreads the result into the component's props.
			if (value !== "conversation") {
				withdrawals.push(
					ctx.sidebarRightTabs.register(gitTreeDefinition(t)),
					ctx.slots.inject("sidebar.right.pane.tab", () =>
						ctx.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID, locale: NS, inject: () => business }, GitTreeBody))
				);
			}
			if (value !== "sidebar") {
				withdrawals.push(
					// Order 20 seats Git after Trajectory (10) in the view tabs.
					ctx.slots.inject("conversation.view", () =>
						ctx.slots.register({ name: "conversation.view", id: "git", order: 20, locale: NS, label: () => t("type.label"), inject: () => business }, GitWideView))
				);
			}
		};
		sync();
		const unsubscribe = placement.subscribe(sync);
		return () => {
			unsubscribe();
			for (const withdraw of withdrawals.splice(0)) withdraw();
		};
	}, "dsh-gitview: surfaces");

	ctx.effect(
		() =>
			ctx.slots.inject("settings.general.item", () =>
				ctx.slots.register({ name: "settings.general.item", id: "dsh-gitview-placement", order: 30, locale: NS, inject: () => ({ placement }) }, PlacementRow)),
		"dsh-gitview: placement setting"
	);
}

export { apply, inject };
// Exposed for the boot-free tests; the module system ignores extra exports.
// Source views use the shell's grammar subscription.
export const __internals = {
	ROUTES,
	VIEWS,
	flatten,
	directoryPaths,
	countsText,
	stateOf,
	gitTreeDefinition,
	laneGutter,
	colorGraph,
	branchColor,
	sliceTree,
	GROUPS,
	query,
	GitTreeBody,
	CIView,
	identityDetails,
	StatusView,
	changeSection,
	HistoryView,
	BranchesView,
	BlameView,
	ReflogView,
	operationBanner,
	diffPane,
	patchParts,
	splitHunk,
	ciOverdue,
	ciDisplayState,
	ciInterval,
	PatchHunk,
	commitBox,
	treeRows,
	placeholder,
	GitWideView,
	fileChunks,
	reveal,
	PlacementRow
};
