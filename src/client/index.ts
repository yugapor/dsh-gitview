// @ts-nocheck -- moved verbatim from the hand-written bundle; type it when it is next changed.
import "./styles";
import { NS, en, ja } from "./locales";
import { GROUPS, VIEWS, countsText, directoryPaths, flatten, sliceTree, stateOf } from "./model";
import { branchColor, colorGraph, laneGutter } from "./graph";
import { ROUTES, ciDisplayState, ciInterval, ciOverdue, query, read, readBlame, readBranches, readDiff, readHistory, readReflog, readStatus, sendMutation, write } from "./data";
import { PatchHunk, diffPane, operationBanner, patchParts, placeholder, splitHunk } from "./chrome";
import { BlameView, BranchesView, HistoryView, ReflogView, StatusView, changeSection, commitBox, identityDetails, treeRows } from "./views";
import { CIView } from "./ci";
import { GitTreeBody, TAB_ID, gitTreeDefinition } from "./sidebar";

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
 * Client plugin body: register the dictionaries, the type, and its body.
 *
 * Every registration sits inside its own `ctx.effect`, so unloading the plugin
 * (or disabling its Loader row) disposes exactly what it added.
 *
 * @param ctx - client root context carrying the registries.
 */
function apply(ctx) {
	const t = ctx.locale.bind(NS);

	ctx.effect(() => ctx.locale.register(NS, { en, ja }), "dsh-gitview: dictionaries");

	ctx.effect(() => ctx.sidebarRightTabs.register(gitTreeDefinition(t)), "dsh-gitview: tab type");

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

	// `slots.inject` waits for the slot's declaration epoch: the sidebar may load
	// after this plugin, and a re-declaration must re-register the body.
	ctx.effect(
		() =>
			ctx.slots.inject("sidebar.right.pane.tab", () =>
				ctx.slots.register(
					// `inject` must be a FACTORY: the slot renderer calls it with the
					// scope args and spreads the result into the component's props.
					// Passing a plain object here throws at first render.
					{ name: "sidebar.right.pane.tab", key: TAB_ID, locale: NS, inject: () => business },
					GitTreeBody
				)
			),
		"dsh-gitview: tab body"
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
	placeholder
};
