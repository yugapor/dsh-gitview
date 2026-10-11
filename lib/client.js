/**
 * Browser half of dsh-gitview.
 *
 * Hand-written `__ModuleLoader__` bundle: the Host serves this file verbatim
 * under `/plugins`, so the wrapper below is the contract, not a build artifact.
 *
 * What it registers, through exactly the same public path the shipped Files and
 * Terminal tabs use:
 *
 *   1. a tab TYPE          — `ctx.sidebarRightTabs.register({ id, kind, guide, … })`
 *      whose single `guide` entry becomes the button on the sidebar's Start page;
 *   2. a tab BODY          — `ctx.slots.register({ name: 'sidebar.right.pane.tab', … })`
 *      keyed by the same `id`, which draws the views;
 *   3. two dictionaries    — `ctx.locale.register('gitTree', { en, ja })`.
 *
 * Only seeded platform modules are required (`react` and
 * `@deepseek-ai/dsh-client-ui-primitives`), so the package needs no
 * `dsh.client.external` entry: the shell's frozen module table answers both.
 * Primitive props and the source highlighter follow the installed shell's types.
 *
 * The tab is a PAGE type: it names no `patterns`, so it never competes for
 * `dsh-resource://` addresses and cannot steal file opening from the shipped
 * document preview. It is reached from its guide entry, or by kind.
 *
 * The sidebar is narrow, so the layout is a list with an optional detail pane
 * BELOW it (a patch, or one commit) rather than lazygit's three columns.
 */

window.__ModuleLoader__.load({
	id: "dsh-gitview",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const h = react.createElement;

		/** Locale namespace this plugin owns. */
		const NS = "gitTree";
		/** This implementation's identity in the tab system, and its body's slot key. */
		const TAB_ID = "dsh-gitview";
		/** The tab kind this package owns. */
		const TAB_KIND = "git-tree";

		//#region stylesheet
		// Theme colours and primitives belong to the shell; this sheet owns the layout.
		const CSS = `
.gt_root { box-sizing: border-box; height: 100%; min-height: 0; min-width: 0; color: var(--dsw-alias-label-primary); font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 1.5; flex-direction: column; flex: auto; display: flex; container-type: inline-size; }
.gt_header { flex: none; align-items: center; gap: 10px; padding: 14px 14px 10px; display: flex; flex-wrap: wrap; min-width: 0; }
.gt_repo { min-width: 0; flex: 1; }
.gt_branch { display: flex; align-items: center; gap: 6px; font-weight: 600; min-width: 0; }
.gt_repoPath { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; }
.gt_views { flex: none; display: flex; gap: 2px; margin: 0 12px 10px; padding: 3px; background: var(--dsw-alias-bg-layer-2); border-radius: var(--dsw-radius-sm); overflow-x: auto; min-width: 0; }
.gt_views .gt_view { flex: 1 0 auto; border: 0; border-radius: var(--dsw-radius-sm); padding: 5px 8px; font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-secondary); }
.gt_views .gt_view[aria-pressed=true] { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); font-weight: 600; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.gt_toolbar { flex: none; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 0 12px 8px; }
.gt_summary { width: 100%; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); padding: 0 4px 4px; }
.gt_body { flex: 1 1 auto; min-height: 0; min-width: 0; overflow: auto; scrollbar-gutter: stable; padding: 0 10px 12px; }
.gt_body::-webkit-scrollbar-track { margin: 2px; }
.gt_row { box-sizing: border-box; width: 100%; min-width: 0; color: inherit; font: inherit; text-align: left; border-radius: var(--dsw-radius-sm); cursor: pointer; background: 0 0; border: 0; align-items: center; gap: 8px; padding: 5px 10px; display: flex; }
.gt_row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gt_row[aria-current=true] { background: var(--dsw-alias-interactive-bg-hover); box-shadow: inset 3px 0 var(--dsw-alias-link); }
.gt_row:focus-visible, .gt_view:focus-visible, .gt_input:focus-visible { outline: 2px solid var(--dsw-alias-link); outline-offset: -2px; }
.gt_row > .gt_name { flex: 1; }
.gt_row[aria-disabled=true] { color: var(--dsw-alias-label-tertiary); cursor: default; }
.gt_row[aria-disabled=true]:hover { background: 0 0; }
.gt_icon { color: var(--dsw-alias-label-tertiary); flex: none; }
.gt_disclosure { display: inline-flex; width: 12px; height: 12px; flex: none; color: var(--dsw-alias-label-secondary); }
.gt_row[aria-expanded=true] .gt_disclosure svg { transform: rotate(90deg); }
.gt_fileIcon { flex: none; }
.gt_name { white-space: nowrap; text-overflow: ellipsis; min-width: 0; overflow: hidden; }
.gt_note { font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-tertiary); margin: 0; padding: 3px 10px; }
.gt_statusLine { color: var(--dsw-alias-label-secondary); margin: 0; line-height: 1.6; padding: 28px 16px; text-align: center; overflow-wrap: anywhere; }
.gt_group { margin-bottom: 10px; border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); padding-bottom: 4px; }
.gt_section { font: var(--dsw-font-xxs-12); font-weight: 600; color: var(--dsw-alias-label-secondary); align-items: center; gap: 8px; padding: 9px 10px 6px; display: flex; }
.gt_section .gt_count { margin-left: auto; font-variant-numeric: tabular-nums; }
.gt_count { color: var(--dsw-alias-label-tertiary); }
.gt_change { font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); flex: none; }
.gt_diffStat { display: inline-flex; gap: 5px; flex: none; font: var(--dsw-font-xxxs-11); font-variant-numeric: tabular-nums; }
.gt_actions { flex: none; align-items: center; gap: 2px; display: flex; margin-left: auto; }
.gt_actions button { padding: 0; min-width: 26px; min-height: 26px; font-size: 18px; }
.gt_success { color: var(--dsw-alias-state-success-primary); }
.gt_warning { color: var(--dsw-alias-state-warn-label); }
.gt_danger { color: var(--dsw-alias-state-error-primary); }
.gt_info { color: var(--dsw-alias-link); }
.gt_neutral { color: var(--dsw-alias-label-tertiary); }
.gt_time { font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); margin-left: auto; flex: none; font-variant-numeric: tabular-nums; }
.gt_sha { font: var(--dsw-font-xxxs-11); font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); color: var(--dsw-alias-label-tertiary); flex: none; }
.gt_subject { min-width: 0; overflow-wrap: anywhere; line-height: 1.45; }
.gt_stack { min-width: 0; flex: 1 1 auto; }
.gt_meta { color: var(--dsw-alias-label-secondary); align-items: center; gap: 6px; display: flex; min-width: 0; flex-wrap: wrap; font: var(--dsw-font-xxs-12); }
.gt_history { color: var(--dsw-alias-link); }
.gt_history .gt_stack { color: var(--dsw-alias-label-primary); padding: 7px 0; }
.gt_history .gt_row[data-ahead=true]::before { content: ""; position: absolute; left: 0; top: 22%; bottom: 22%; width: 2px; background: var(--dsw-alias-link); }
.gt_refDot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex: none; margin-right: 4px; }
.gt_branchRow { display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; min-width: 0; }
.gt_branchRow .gt_subject { font-weight: 500; }
.gt_pane { border-top: 1px solid var(--dsw-alias-border-l2); flex: 0 1 55%; flex-direction: column; display: flex; min-height: 100px; min-width: 0; max-height: calc(100% - 140px); }
.gt_resize { height: 8px; flex: none; cursor: row-resize; touch-action: none; display: grid; place-items: center; }
.gt_resize::after { content: ""; width: 36px; height: 2px; background: var(--dsw-alias-border-l1); border-radius: 2px; }
.gt_resize:hover, .gt_resize:focus-visible { background: var(--dsw-alias-interactive-bg-hover); outline: 2px solid var(--dsw-alias-link); outline-offset: -2px; }
.gt_search { display: flex; align-items: center; gap: 6px; padding: 0 10px 8px; flex: none; }
.gt_search .gt_input { padding: 6px 8px; font: var(--dsw-font-xxs-12); }
.gt_paneHead { align-items: center; gap: 6px; padding: 8px 12px; display: flex; flex-wrap: wrap; flex: none; }
.gt_paneTitle { width: 100%; display: flex; align-items: center; gap: 6px; min-width: 0; border-left: 3px solid var(--dsw-alias-link); padding-left: 8px; }
.gt_paneLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.gt_paneBody { overflow: auto; min-height: 0; }
.gt_patch { margin: 0; font: 12px/1.8 var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); min-width: max-content; }
.gt_patch[data-wrap=true] { min-width: 0; }
.gt_patch[data-layout=split] { width: 100%; min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.gt_splitSide { margin: 0; min-width: 0; display: grid; grid-template-rows: subgrid; overflow-x: auto; font: inherit; }
.gt_splitSide:first-child { border-right: 1px solid var(--dsw-alias-border-l2); }
.gt_splitSide > .gt_patchLine { min-width: max-content; }
.gt_patch[data-wrap=true] .gt_splitSide > .gt_patchLine { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.gt_splitSide > [data-empty=true] { background: var(--dsw-alias-bg-layer-2); }
.gt_patchNote { color: var(--dsw-alias-label-tertiary); display: block; font-style: italic; white-space: pre-wrap; }
.gt_diffLayout { display: flex; gap: 2px; border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); padding: 2px; }
.gt_diffLayout button[aria-pressed=true] { background: var(--dsw-alias-interactive-bg-hover); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.gt_patchLine { display: flex; white-space: pre; padding: 0 12px; min-height: 1.8em; }
.gt_patchCode { flex: 1; min-width: 0; }
.gt_patch[data-wrap=true] .gt_patchCode { white-space: pre-wrap; overflow-wrap: anywhere; }
.gt_patchNumber { color: var(--dsw-alias-label-tertiary); width: 4ch; text-align: right; padding-right: 1ch; flex: none; user-select: none; font-variant-numeric: tabular-nums; }
.gt_patchMeta { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-layer-2); }
.gt_patchAdd { background: var(--dsw-alias-code-diff-added); box-shadow: inset 3px 0 var(--dsw-alias-state-success-primary); }
.gt_patchDelete { background: var(--dsw-alias-code-diff-deleted); box-shadow: inset 3px 0 var(--dsw-alias-state-error-primary); }
.gt_patchSign { color: var(--dsw-alias-label-secondary); width: 1ch; flex: none; user-select: none; }
.gt_patchAdd .gt_patchSign { color: var(--dsw-alias-state-success-primary); }
.gt_patchDelete .gt_patchSign { color: var(--dsw-alias-state-error-primary); }
.gt_commit { flex: none; flex-direction: column; gap: 8px; border-top: 1px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-2); padding: 12px; display: flex; }
.gt_input { box-sizing: border-box; min-width: 0; width: 100%; color: var(--dsw-alias-label-primary); background: transparent; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); font: inherit; resize: vertical; padding: 8px 10px; }
.gt_input:focus { border-color: var(--dsw-alias-border-l1); }
.gt_input::placeholder { color: var(--dsw-alias-label-tertiary); }
.gt_commitRow { align-items: center; gap: 8px; display: flex; min-width: 0; flex-wrap: wrap; }
.gt_commitRow button { flex: none; white-space: nowrap; }
.gt_identity { font: var(--dsw-font-xxs-12); overflow-wrap: anywhere; }
.gt_identity summary { cursor: pointer; color: var(--dsw-alias-label-secondary); }
.gt_identity summary:focus-visible { outline: 2px solid var(--dsw-alias-link); }
.gt_identity dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; margin: 8px 0 0; }
.gt_identity dt { color: var(--dsw-alias-label-tertiary); }
.gt_identity dd { margin: 0; min-width: 0; white-space: pre-wrap; }
.gt_ciView { display: flex; flex-direction: column; gap: 12px; }
.gt_ciView > * { flex: none; }
.gt_ciHead { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.gt_ciHead label { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.gt_ciHead .gt_input { width: auto; max-width: 100%; padding: 5px 8px; flex: 0 1 auto; }
.gt_ciHead button { font: var(--dsw-font-xxs-12); margin-left: auto; }
.gt_ciOverview { border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); padding: 12px; }
.gt_ciOverviewHead, .gt_ciContext, .gt_ciJobHead { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.gt_ciIdentity { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.gt_ciIdentity strong { display: block; font-weight: 600; }
.gt_ciOverviewHead > .gt_ciState { padding: 3px 8px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); font-weight: 600; }
.gt_ciContext { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l3); font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); }
.gt_ciPoll { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; }
.gt_ciState { display: inline-flex; align-items: center; gap: 5px; font: var(--dsw-font-xxs-12); flex: none; }
.gt_ciBadge { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; font: var(--dsw-font-xxs-12); }
.gt_ciStatusIcon { width: 14px; height: 14px; flex: none; }
.gt_ciSpinner { box-sizing: border-box; width: 12px; height: 12px; flex: none; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: gt_ciSpin .8s linear infinite; }
@keyframes gt_ciSpin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .gt_ciSpinner { animation: none; } }
.gt_ciRow { padding: 12px; min-width: 0; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.gt_ciRow:last-child { margin-bottom: 0; }
.gt_ciJobs { min-width: 0; }
.gt_ciJobHead .gt_subject { font-weight: 500; }
.gt_ciJobHead > .gt_ciState { margin-left: auto; }
.gt_ciRow a { color: var(--dsw-alias-link); text-decoration: none; overflow-wrap: anywhere; }
.gt_ciRow a:hover { text-decoration: underline; }
.gt_ciSteps { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l3); }
.gt_ciSteps summary { cursor: pointer; color: var(--dsw-alias-label-secondary); display: flex; align-items: center; gap: 6px; list-style: none; font: var(--dsw-font-xxs-12); border-radius: var(--dsw-radius-sm); padding: 3px 0; }
.gt_ciSteps summary::-webkit-details-marker { display: none; }
.gt_ciSteps[open] .gt_disclosure svg { transform: rotate(90deg); }
.gt_ciStepCount { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.gt_ciSteps summary:focus-visible { outline: 2px solid var(--dsw-alias-link); }
.gt_ciSteps ol { list-style: none; padding: 0; margin: 8px 0 0; }
.gt_ciStep { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: start; column-gap: 8px; row-gap: 2px; padding: 7px 4px; overflow-wrap: anywhere; border-radius: var(--dsw-radius-sm); font: var(--dsw-font-xxs-12); }
.gt_ciStepNumber { display: grid; place-items: center; width: 22px; height: 22px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l3); border-radius: 50%; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.gt_ciStep .gt_subject { align-self: center; }
.gt_ciStepMeta { justify-content: flex-end; align-self: center; font-variant-numeric: tabular-nums; }
.gt_ciStep[aria-current=step] { background: var(--dsw-alias-interactive-bg-hover); box-shadow: inset 3px 0 var(--dsw-alias-link); }
.gt_ciStep[data-state=failure] { box-shadow: inset 3px 0 var(--dsw-alias-state-error-primary); }
.gt_ciStep:focus-visible { outline: 2px solid var(--dsw-alias-link); }
.gt_connection { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); overflow-wrap: anywhere; font: var(--dsw-font-xxs-12); }
.gt_connection summary { cursor: pointer; color: var(--dsw-alias-label-secondary); }
.gt_connection summary:focus-visible { outline: 2px solid var(--dsw-alias-link); }
.gt_connection > div { margin-top: 8px; }
@container (max-width: 340px) { .gt_ciStepMeta { grid-column: 2 / -1; justify-content: flex-start; } }
.gt_banner { font: var(--dsw-font-xxs-12); flex: none; border-bottom: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-2); padding: 6px 10px; }
.gt_bannerTop { align-items: center; gap: 6px; display: flex; }
.gt_bannerDetail { color: var(--dsw-alias-label-tertiary); }
.gt_alert { font: var(--dsw-font-xxs-12); color: var(--dsw-alias-state-error-primary); flex: none; padding: 6px 10px; white-space: pre-wrap; max-height: 96px; overflow: auto; }
.gt_blame { font: var(--dsw-font-xxs-12); }
.gt_blameRow { align-items: center; gap: 6px; padding: 2px 10px; display: flex; min-width: max-content; min-height: 28px; }
.gt_blameRow[aria-current=true] { background: var(--dsw-alias-interactive-bg-hover); box-shadow: inset 3px 0 var(--dsw-alias-link); }
.gt_blameRow[data-group-start=true]:not(:first-child) { border-top: 1px solid var(--dsw-alias-border-l3); margin-top: 4px; padding-top: 5px; }
.gt_blameCommit { width: 82px; flex: none; }
.gt_blameCommit button { width: 100%; text-align: left; }
.gt_blameLine { color: var(--dsw-alias-label-tertiary); text-align: right; flex: none; width: 38px; font-variant-numeric: tabular-nums; }
.gt_blameAuthor { min-width: 0; flex: none; width: 78px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gt_blameText { white-space: pre; min-width: 0; flex: 1 1 auto; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.gt_blameUncommitted { color: var(--dsw-alias-state-warn-label); }
@container (max-width: 340px) { .gt_commitRow { flex-wrap: wrap; } .gt_commitRow .gt_input { flex-basis: 100% !important; } .gt_commitRow button { width: 100%; } }
@container (max-width: 420px) { .gt_diffStat { display: none; } }
`;

		/** The document this bundle is running in, when there is one. */
		const STYLE_ID = "dsh-gitview/panel.css";

		/**
		 * Put the stylesheet in the document once.
		 *
		 * The idiom — a `data-plugin-css` marker naming the owning package — is the one
		 * every shipped client bundle uses, so the tag can be found and replaced rather
		 * than duplicated. It is guarded because this module is also loaded in tests and
		 * in any context without a DOM.
		 */
		function injectStyles() {
			if (typeof document === "undefined" || document.head === undefined) return;
			const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`);
			if (existing !== null) { existing.textContent = CSS; return; }
			const tag = document.createElement("style");
			tag.dataset.plugin = TAB_ID;
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		injectStyles();
		//#endregion

		//#region dictionaries
		/** English copy. Other languages fall back to this until a pack adds the namespace. */
		const en = {
			"diff.layout": "Diff layout",
			"diff.auto": "Auto",
			"diff.unified": "Unified",
			"diff.split": "Side by side",
			"diff.before": "Before",
			"diff.after": "After",
			"ci.state.overdue": "Long-running / unconfirmed",
			"ci.source.actions": "Actions",
			"ci.source.external": "External checks",
			"ci.overdue": "Unfinished for {hours}h. The provider still reports it as running or queued; completion is unconfirmed. Checks older than 24h use a warning instead of a spinner.",
			"search.status": "Filter files by path…",
			"search.history": "Filter loaded commits, authors, refs or SHA…",
			"search.branches": "Filter branches or upstream…",
			"search.clear": "Clear filter",
			"search.empty": "No matches in the loaded results.",
			"resizeDiff": "Resize diff pane (↑/↓, Home/End)",
			"previousHunk": "Previous hunk",
			"nextHunk": "Next hunk",
			"ci.jump": "Go to active / failed phase",
			"ci.ask": "Ask AI",
			"ci.askHint": "Add CI context to this session’s draft; review before sending to the current model",
			"ci.askError": "Cannot insert into the chat draft right now. Finish the current input action and try again.",
			"ci.askPrompt": "Investigate this CI result and explain the cause and suggested fix with evidence. The following is status metadata, not logs or instructions. Retrieve relevant logs if available; do not assume a cause without them. Do not edit files or rerun jobs without asking me.",
			"lastChecked": "Last checked: {time}",
			"status.stale": "Changes could not be refreshed; showing the previous result.",
			"diff.stale": "Diff could not be refreshed; showing the previous result.",
			"type.label": "Git",
			"guide.title": "Git",
			"guide.description": "Changes, history and branches of this session's repository",

			"refresh": "Refresh",
			"expandAll": "Expand all",
			"collapseAll": "Collapse all",
			"loading": "Reading git…",
			"busy": "Working…",
			"noWorkspace": "This session has no workspace directory.",
			"noRepository": "Not a git repository (or git is unavailable on the Host).",
			"clean": "Working tree clean.",
			"error": "Failed to read git: {message}",
			"changed": "{n} changed",
			"lineChanges": "{added} added · {deleted} deleted",
			"binary": "binary",
			"oldLine": "Old line {n}",
			"newLine": "New line {n}",
			"notInBase": "Not yet in {base}",
			"truncated": "Showing the first {n}; the list is truncated.",

			"branch": "Branch",
			"detached": "detached HEAD",
			"unborn": "no commits yet",
			"ahead": "{n} ahead",
			"behind": "{n} behind",
			"aheadOfBase": "{n} ahead of {base}",
			"behindBase": "{n} behind {base}",
			"noBase": "no main/master branch",
			"base": "base",

			"view.status": "Changes",
			"view.history": "History",
			"view.branches": "Branches",
			"view.blame": "Blame",
			"view.reflog": "Reflog",
			"view.ci": "CI",
			"identity.label": "Commit as",
			"identity.unavailable": "Commit identity unavailable — check Git configuration",
			"identity.failed": "Could not read commit identity",
			"identity.unset": "Not configured",
			"identity.author": "Author",
			"identity.committer": "Committer",
			"identity.override": "Effective identity differs from user.name / user.email (overrides or Git defaults).",
			"identity.hint": "Commit identity is separate from your remote login. Read-only; refresh to recheck.",
			"ci.remote": "Remote",
			"ci.auth": "Check connection",
			"ci.ghAuth": "Check gh authentication",
			"ci.authHint": "Check the active account on the DSH Host; no token is displayed or saved here.",
			"ci.authIdle": "Authentication has not been checked.",
			"ci.accountDetails": "Connection account",
			"ci.overview": "CI overview",
			"ci.checkCount": "{n} checks",
			"ci.auto": "Auto-refresh",
			"ci.account": "Account",
			"ci.source": "Credential source",
			"ci.scopes": "Reported scopes",
			"ci.noScopes": "Not reported; repository access is checked separately.",
			"ci.access.ci-readable": "CI access verified",
			"ci.access.account-verified": "github.com authentication verified (no remote configured)",
			"ci.access.repo-readable": "Repository access verified (CI permissions may differ)",
			"ci.partial": "Results are incomplete (API limit or Actions API unavailable). Not confirmed successful.",
			"ci.steps": "Steps",
			"ci.finished": "finished",
			"ci.stepsWaiting": "Step details appear when the runner starts.",
			"ci.live": "Auto-refresh: 15s while active, 60s after completion or an error.",
			"ci.refreshing": "Checking CI…",
			"ci.stale": "Update failed; showing the previous result. Retrying automatically.",
			"ci.stepsUnavailable": "Step details unavailable; the job result is shown above.",
			"ci.stepsLimit": "Step details are limited to 10 jobs / 100 steps per job. Open the job for the rest.",
			"ci.kind.no-remote": "No Git remote configured.",
			"ci.kind.no-head": "No commit yet; there is no CI result to check.",
			"ci.kind.unsupported-remote": "This remote URL is not supported (HTTPS or SSH required).",
			"ci.kind.unsupported-host": "Set ci.hosts for this self-hosted service before connecting.",
			"ci.kind.cli-missing": "gh is not installed on the DSH Host. Public CI can still be read anonymously.",
			"ci.kind.auth-required": "Not authenticated. Run the login command on the DSH Host.",
			"ci.kind.auth-invalid": "The active credential is invalid or lacks required permissions.",
			"ci.error.auth-required": "Authentication is required.",
			"ci.error.forbidden": "Access denied or API rate limit reached. Check permissions and quota.",
			"ci.error.not-found": "Repository or API unavailable, commit not pushed, or insufficient access.",
			"ci.error.rate-limit": "API rate limit reached. Try again later.",
			"ci.error.invalid-config": "Invalid ci.hosts configuration on the DSH Host.",
			"ci.error.invalid-remote": "Invalid Git remote or repository path.",
			"ci.error.git-failed": "Could not read the Git remote or HEAD.",
			"ci.error.cli-failed": "gh failed. Check its version and authentication on the DSH Host.",
			"ci.error.invalid-response": "The provider returned an unsupported response.",
			"ci.error.response-too-large": "Provider response exceeded the size limit.",
			"ci.error.connection-failed": "Could not connect (network, timeout, or redirect refused).",
			"ci.state.success": "Passed",
			"ci.state.failure": "Failed",
			"ci.state.running": "Running",
			"ci.state.pending": "Queued",
			"ci.state.not-started": "Not started",
			"ci.state.blocked": "Awaiting action",
			"ci.state.canceled": "Canceled",
			"ci.state.skipped": "Skipped",
			"ci.state.neutral": "Neutral",
			"ci.state.unknown": "Unknown",
			"ci.state.none": "No CI results for this commit",

			"staged": "Staged",
			"unstaged": "Unstaged",
			"untracked": "Untracked",
			"conflicted": "Conflicted",
			"stage": "Stage",
			"unstage": "Unstage",
			"stageAll": "Stage all",
			"unstageAll": "Unstage all",
			"stagedCount": "{n} staged",
			"conflictHint": "Resolve the conflicts, then stage each file to mark it resolved.",
			"commit": "Commit",
			"commitMessage": "Commit message",
			"generateMessage": "AI generate",
			"generatingMessage": "Generating…",
			"generateHint": "Send the staged diff to this session's selected model. Model usage is billed; review the draft before committing.",
			"generateNeedsEmpty": "Clear the message to generate a new draft; existing text will not be overwritten.",
			"generatedWith": "Draft: {model} · Review before committing",
			"generationError": "Could not generate a message: {message}",
			"messageLanguage": "en",
			"commitPlaceholder": "Message",
			"commitNothing": "Nothing is staged.",
			"messageRequired": "Write a commit message first.",

			"operation": "Operation in progress",
			"op.rebase": "Rebase",
			"op.merge": "Merge",
			"op.cherry-pick": "Cherry-pick",
			"op.revert": "Revert",
			"op.am": "git am",
			"op.bisect": "Bisect",
			"op.step": "step {step} of {total}",
			"op.onto": "onto {onto}",
			"op.branch": "branch {branch}",
			"op.commit": "commit {commit}",
			"op.hint": "Resolve it in the terminal; this panel only reports it.",

			"diffTitle": "Diff",
			"diffNone": "No textual diff for this path.",
			"diffBinary": "Binary file — no textual diff.",
			"diffTruncated": "The diff is truncated.",
			"diffClose": "Close",
			"copy": "Copy",
			"copied": "Copied",
			"time.now": "now",
			"time.minutes": "{n}m",
			"time.hours": "{n}h",
			"time.days": "{n}d",
			"time.months": "{n}mo",
			"time.years": "{n}y",
			"wrap": "Wrap lines",
			"unwrap": "Keep columns",
			"scope.head": "all changes",
			"scope.worktree": "unstaged",
			"scope.index": "staged",
			"scope.commit": "whole commit",

			"historyEmpty": "No commits yet.",
			"historyCount": "{n} commits",
			"historyTruncated": "Showing the newest {n} commits.",
			"aheadTag": "ahead",
			"commitDetail": "Commit",
			"author": "Author",
			"date": "Date",
			"parents": "Parents",
			"files": "Files",
			"back": "Back",

			"noBranches": "No branches.",
			"localBranches": "Local",
			"remoteBranches": "Remote",
			"current": "current",
			"upstream": "→ {name}",
			"upstreamGone": "upstream gone",
			"level": "up to date",

			"reflogEmpty": "No reflog entries.",
			"reflogHint": "Every commit, checkout and rebase that moved HEAD — the record a rebase leaves behind.",

			"blamePath": "File path",
			"blamePathPlaceholder": "src/index.js",
			"blameShow": "Show blame",
			"blameHint": "Name a tracked file to see which commit last touched each line.",
			"blameSummary": "{lines} lines · {commits} commits · {authors} authors",
			"blameNewest": "last {date}",
			"blameUncommitted": "uncommitted",
			"blameTruncated": "Only the first {n} lines are shown.",
			"blameEmpty": "This file has no lines to blame.",

			"rejected.generic": "That action was refused.",
			"rejected.unknown-action": "That action is not supported.",
			"rejected.no-paths": "No usable path was given.",
			"rejected.empty-message": "Write a commit message first.",
			"rejected.invalid-path": "That path is not inside the repository.",
			"rejected.invalid-rev": "That revision is not valid.",
			"rejected.invalid-body": "The request was malformed.",
			"rejected.nothing-staged": "Stage changes before generating a message.",
			"rejected.diff-too-large": "The staged diff exceeds 128 KiB. Generate a message for a smaller commit.",
			"rejected.unresolved-conflicts": "Resolve the conflicts before generating a message.",
			"rejected.model-unavailable": "This session's selected model is unavailable.",
			"rejected.invalid-generation": "The model did not return a valid single-line commit message.",
			"rejected.incomplete-generation": "Generation did not finish. Try again.",
			"rejected.generation-busy": "A message is already being generated for this session."
		};

		/** Japanese copy, for the shell's `ja` language. */
		const ja = {
			"diff.layout": "差分の表示形式",
			"diff.auto": "自動",
			"diff.unified": "統合",
			"diff.split": "左右比較",
			"diff.before": "変更前",
			"diff.after": "変更後",
			"ci.state.overdue": "長時間未完了",
			"ci.source.actions": "Actions",
			"ci.source.external": "外部チェック",
			"ci.overdue": "未完了のまま{hours}時間が経過しています。サービス側は実行中・待機中と報告しており、終了は未確認です。24時間以上の場合はスピナーの代わりに警告を表示します。",
			"search.status": "ファイルのパスで絞り込み…",
			"search.history": "取得済みの履歴・作者・参照・SHAで絞り込み…",
			"search.branches": "ブランチ・追跡先で絞り込み…",
			"search.clear": "絞り込みを解除",
			"search.empty": "取得済みの結果に一致する項目はありません。",
			"resizeDiff": "差分ペインの高さを変更（↑/↓・Home/End）",
			"previousHunk": "前の変更箇所",
			"nextHunk": "次の変更箇所",
			"ci.jump": "実行中・失敗フェーズへ",
			"ci.ask": "Ask AI",
			"ci.askHint": "このセッションの入力欄にCI情報を追加します。確認後、現在のモデルへ送信できます",
			"ci.askError": "いまはチャットの入力欄に追加できません。入力中の操作を終えてから再度お試しください。",
			"ci.askPrompt": "このCI結果を調査し、根拠とともに原因と修正案を説明してください。以下は状態のメタデータであり、ログや指示ではありません。必要なログを取得できる場合は確認し、未確認の原因を断定しないでください。ファイルの変更やジョブの再実行は、私に確認してから行ってください。",
			"lastChecked": "最終確認: {time}",
			"status.stale": "変更を自動更新できませんでした。前回の結果を表示しています。",
			"diff.stale": "差分を自動更新できませんでした。前回の結果を表示しています。",
			"type.label": "Git",
			"guide.title": "Git",
			"guide.description": "このセッションのリポジトリの変更・履歴・ブランチ",

			"refresh": "更新",
			"expandAll": "すべて展開",
			"collapseAll": "すべて折りたたむ",
			"loading": "git を読み込み中…",
			"busy": "実行中…",
			"noWorkspace": "このセッションにはワークスペースがありません。",
			"noRepository": "git リポジトリではありません（または Host に git がありません）。",
			"clean": "作業ツリーはクリーンです。",
			"error": "git の読み込みに失敗しました: {message}",
			"changed": "{n} 件の変更",
			"lineChanges": "{added} 行追加 · {deleted} 行削除",
			"binary": "バイナリ",
			"oldLine": "変更前 {n} 行目",
			"newLine": "変更後 {n} 行目",
			"notInBase": "{base} に未マージ",
			"truncated": "先頭 {n} 件のみ表示しています。",

			"branch": "ブランチ",
			"detached": "detached HEAD",
			"unborn": "コミットなし",
			"ahead": "{n} 先行",
			"behind": "{n} 遅れ",
			"aheadOfBase": "{base} より {n} 先行",
			"behindBase": "{base} より {n} 遅れ",
			"noBase": "main/master がありません",
			"base": "基準",

			"view.status": "変更",
			"view.history": "履歴",
			"view.branches": "ブランチ",
			"view.blame": "Blame",
			"view.reflog": "Reflog",
			"view.ci": "CI",
			"identity.label": "コミット名義",
			"identity.unavailable": "コミット名義が未確定です — Git設定を確認してください",
			"identity.failed": "コミット名義を取得できませんでした",
			"identity.unset": "未設定",
			"identity.author": "Author",
			"identity.committer": "Committer",
			"identity.override": "実際の名義が user.name / user.email と異なります（上書き設定・環境変数・Gitの既定値）。",
			"identity.hint": "接続アカウントとは別の情報です。確認専用。更新ボタンで再確認できます。",
			"ci.remote": "Remote",
			"ci.auth": "接続を確認",
			"ci.ghAuth": "gh認証を確認",
			"ci.authHint": "DSHを動かすHostの使用中アカウントを確認します。トークンは表示・保存しません。",
			"ci.authIdle": "認証状態は未確認です。",
			"ci.accountDetails": "接続アカウント",
			"ci.overview": "CIの概要",
			"ci.checkCount": "{n}件のチェック",
			"ci.auto": "自動更新",
			"ci.account": "アカウント",
			"ci.source": "認証情報の取得元",
			"ci.scopes": "報告された権限",
			"ci.noScopes": "権限情報なし。リポジトリへのアクセスは別途確認します。",
			"ci.access.ci-readable": "CIの読み取りを確認済み",
			"ci.access.account-verified": "github.comの認証を確認済み（remote未設定）",
			"ci.access.repo-readable": "リポジトリの読み取りを確認済み（CI権限は別の場合があります）",
			"ci.partial": "結果は一部のみです（API上限またはActions API未対応）。成功とは確定していません。",
			"ci.steps": "フェーズ",
			"ci.finished": "完了",
			"ci.stepsWaiting": "ランナーが開始するとステップ詳細が表示されます。",
			"ci.live": "自動更新：実行中は15秒、完了後・接続エラー時は60秒ごと。",
			"ci.refreshing": "CIを確認中…",
			"ci.stale": "更新に失敗したため前回の結果を表示中です。自動で再確認します。",
			"ci.stepsUnavailable": "フェーズ詳細を取得できません。ジョブの結果は上記のとおりです。",
			"ci.stepsLimit": "フェーズ詳細は10ジョブ・各100ステップまでです。続きはジョブのリンクで確認してください。",
			"ci.kind.no-remote": "Git remoteが設定されていません。",
			"ci.kind.no-head": "まだコミットがないため、確認するCI結果がありません。",
			"ci.kind.unsupported-remote": "このremote URLには未対応です（HTTPSまたはSSHが必要です）。",
			"ci.kind.unsupported-host": "自前ホストは ci.hosts でサービスの種類を設定してから接続してください。",
			"ci.kind.cli-missing": "DSHのHostにghがありません。公開CIは認証なしでも確認できます。",
			"ci.kind.auth-required": "未認証です。DSHのHostでログインコマンドを実行してください。",
			"ci.kind.auth-invalid": "使用中の認証情報が無効、または必要な権限がありません。",
			"ci.error.auth-required": "認証が必要です。",
			"ci.error.forbidden": "アクセス拒否またはAPI利用上限です。権限と利用枠を確認してください。",
			"ci.error.not-found": "リポジトリ・APIが見つからない、コミットが未push、またはアクセス権がありません。",
			"ci.error.rate-limit": "API利用上限です。しばらく待って再確認してください。",
			"ci.error.invalid-config": "DSHのHostの ci.hosts 設定が不正です。",
			"ci.error.invalid-remote": "Git remoteまたはリポジトリのパスが不正です。",
			"ci.error.git-failed": "Git remoteまたはHEADを取得できませんでした。",
			"ci.error.cli-failed": "ghが失敗しました。Hostのghのバージョン・認証を確認してください。",
			"ci.error.invalid-response": "サービスから未対応の応答が返されました。",
			"ci.error.response-too-large": "サービスの応答がサイズ上限を超えました。",
			"ci.error.connection-failed": "接続できませんでした（ネットワーク・タイムアウト・リダイレクト拒否）。",
			"ci.state.success": "成功",
			"ci.state.failure": "失敗",
			"ci.state.running": "実行中",
			"ci.state.pending": "待機中",
			"ci.state.not-started": "未実行",
			"ci.state.blocked": "操作待ち",
			"ci.state.canceled": "キャンセル",
			"ci.state.skipped": "スキップ",
			"ci.state.neutral": "中立",
			"ci.state.unknown": "不明",
			"ci.state.none": "このコミットのCI結果はありません",

			"staged": "ステージ済み",
			"unstaged": "未ステージ",
			"untracked": "未追跡",
			"conflicted": "競合",
			"stage": "ステージ",
			"unstage": "戻す",
			"stageAll": "全てステージ",
			"unstageAll": "全て戻す",
			"stagedCount": "{n} 件ステージ済み",
			"conflictHint": "競合を解決してから、各ファイルをステージして解決済みにします。",
			"commit": "コミット",
			"commitMessage": "コミットメッセージ",
			"generateMessage": "AI生成",
			"generatingMessage": "生成中…",
			"generateHint": "ステージ済み差分を、このセッションで選択中のモデルへ送信します。モデル利用料がかかります。コミット前に文案を確認してください。",
			"generateNeedsEmpty": "新しく生成する場合はメッセージ欄を空にしてください。入力済みの文章は上書きしません。",
			"generatedWith": "生成モデル: {model} · コミット前に確認してください",
			"generationError": "メッセージの生成に失敗しました: {message}",
			"messageLanguage": "ja",
			"commitPlaceholder": "メッセージ",
			"commitNothing": "ステージされた変更がありません。",
			"messageRequired": "コミットメッセージを入力してください。",

			"operation": "操作が進行中",
			"op.rebase": "Rebase",
			"op.merge": "Merge",
			"op.cherry-pick": "Cherry-pick",
			"op.revert": "Revert",
			"op.am": "git am",
			"op.bisect": "Bisect",
			"op.step": "{total} 件中 {step} 件目",
			"op.onto": "→ {onto}",
			"op.branch": "ブランチ {branch}",
			"op.commit": "コミット {commit}",
			"op.hint": "続行・中止はターミナルで行ってください。このパネルは表示のみです。",

			"diffTitle": "差分",
			"diffNone": "このパスにテキスト差分はありません。",
			"diffBinary": "バイナリファイルのため差分を表示できません。",
			"diffTruncated": "差分は打ち切られています。",
			"diffClose": "閉じる",
			"copy": "コピー",
			"copied": "コピーしました",
			"time.now": "今",
			"time.minutes": "{n}分",
			"time.hours": "{n}時間",
			"time.days": "{n}日",
			"time.months": "{n}か月",
			"time.years": "{n}年",
			"wrap": "折り返す",
			"unwrap": "折り返さない",
			"scope.head": "全変更",
			"scope.worktree": "未ステージ",
			"scope.index": "ステージ済み",
			"scope.commit": "コミット全体",

			"historyEmpty": "まだコミットがありません。",
			"historyCount": "{n} コミット",
			"historyTruncated": "新しい {n} 件を表示しています。",
			"aheadTag": "先行",
			"commitDetail": "コミット",
			"author": "作者",
			"date": "日時",
			"parents": "親",
			"files": "ファイル",
			"back": "戻る",

			"noBranches": "ブランチがありません。",
			"localBranches": "ローカル",
			"remoteBranches": "リモート",
			"current": "現在",
			"upstream": "→ {name}",
			"upstreamGone": "上流が削除済み",
			"level": "最新",

			"reflogEmpty": "reflog のエントリがありません。",
			"reflogHint": "HEAD を動かしたコミット・チェックアウト・rebase の記録です。rebase の痕跡もここに残ります。",

			"blamePath": "ファイルパス",
			"blamePathPlaceholder": "src/index.js",
			"blameShow": "Blame を表示",
			"blameHint": "追跡されているファイルを指定すると、各行を最後に変更したコミットが表示されます。",
			"blameSummary": "{lines} 行 · {commits} コミット · {authors} 人",
			"blameNewest": "最終 {date}",
			"blameUncommitted": "未コミット",
			"blameTruncated": "先頭 {n} 行のみ表示しています。",
			"blameEmpty": "blame できる行がありません。",

			"rejected.generic": "その操作は拒否されました。",
			"rejected.unknown-action": "その操作には対応していません。",
			"rejected.no-paths": "有効なパスが指定されませんでした。",
			"rejected.empty-message": "コミットメッセージを入力してください。",
			"rejected.invalid-path": "そのパスはリポジトリ内にありません。",
			"rejected.invalid-rev": "そのリビジョンは無効です。",
			"rejected.invalid-body": "リクエストの形式が不正です。",
			"rejected.nothing-staged": "変更をステージしてからメッセージを生成してください。",
			"rejected.diff-too-large": "ステージ済み差分が128 KiBを超えています。小さなコミットに分けて生成してください。",
			"rejected.unresolved-conflicts": "競合を解決してからメッセージを生成してください。",
			"rejected.model-unavailable": "このセッションの選択中モデルを取得できません。",
			"rejected.invalid-generation": "モデルから有効な1行のコミットメッセージが返りませんでした。",
			"rejected.incomplete-generation": "生成が完了しませんでした。もう一度試してください。",
			"rejected.generation-busy": "このセッションでは既にメッセージを生成中です。"
		};
		//#endregion

		//#region presentation tables
		/**
		 * How each git state is painted: a short letter and the colour its row's index
		 * letters take. Kept beside the dictionary so a state with no entry degrades to
		 * a neutral colour instead of throwing.
		 */
		const STATES = {
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
		const stateOf = (name) => STATES[name] ?? { letter: "•", dot: "idle", tone: "neutral" };

		/** The five views, in tab order. */
		const VIEWS = ["status", "history", "branches", "blame", "reflog", "ci"];

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
		const GROUPS = [
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
		const REJECTIONS = {
			"unknown-action": "rejected.unknown-action",
			"no-paths": "rejected.no-paths",
			"empty-message": "rejected.empty-message",
			"invalid-path": "rejected.invalid-path",
			"invalid-rev": "rejected.invalid-rev",
			"invalid-body": "rejected.invalid-body"
		};

		/** Reflog actions that begin with this are the rebase trail worth spotting. */
		const REBASE_ACTION_PREFIX = "rebase";

		/** Width of one lane of the history graph, in pixels. */
		const LANE_W = 10;
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
		const LANE_SPAN = 100;
		/** Left inset of the graph column, and its minimum width. */
		const LANE_INSET = 4;
		/**
		 * How far a slice reaches past its own row, in pixels.
		 *
		 * A stroke centred on the row's edge is half clipped by the SVG viewport, which
		 * at 1px is a hairline of background between two rows — enough to read as
		 * broken. Overlapping the neighbours hides it, and since the overlaps paint the
		 * same colour at the same opacity, they are invisible.
		 */
		const LANE_BLEED = 1;
		//#endregion

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
		 * The tab type's static declaration.
		 *
		 * `keepMounted` retains the views across tab and Session switches so the
		 * scroll position, the open view and the loaded data survive. `guide` gets one
		 * entry: the sidebar's Start page draws one button per entry, and `order` 20
		 * seats Git between the shipped Files (10) and Terminal entries.
		 *
		 * @param t - namespace-bound translate, re-read on every label call.
		 */
		function gitTreeDefinition(t) {
			return {
				id: TAB_ID,
				kind: TAB_KIND,
				priority: "extension",
				keepMounted: true,
				title: () => t("type.label"),
				guide: [
					{
						id: TAB_KIND,
						order: 20,
						title: () => t("guide.title"),
						description: () => t("guide.description")
					}
				]
			};
		}

		//#region tree helpers
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
		function flatten(node, collapsed, depth, rows, keyOf = (path) => path) {
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
		function directoryPaths(node, into = []) {
			for (const child of node.children ?? []) {
				if (child.type !== "dir") continue;
				into.push(child.path);
				directoryPaths(child, into);
			}
			return into;
		}

		/** Counts as a short, stable string: `3M 1A 2?`. */
		function countsText(counts) {
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
		function sliceTree(tree, keep) {
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
		function toggle(current, path) {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		}

		//#endregion

		//#region the history graph
		// The shell's syntax palette adapts to both themes, without using diff red/green.
		const GRAPH_COLORS = ["var(--shiki-token-constant)", "var(--shiki-token-function)", "var(--shiki-token-parameter)", "var(--shiki-token-keyword)"];
		function branchColor(name) {
			if (name === "main" || name === "master") return GRAPH_COLORS[0];
			let hash = 0;
			for (const char of String(name)) hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
			return GRAPH_COLORS[hash % GRAPH_COLORS.length];
		}

		/** Carry colour along live edges, not column numbers: a freed column is another history. */
		function colorGraph(commits) {
			const seeds = new Map(commits.map((commit) => [commit.sha,
				(commit.refs ?? []).find((ref) => ref.kind === "head" && ref.name)?.name
				?? (commit.refs ?? []).filter((ref) => ref.kind === "other").map((ref) => ref.name).sort()[0] ?? commit.sha]));
			let active = [];
			return commits.map((commit) => {
				const beforeColors = active;
				const used = new Set(active.filter(Boolean));
				const choose = (seed) => {
					const start = GRAPH_COLORS.indexOf(branchColor(seed));
					const color = Array.from({ length: GRAPH_COLORS.length }, (_, i) => GRAPH_COLORS[(start + i) % GRAPH_COLORS.length]).find((color) => !used.has(color)) ?? GRAPH_COLORS[start];
					used.add(color);
					return color;
				};
				const color = active[commit.column] ?? choose(seeds.get(commit.sha));
				const afterColors = [];
				for (const lane of commit.through ?? []) if (lane !== commit.column) afterColors[lane] = active[lane];
				for (const [index, lane] of (commit.columns ?? []).entries()) {
					afterColors[lane] ??= index === 0 ? color : choose(seeds.get(commit.parents?.[index]) ?? commit.parents?.[index]);
				}
				active = afterColors;
				return { ...commit, color, beforeColors, afterColors };
			});
		}

		/**
		 * Draw one commit's slice of the lane graph.
		 *
		 * The Host sends geometry, not paths: `through` are lanes that run past this
		 * row untouched, `ends` are lanes that merge into
		 * it from above, and `columns` are the lanes its parents now occupy. A parent
		 * in another lane is drawn as a curve from the node down to that lane, which is
		 * what makes a merge legible.
		 *
		 * Each edge uses the colour carried across its boundary, so merging lanes meet
		 * at the node without recolouring the history that entered from above.
		 *
		 * The slice is drawn in a space whose vertical axis is a share of the row rather
		 * than a pixel count, and it is positioned against the row instead of sized, so
		 * no lane geometry depends on how tall a row turns out to be.
		 *
		 * @param commit - one row from the history payload.
		 * @param width - the graph column's width in pixels. Every row of a list is given
		 *   the same one, so the hashes line up whatever the merges do; it defaults to
		 *   the lanes this commit alone needs.
		 */
		function laneGutter(commit, width = Math.max(1, commit.width ?? 1) * LANE_W) {
			const x = (lane) => lane * LANE_W + LANE_W / 2;
			const middle = LANE_SPAN / 2;
			// Curves leave the node steeply and flatten into the lane they join, so the
			// bend is proportional to the span rather than a fixed number of pixels.
			const bend = middle + LANE_SPAN * 0.18;
			const strokes = [];

			for (const lane of commit.through ?? []) {
				if (lane === commit.column) continue;
				strokes.push(
					h("line", {
						key: `t${lane}`,
						x1: x(lane),
						y1: 0,
						x2: x(lane),
						y2: LANE_SPAN,
						stroke: commit.beforeColors?.[lane] ?? "currentColor",
						strokeOpacity: 0.7,
						strokeWidth: 1.5,
						vectorEffect: "non-scaling-stroke"
					})
				);
			}
			// Tips have only an outgoing half; roots have only an incoming half.
			if (commit.incoming ?? (commit.through ?? []).includes(commit.column)) {
				strokes.push(h("line", { key: "in", x1: x(commit.column), y1: 0, x2: x(commit.column), y2: middle,
					stroke: commit.color ?? "currentColor", strokeOpacity: 0.7, strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" }));
			}
			// A lane closing into this commit: from the top edge into the node.
			for (const lane of commit.ends ?? []) {
				strokes.push(
					h("path", {
						key: `e${lane}`,
						d: `M ${x(lane)} 0 C ${x(lane)} ${middle} ${x(commit.column)} ${middle} ${x(commit.column)} ${middle}`,
						fill: "none",
						stroke: commit.beforeColors?.[lane] ?? "currentColor",
						strokeOpacity: 0.7,
						strokeWidth: 1.5,
						vectorEffect: "non-scaling-stroke"
					})
				);
			}
			// Every parent leaves the node, including a parent in the same lane.
			for (const lane of new Set(commit.columns ?? [])) {
				strokes.push(
					h("path", {
						key: `p${lane}`,
						d: `M ${x(commit.column)} ${middle} C ${x(commit.column)} ${bend} ${x(lane)} ${bend} ${x(lane)} ${LANE_SPAN}`,
						fill: "none",
						stroke: commit.afterColors?.[lane] ?? "currentColor",
						strokeOpacity: 0.7,
						strokeWidth: 1.5,
						vectorEffect: "non-scaling-stroke"
					})
				);
			}

			// The node is a div, not an SVG circle: the slice is stretched vertically to
			// its row, which would draw a circle as an ellipse. A bordered box cannot be
			// distorted, whatever height the row ends up with.
			const isHead = (commit.refs ?? []).some((ref) => ref.kind === "head");
			const radius = isHead ? 3 : commit.ahead === true ? 3.4 : 2.4;
			const node = h("div", {
				key: "n",
				"data-head": isHead,
				style: {
					position: "absolute",
					left: x(commit.column),
					top: `${middle}%`,
					width: radius * 2,
					height: radius * 2,
					marginLeft: -radius,
					marginTop: -radius,
					borderRadius: "50%",
					color: commit.color ?? "currentColor",
					background: "currentColor",
					boxShadow: isHead ? "0 0 0 1px var(--dsw-alias-bg-layer-2), 0 0 0 2px currentColor" : undefined,
					opacity: isHead || commit.ahead === true ? 1 : 0.7
				}
			});

			return h(
				"div",
				{
					key: "gutter",
					"aria-hidden": "true",
					style: {
						position: "absolute",
						// Offsets resolve against the row's padding box, so pinning both edges
						// spans the whole row and consecutive rows' slices meet exactly. The
						// bleed only pushes that meeting point past each stroke's centre line,
						// where a shared edge would otherwise clip a hairline of background.
						top: -LANE_BLEED,
						bottom: -LANE_BLEED,
						left: LANE_INSET,
						width,
						pointerEvents: "none",
						overflow: "hidden"
					}
				},
				h(
					"svg",
					{
						width: "100%",
						height: "100%",
						viewBox: `0 0 ${width} ${LANE_SPAN}`,
						// The vertical axis is stretched to the row; the horizontal is 1:1.
						preserveAspectRatio: "none",
						style: { display: "block", overflow: "visible" }
					},
					...strokes
				),
				node
			);
		}
		//#endregion

		//#region loading
		/** Best-effort message from an error envelope or a thrown value. */
		function messageOf(error) {
			return String(error?.message ?? error?.code ?? error ?? "unknown");
		}

		/**
		 * Load one resource whenever `key` changes, and hand back its state plus a
		 * setter so a mutation can adopt the answer it already received.
		 *
		 * `load` is deliberately NOT a dependency: it is rebuilt on every render, and
		 * `key` is the thing that says when to fetch. Passing `null` as the key parks
		 * the resource — that is how a view that is not on screen avoids a request.
		 *
		 * @param key - a string that changes when a fetch is wanted, or null.
		 * @param load - returns the `{ok, value}` / `{ok, error}` envelope.
		 */
		function useLoad(key, load) {
			const [state, setState] = react.useState({ phase: "idle" });
			react.useEffect(() => {
				if (key === null) return undefined;
				let alive = true;
				setState({ phase: "loading" });
				load().then(
					(result) => {
						if (!alive) return;
						setState(
							result.ok === true
								? { phase: "ready", value: result.value }
								: { phase: "error", message: messageOf(result.error) }
						);
					},
					(error) => {
						if (alive) setState({ phase: "error", message: messageOf(error) });
					}
				);
				return () => {
					alive = false;
				};
			}, [key]);
			return [state, setState];
		}

		const ciActive = (check) => ["running", "pending"].includes(check.state);
		const ciOverdue = (check, now = Date.now()) => ciActive(check) && typeof check.startedAt === "string" && now - Date.parse(check.startedAt) >= 24 * 3600000;
		function ciDisplayState(state, checks, now = Date.now()) {
			const active = checks.filter(ciActive);
			return ["running", "pending"].includes(state) && active.length > 0 && active.every((check) => ciOverdue(check, now)) ? "overdue" : state;
		}
		function ciInterval(value) {
			const active = value.state === "none" || (value.checks?.length ? value.checks.some((check) => ciActive(check) && !ciOverdue(check)) : ciActive(value));
			const throttled = value.checks?.some((check) => ["forbidden", "rate-limit"].includes(check.stepsError));
			return value.kind === "ready" && active && !throttled ? 15000 : 60000;
		}

		/** Serial polling keeps the last result visible; hidden tabs abort and stop requests. */
		function useLiveLoad(key, load, signal, interval, paused = false, deferResume = false) {
			const [state, setState] = react.useState({ phase: "idle" });
			react.useEffect(() => {
				if (key === null) return undefined;
				let alive = true, busy = false, timer, controller;
				setState((current) => current.key === key ? current : { phase: "loading", key });
				if (paused) return undefined;
				const hidden = () => document.visibilityState === "hidden" || document.hasFocus?.() === false;
				const update = async () => {
					if (!alive || busy || hidden() || signal?.aborted) return;
					clearTimeout(timer);
					busy = true;
					controller = new AbortController();
					const request = controller;
					let delay = 60000;
					setState((current) => ({ ...current, refreshing: true }));
					try {
						const result = await load(signal ? AbortSignal.any([signal, request.signal]) : request.signal);
						if (!alive || request.signal.aborted || signal?.aborted) return;
						if (result.ok !== true) throw new Error(messageOf(result.error));
						const value = result.value;
						delay = typeof interval === "function" ? interval(value) : interval;
						setState({ phase: "ready", key, value, refreshing: false, updatedAt: Date.now() });
					} catch (error) {
						if (alive && !request.signal.aborted && !signal?.aborted) setState((current) => current.value
							? { ...current, refreshing: false, pollError: messageOf(error) }
							: { phase: "error", key, message: messageOf(error), refreshing: false });
					} finally {
						busy = false;
						if (alive && !hidden() && !signal?.aborted && Number.isFinite(delay)) timer = setTimeout(update, request.signal.aborted ? 0 : delay);
					}
				};
				const visibility = () => {
					clearTimeout(timer);
					if (hidden()) { controller?.abort(); setState((current) => ({ ...current, refreshing: false })); }
					else update();
				};
				document.addEventListener("visibilitychange", visibility);
				window.addEventListener("focus", visibility);
				window.addEventListener("blur", visibility);
				// A mutation supplies its own fresh snapshot; do not immediately overwrite it.
				if (deferResume && state.key === key && state.value && !hidden()) timer = setTimeout(update, interval);
				else update();
				return () => {
					alive = false;
					clearTimeout(timer);
					controller?.abort();
					document.removeEventListener("visibilitychange", visibility);
					window.removeEventListener("focus", visibility);
					window.removeEventListener("blur", visibility);
				};
			}, [key, signal, interval, paused, deferResume]);
			return [state.key === key ? state : { phase: "loading" }, setState];
		}
		//#endregion

		//#region shared chrome
		/**
		 * The explanation to show in place of a view, or null when there is content.
		 *
		 * `no-workspace` and `no-repository` are answers about the session rather than
		 * failures, and the tab says so in its own words.
		 */
		function placeholder(state, t) {
			// `idle` is load-bearing: a view renders once BEFORE its effect has run, so
			// on the pass where a view first becomes active its resource is still idle.
			// Treating that as "no content" would dereference an absent payload.
			if (state.phase === "idle" || state.phase === "loading") return t("loading");
			if (state.phase === "no-workspace") return t("noWorkspace");
			if (state.phase === "error") return t("error").replace("{message}", state.message);
			if (state.value?.kind === "no-workspace") return t("noWorkspace");
			if (state.value?.kind === "no-repository") return t("noRepository");
			return null;
		}

		/** One row of the view switcher. */
		function viewTab(id, active, onSelect, t) {
			return h(
				primitives.Button,
				{
					key: id,
					variant: "ghost",
					className: "gt_view",
					"aria-pressed": active,
					size: "sm",
					onClick: () => onSelect(id),
					children: t(`view.${id}`)
				}
			);
		}

		/**
		 * The banner that reports an operation git is in the middle of.
		 *
		 * A rebase is the reason this exists: the repository is in a state no ordinary
		 * status conveys, and it must be visible from every view, not just Branches.
		 * Nothing here changes that state — finishing or aborting belongs to the
		 * terminal — so the banner reports and says where to act.
		 */
		function operationBanner(state, t) {
			// `undefined` is guarded alongside `null` because the two halves can
			// legitimately disagree: the Host half is frozen when the server starts,
			// while this bundle is re-read live, so a field added here may be absent
			// on the wire for one server generation. Announcing nothing is the right
			// degradation — dereferencing it blanked the whole pane.
			if (state === null || state === undefined || state.kind === null) return null;
			const detail = [];
			if (state.branch !== null) detail.push(t("op.branch").replace("{branch}", state.branch));
			if (state.onto !== null) detail.push(t("op.onto").replace("{onto}", state.onto));
			if (state.commit !== null) detail.push(t("op.commit").replace("{commit}", state.commit));
			if (state.step !== null && state.total !== null) {
				detail.push(t("op.step").replace("{step}", String(state.step)).replace("{total}", String(state.total)));
			}

			return h(
				"div",
				{ key: "operation", className: "gt_banner" },
				h(
					"div",
					{ className: "gt_bannerTop" },
					h(primitives.Tag, { tone: "warning" }, t(`op.${state.kind}`)),
					h("span", { className: "gt_name" }, detail.join(" "))
				),
				h("div", { className: "gt_bannerDetail" }, t("op.hint"))
			);
		}

		function patchParts(text, fallbackPath = "") {
			const parts = [];
			let path = fallbackPath;
			let hunk = null;
			const lines = text.split("\n");
			if (lines.at(-1) === "") lines.pop();
			for (const line of lines) {
				if (line.startsWith("diff --git ")) { hunk = null; path = fallbackPath; }
				const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
				if (header !== null) {
					hunk = { path, header: line, oldStart: Number(header[1]), newStart: Number(header[2]), lines: [] };
					parts.push(hunk);
				} else if (hunk !== null && /^[ +\-\\]/.test(line)) {
					hunk.lines.push(line);
				} else {
					hunk = null;
					if (/^(---|\+\+\+) /.test(line) && !line.endsWith("/dev/null")) {
						path = line.slice(4).replace(/^"|"$/g, "").replace(/^[ab]\//, "");
					}
					parts.push(line);
				}
			}
			return parts;
		}

		/** Pair a contiguous edit block by position; blank cells preserve unequal line counts. */
		function splitHunk(hunk) {
			const rows = [];
			let left = [], right = [], oldIndex = 0, newIndex = 0, previous = [];
			const flush = () => {
				for (let i = 0; i < Math.max(left.length, right.length); i++) rows.push([left[i] ?? null, right[i] ?? null]);
				left = []; right = [];
			};
			for (const line of hunk.lines) {
				const sign = line[0];
				const cell = (index, number) => ({ sign, text: line.slice(1), index, number });
				if (sign === " ") {
					flush();
					previous = [cell(oldIndex, hunk.oldStart + oldIndex++), cell(newIndex, hunk.newStart + newIndex++)];
					rows.push(previous);
				} else if (sign === "-") {
					previous = [cell(oldIndex, hunk.oldStart + oldIndex++)]; left.push(previous[0]);
				} else if (sign === "+") {
					previous = [cell(newIndex, hunk.newStart + newIndex++)]; right.push(previous[0]);
				} else if (sign === "\\") {
					for (const item of previous) item.note = line;
				}
			}
			flush();
			return rows;
		}

		function PatchHunk({ hunk, side = null, t = (key) => en[key] }) {
			const highlight = primitives.useCodeHighlighter(primitives.languageForPath(hunk.path));
			// shortcut: syntax context starts at each hunk, fetch full files if cross-hunk grammar state is needed.
			const oldLines = hunk.lines.filter((line) => /^[ -]/.test(line)).map((line) => line.slice(1));
			const newLines = hunk.lines.filter((line) => /^[ +]/.test(line)).map((line) => line.slice(1));
			const oldTokens = side === 1 ? undefined : highlight(oldLines.join("\n"));
			const newTokens = side === 0 ? undefined : highlight(newLines.join("\n"));
			const numberWidth = `${Math.max(4, String(hunk.oldStart + oldLines.length).length, String(hunk.newStart + newLines.length).length)}ch`;
			let oldIndex = 0;
			let newIndex = 0;
			const paint = (tokens, text) => tokens === undefined ? text : tokens.map((token, i) => h("span", { key: i, style: token.style }, token.text));
			const header = h("span", { className: "gt_patchLine gt_patchMeta", "data-hunk": side !== 1 ? true : undefined, tabIndex: -1 }, hunk.header);
			if (side !== null) return h(react.Fragment, null, header,
				splitHunk(hunk).map((row, index) => { const cell = row[side]; return h("span", { key: index, className: cell?.sign === "+" ? "gt_patchLine gt_patchAdd" : cell?.sign === "-" ? "gt_patchLine gt_patchDelete" : "gt_patchLine", "data-empty": cell === null, "aria-hidden": cell === null ? true : undefined },
						cell === null ? null : h(react.Fragment, null,
							h("span", { className: "gt_patchNumber", "aria-label": t(side === 0 ? "oldLine" : "newLine").replace("{n}", String(cell.number)), style: { width: numberWidth } }, cell.number),
							h("span", { className: "gt_patchSign" }, cell.sign),
							h("span", { className: "gt_patchCode" }, paint((side === 0 ? oldTokens : newTokens)?.[cell.index], cell.text), cell.note ? h("span", { className: "gt_patchNote" }, cell.note) : null))); }));
			return h(react.Fragment, null,
				header,
				hunk.lines.map((line, index) => {
					const sign = line[0];
					const oldLine = sign === " " || sign === "-" ? oldIndex++ : null;
					const newLine = sign === " " || sign === "+" ? newIndex++ : null;
					const tokens = sign === "-" ? oldTokens?.[oldLine] : newLine === null ? undefined : newTokens?.[newLine];
					return h("span", {
						key: index,
						className: sign === "+" ? "gt_patchLine gt_patchAdd" : sign === "-" ? "gt_patchLine gt_patchDelete" : "gt_patchLine",
						title: `${oldLine === null ? "—" : hunk.oldStart + oldLine} → ${newLine === null ? "—" : hunk.newStart + newLine}`
					}, h("span", { className: "gt_patchNumber", "aria-hidden": "true", style: { width: numberWidth }, title: oldLine === null ? undefined : t("oldLine").replace("{n}", String(hunk.oldStart + oldLine)) }, oldLine === null ? "" : hunk.oldStart + oldLine),
						h("span", { className: "gt_patchNumber", "aria-hidden": "true", style: { width: numberWidth }, title: newLine === null ? undefined : t("newLine").replace("{n}", String(hunk.newStart + newLine)) }, newLine === null ? "" : hunk.newStart + newLine),
						h("span", { className: "gt_patchSign" }, sign),
						h("span", { className: "gt_patchCode" }, paint(tokens, line.slice(1))));
				})
			);
		}

		function diffPane(detail, t, close, onBlame, { wrapped = false, onWrap, copied = false, onCopy, height = 55, onResize, hunk = -1, onHunk, layout = "auto", wide = false, onLayout, paneRef } = {}) {
			const split = layout === "split" || (layout === "auto" && wide);
			const parts = patchParts(detail.value?.text ?? "", detail.path);
			const hunkCount = parts.filter((part) => typeof part !== "string").length;
			const resize = (value) => onResize?.(Math.min(80, Math.max(20, value)));
			const navigate = (event, direction) => {
				const targets = event.currentTarget.closest(".gt_pane").querySelectorAll("[data-hunk]");
				const next = Math.min(targets.length - 1, Math.max(0, hunk + direction));
				if (!targets[next]) return;
				targets[next].scrollIntoView({ block: "start", inline: "nearest" });
				targets[next].focus({ preventScroll: true });
				onHunk?.(next);
			};
			let content = null;
			if (detail.phase === "loading") content = t("loading");
			else if (detail.phase === "error") content = t("error").replace("{message}", detail.message);
			else if (detail.value?.kind === "no-workspace") content = t("noWorkspace");
			else if (detail.value?.kind === "no-repository") content = t("noRepository");
			else if (detail.value?.kind === "rejected") content = t("rejected.generic");
			else if (detail.value?.binary === true) content = t("diffBinary");
			else if (!detail.value?.text) content = t("diffNone");
			else {
				const renderParts = (side) => parts.map((part, index) => typeof part === "string"
						? h("span", { key: index, className: "gt_patchLine gt_patchMeta" }, part)
						: h(PatchHunk, { key: index, hunk: part, t, side }));
				const rows = split ? 1 + parts.reduce((count, part) => count + (typeof part === "string" ? 1 : 1 + splitHunk(part).length), 0) : 0;
				content = split ? h("div", { className: "gt_patch", "data-wrap": wrapped, "data-layout": "split" }, [0, 1].map((side) =>
					h("pre", { key: side, className: "gt_splitSide", style: { gridColumn: side + 1, gridRow: `1 / span ${rows}` }, "aria-label": t(side === 0 ? "diff.before" : "diff.after"),
						onScroll: (event) => {
							const source = event.currentTarget;
							if (source.dataset.syncedScroll === String(source.scrollLeft)) return;
							for (const target of source.parentElement.children) if (target !== source) {
								const offset = Math.min(source.scrollLeft, target.scrollWidth - target.clientWidth);
								target.dataset.syncedScroll = String(offset); target.scrollLeft = offset;
							}
						} },
						h("span", { className: "gt_patchLine gt_patchMeta" }, t(side === 0 ? "diff.before" : "diff.after")), renderParts(side))))
					: h("pre", { className: "gt_patch", "data-wrap": wrapped, "data-layout": "unified" }, renderParts(null));
			}

			const scopeKey = `scope.${detail.scope ?? "head"}`;
			return h(
				"div",
				{ key: "diff", className: "gt_pane", ref: paneRef, style: { flexBasis: `${height}%` } },
				h("div", { className: "gt_resize", role: "separator", tabIndex: 0, "aria-label": t("resizeDiff"), title: t("resizeDiff"), "aria-orientation": "horizontal", "aria-valuemin": 20, "aria-valuemax": 80, "aria-valuenow": Math.round(height),
					onPointerDown: (event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); },
					onPointerMove: (event) => {
						if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
						const rect = event.currentTarget.closest(".gt_root").getBoundingClientRect();
						if (rect.height > 0) resize((rect.bottom - event.clientY) / rect.height * 100);
					},
					onPointerUp: (event) => event.currentTarget.releasePointerCapture(event.pointerId),
					onKeyDown: (event) => {
						const value = { ArrowUp: height + 5, ArrowDown: height - 5, Home: 20, End: 80 }[event.key];
						if (value === undefined) return;
						event.preventDefault(); resize(value);
					} }),
				h(
					"div",
					{ className: "gt_paneHead" },
					h("div", { className: "gt_paneTitle" },
						h("span", { className: "gt_paneLabel", title: detail.label }, detail.label ?? t("diffTitle")),
						h(primitives.Button, { key: "close", variant: "ghost", size: "sm", onClick: close, children: t("diffClose") })),
					h(primitives.Tag, { tone: "neutral" }, t(scopeKey)),
					h("div", { className: "gt_diffLayout", role: "group", "aria-label": t("diff.layout") }, ["auto", "split", "unified"].map((mode) =>
						h(primitives.Button, { key: mode, variant: "ghost", size: "sm", "aria-pressed": layout === mode, onClick: () => onLayout?.(mode), children: t(`diff.${mode}`) }))),
					detail.path
						? h(primitives.Button, {
								key: "blame",
								variant: "ghost",
								size: "sm",
								title: t("blameHint"),
								onClick: () => onBlame(detail.path),
								children: t("blameShow")
							})
						: null,
					h(primitives.Button, { variant: "ghost", size: "sm", "aria-pressed": wrapped, onClick: onWrap, children: t(wrapped ? "unwrap" : "wrap") }),
					h(primitives.Button, { variant: "ghost", size: "sm", disabled: !detail.value?.text, onClick: () => onCopy?.(detail.value.text), children: t(copied ? "copied" : "copy") }),
					hunkCount > 0 ? h("div", { className: "gt_meta" },
						h(primitives.Button, { variant: "ghost", size: "sm", title: t("previousHunk"), "aria-label": t("previousHunk"), disabled: hunk <= 0, onClick: (event) => navigate(event, -1), children: "↑" }),
						h("span", { "aria-live": "polite" }, `${Math.min(hunk + 1, hunkCount)}/${hunkCount}`),
						h(primitives.Button, { variant: "ghost", size: "sm", title: t("nextHunk"), "aria-label": t("nextHunk"), disabled: hunk >= hunkCount - 1, onClick: (event) => navigate(event, 1), children: "↓" })) : null
				),
				h("div", { className: "gt_paneBody" }, content),
				detail.pollError ? h("span", { className: "gt_note gt_warning", role: "status" }, t("diff.stale")) : null,
				detail.value?.truncated === true ? h("span", { className: "gt_note" }, t("diffTruncated")) : null
			);
		}
		//#endregion

		//#region the Status view
		/** The commit message box and its button. */
		function identityDetails(identity, t) {
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

		function commitBox({ staged, busy, generating, generatedModel, identity, message, setMessage, onCommit, onGenerate, t }) {
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
		const INDENT = 18;

		/**
		 * One row's leading icon: a folder that opens and closes, or the file's own type.
		 *
		 * Both come from the shell's primitives, which is what makes a tree of source
		 * files scannable at a glance — the shape and colour of the glyph carry the type
		 * before any text is read.
		 */
		function rowIcon({ node, isDir, open }) {
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
		function rowActions({ node, actions, busy, t, onStage, onUnstage }) {
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
		function treeRows({ tree, prefix, actions, collapsed, setCollapsed, busy, t, onOpenDiff, onStage, onUnstage, selected }) {
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

		function changeSection({ section, t, collapsed, setCollapsed, busy, onOpenDiff, onStage, onUnstage, selected }) {
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
		function StatusView({
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
		//#endregion

		//#region the History view
		/** Tags for a commit's refs, so a branch tip is visible in the graph. */
		/**
		 * Decoration kinds, mirroring `parseDecoration` in `lib/git.js`.
		 *
		 * Named rather than inlined so the tone below stays the first literal in its
		 * property — the smoke test reads the paint vocabulary off the source.
		 */
		const REF_HEAD = "head";
		const REF_TAG = "tag";

		/** Tags for a commit's refs, so a branch tip is visible in the graph. */
		function refTags(refs, t) {
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
		function timeLabel(date, now, t) {
			const at = Date.parse(date);
			if (!Number.isFinite(at)) return null;
			const { unit, n } = primitives.relativeTime(at, now);
			return unit === "now" ? t("time.now") : t(`time.${unit}`).replace("{n}", String(n));
		}

		function HistoryView({ state, t, onOpenCommit, selected, filter = "" }) {
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
		//#endregion

		//#region the Branches view
		/** How a branch stands relative to its upstream, in words. */
		function trackText(branch, t) {
			if (branch.gone) return t("upstreamGone");
			if (branch.upstream === null) return null;
			const parts = [];
			if (branch.ahead > 0) parts.push(t("ahead").replace("{n}", String(branch.ahead)));
			if (branch.behind > 0) parts.push(t("behind").replace("{n}", String(branch.behind)));
			return parts.length === 0 ? t("level") : parts.join(" · ");
		}

		/** One branch row. */
		function branchRow(branch, t, key) {
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
		function BranchesView({ state, t, filter = "" }) {
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
		//#endregion

		//#region the Reflog view
		/**
		 * The Reflog view: what moved HEAD, newest first.
		 *
		 * This is the "record" half of a rebase — the operation banner says one is
		 * happening now, and the reflog says what happened. Each entry carries its own
		 * time, which the Host reads from the selector rather than the commit.
		 */
		function ReflogView({ state, t }) {
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
		//#endregion

		//#region the Blame view
		/**
		 * The Blame view: which commit last touched each line of one file.
		 *
		 * The path is typed here or handed over from a file patch; the view holds no
		 * opinion about a "current file", because a sidebar tab has no editor
		 * selection to read. Every row carries its own commit, and that commit's sha is
		 * a button back into the patch — which is where the reason for a line lives.
		 */
		function BlameView({ state, t, path, draft, setDraft, onShow, onOpenCommit, selected }) {
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
		//#endregion

		//#region the tab body
		/**
		 * The tab's body.
		 *
		 * Framework props (`useTabInfo`, `sessionId`, `useSessions`, `t`) arrive from
		 * the slot runtime; the `load*` / `mutate` share is the business half injected
		 * at registration.
		 */
		const CI_TONES = { success: "gt_success", failure: "gt_danger", running: "gt_info", pending: "gt_info", blocked: "gt_warning", overdue: "gt_warning" };
		function ciSummary(value, t) {
			return value.groups?.length ? value.groups.map((group) => h("span", { key: group.source, className: "gt_ciState" },
				t(`ci.source.${group.source}`), ciStatus(ciDisplayState(group.state, value.checks.filter((check) => check.source === group.source)), t)))
				: ciStatus(ciDisplayState(value.state, value.checks ?? []), t);
		}
		function ciStatus(state, t) {
			return h("span", { className: "gt_ciState " + (CI_TONES[state] ?? "gt_neutral") },
				["running", "pending"].includes(state) ? h("span", { className: "gt_ciSpinner", "aria-hidden": true })
					: h("svg", { className: "gt_ciStatusIcon", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true, focusable: "false" },
						h("circle", { cx: 8, cy: 8, r: 6.25 }),
						h("path", { d: state === "success" ? "M4.5 8 7 10.5 11.5 5.5" : state === "failure" ? "m5.5 5.5 5 5m0-5-5 5" : state === "blocked" ? "M6 5v6m4-6v6" : state === "canceled" ? "m4 12 8-8" : "M5 8h6", strokeLinecap: "round", strokeLinejoin: "round" })),
				t(`ci.state.${state}`));
		}
		function connectionMessage(value, t) {
			return value.kind === "failed" ? t(`ci.error.${value.code ?? "connection-failed"}`) : t(`ci.kind.${value.kind}`);
		}

		function CISteps({ check, t, expanded, onToggle, onAsk }) {
			const steps = check.steps;
			const finished = steps?.filter((step) => ["success", "failure", "skipped", "canceled", "neutral"].includes(step.state)).length ?? 0;
			return h("div", null,
				steps ? h("details", { className: "gt_ciSteps", open: expanded, onToggle: (event) => { if (event.currentTarget.open !== expanded) onToggle(event.currentTarget.open); } },
					h("summary", null,
						h("span", { className: "gt_disclosure", "aria-hidden": true }, h("svg", { viewBox: "0 0 12 12", width: 12, height: 12, focusable: "false" }, h("path", { d: "m4 2 4 4-4 4", fill: "none", stroke: "currentColor", strokeWidth: 1.5 }))),
						t("ci.steps"), steps.length ? h("span", { className: "gt_ciStepCount" }, `${finished}/${steps.length} ${t("ci.finished")}`) : null),
					steps.length === 0 ? h("p", { className: "gt_note" }, t("ci.stepsWaiting")) : h("ol", { "aria-label": t("ci.steps") }, steps.map((step) => h("li", { key: step.number, className: "gt_ciStep", "data-state": step.state, "data-step": step.number, tabIndex: -1, "aria-current": step.state === "running" ? "step" : undefined },
						h("span", { className: "gt_ciStepNumber", "aria-hidden": true }, step.number),
						h("span", { className: "gt_subject" }, step.name),
						h("div", { className: "gt_meta gt_ciStepMeta" }, ciStatus(ciOverdue(check) && ciActive(step) ? "overdue" : step.state, t), step.durationSeconds == null ? null : ` · ${step.durationSeconds}s`,
							step.state === "failure" ? h(primitives.Button, { variant: "ghost", size: "sm", title: t("ci.askHint"), onClick: () => onAsk(check, step), children: t("ci.ask") }) : null))))) : null,
				check.stepsError ? h("p", { className: "gt_note gt_warning" }, t(check.stepsError === "limit" ? "ci.stepsLimit" : "ci.stepsUnavailable"),
					!["limit", "unavailable"].includes(check.stepsError) ? ` ${t(`ci.error.${check.stepsError}`)}` : "") : null);
		}

		function CIView({ state, auth, authRequested, onAuth, remote, onRemote, t, expanded = {}, onExpand, onAsk }) {
			const explanation = placeholder(state, t);
			const value = state.value;
			const canCheck = value?.kind === "no-remote" || (value?.provider && !["unsupported-remote", "unsupported-host"].includes(value.kind));
			const authValue = auth.value;
			const checks = value?.checks ?? [];
			return h("div", { className: "gt_body gt_ciView", key: "ci" },
				h("div", { className: "gt_ciHead" },
					(value?.remotes?.length ?? 0) > 0 ? h("label", { className: "gt_meta" }, t("ci.remote"),
						h("select", { className: "gt_input", value: remote || value.remote, onChange: (event) => onRemote(event.target.value), "aria-label": t("ci.remote") },
							value.remotes.map((name) => h("option", { key: name, value: name }, name)))) : null,
					canCheck ? h(primitives.Button, { variant: "ghost", size: "sm", disabled: authRequested && auth.phase === "loading", onClick: onAuth,
						title: `${t("ci.authHint")}${authRequested ? "" : ` ${t("ci.authIdle")}`}`, children: t(value.provider === "github" || value.kind === "no-remote" ? "ci.ghAuth" : "ci.auth") }) : null),
				value ? h("section", { className: "gt_ciOverview", "aria-label": t("ci.overview") },
					h("div", { className: "gt_ciOverviewHead", role: value.kind === "ready" ? "status" : undefined },
						h("div", { className: "gt_ciIdentity" }, h("strong", null, value.repository || t("view.ci")),
							value.provider ? h("div", { className: "gt_meta" }, `${value.provider} · ${value.host}`) : null),
						value.kind === "ready" ? ciSummary(value, t) : null),
					h("div", { className: "gt_ciContext" },
						value.sha ? h("code", { className: "gt_sha", title: value.sha }, `HEAD ${value.sha.slice(0, 12)}`) : null,
						value.kind === "ready" ? h("span", null, t("ci.checkCount").replace("{n}", String(checks.length))) : null,
						h("span", { className: "gt_ciPoll", title: t("ci.live") }, state.refreshing ? h("span", { className: "gt_ciSpinner", "aria-hidden": true }) : null,
							state.refreshing ? t("ci.refreshing") : t("ci.auto")),
						state.updatedAt ? h("span", null, t("lastChecked").replace("{time}", new Date(state.updatedAt).toLocaleTimeString())) : null)) : null,
				state.pollError ? h("p", { className: "gt_note gt_warning", role: "status" }, t("ci.stale")) : null,
				explanation !== null ? h("p", { className: "gt_statusLine" }, explanation) : value?.kind !== "ready" ? h("p", { className: "gt_statusLine" }, connectionMessage(value, t)) : h("div", { className: "gt_ciJobs" },
					value.partial ? h("p", { className: "gt_note gt_warning" }, t("ci.partial")) : null,
					checks.map((check) => {
						const key = JSON.stringify([value.host, value.repository, value.sha, check.url, check.group, check.name]);
						const target = check.steps?.find((step) => step.state === "failure") ?? check.steps?.find((step) => step.state === "running");
						return h("article", { key, className: "gt_ciRow" },
						h("div", { className: "gt_ciJobHead" },
							h("div", { className: "gt_stack" },
								check.url && /^https:\/\//.test(check.url) ? h("a", { className: "gt_subject", href: check.url, target: "_blank", rel: "noopener noreferrer" }, check.name) : h("span", { className: "gt_subject" }, check.name),
								check.source ? h("div", { className: "gt_meta" }, t(`ci.source.${check.source}`), check.app ? ` · ${check.app}` : "") : check.group ? h("div", { className: "gt_meta" }, check.group) : null),
							ciStatus(ciOverdue(check) ? "overdue" : check.state, t)),
						ciOverdue(check) ? h("p", { className: "gt_note gt_warning", title: check.startedAt }, t("ci.overdue").replace("{hours}", String(Math.floor((Date.now() - Date.parse(check.startedAt)) / 3600000)))) : null,
						h("div", { className: "gt_commitRow" },
							h(primitives.Button, { variant: "ghost", size: "sm", title: t("ci.askHint"), onClick: () => onAsk(check), children: t("ci.ask") }),
							target ? h(primitives.Button, { variant: "ghost", size: "sm", onClick: (event) => {
								onExpand(key, true);
								const row = event.currentTarget.closest(".gt_ciRow");
								row.querySelector("details").open = true;
								const step = [...row.querySelectorAll("[data-step]")].find((node) => node.dataset.step === String(target.number));
								step?.scrollIntoView({ block: "nearest" }); step?.focus({ preventScroll: true });
							}, children: t("ci.jump") }) : null),
						h(CISteps, { check, t, expanded: expanded[key] ?? (!ciOverdue(check) && ["failure", "running", "pending", "blocked"].includes(check.state)), onToggle: (open) => onExpand(key, open), onAsk })); })),
				canCheck && authRequested ? h("details", { className: "gt_connection", open: true, "aria-label": t("ci.accountDetails") },
					h("summary", null, t("ci.accountDetails")),
					h("div", { "aria-live": "polite" }, placeholder(auth, t) ?? (authValue?.kind === "ready" ? h("div", null,
						h("div", { className: "gt_success" }, t(`ci.access.${authValue.access}`)),
						h("div", null, `${t("ci.account")}: ${authValue.login}`),
						h("div", null, `${t("ci.source")}: ${authValue.source || "—"}`),
						h("div", null, `${t("ci.scopes")}: ${authValue.scopes || t("ci.noScopes")}`)) : h("div", null,
						connectionMessage(authValue ?? { kind: "failed" }, t),
						authValue?.login ? h("div", null, `${t("ci.account")}: ${authValue.login}`) : null,
							authValue?.command ? h("code", null, authValue.command) : null)))) : null);
		}

		function GitTreeBody({
			useTabInfo,
			sessionId,
			useSessions,
			t,
			loadStatus,
			loadHistory,
			loadBranches,
			loadReflog,
			loadBlame,
			loadDiff,
			loadCI,
			loadAuth,
			askAI,
			generateMessage,
			mutate
		}) {
			const { tab } = useTabInfo();
			const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd);

			const [view, setView] = react.useState("status");
			const [statusNonce, setStatusNonce] = react.useState(0);
			const [dataNonce, setDataNonce] = react.useState(0);
			const [collapsed, setCollapsed] = react.useState(() => new Set());
			const [detail, setDetail] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			// The Blame view is the one view about a PATH rather than the repository, so
			// the typed draft and the requested path are separate: only `blamePath` is
			// ever fetched, and only when the view is on screen.
			const [blameDraft, setBlameDraft] = react.useState("");
			const [blamePath, setBlamePath] = react.useState("");
			const [notice, setNotice] = react.useState(null);
			const [message, setMessage] = react.useState("");
			const [generating, setGenerating] = react.useState(false);
			const [generatedModel, setGeneratedModel] = react.useState(null);
			const [wrapped, setWrapped] = react.useState(false);
			const [layout, setLayout] = react.useState(() => {
				try { const saved = window.localStorage?.getItem("dsh-gitview.diff-layout"); return ["auto", "split", "unified"].includes(saved) ? saved : "auto"; }
				catch { return "auto"; }
			});
			const paneRef = react.useRef(null);
			const [wide, setWide] = react.useState(false);
			react.useEffect(() => {
				if (!detail || !paneRef.current || typeof ResizeObserver === "undefined") return undefined;
				const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 800));
				observer.observe(paneRef.current);
				return () => observer.disconnect();
			}, [detail !== null]);
			const [copied, setCopied] = react.useState(false);
			const [ciRemote, setCIRemote] = react.useState("");
			const [authNonce, setAuthNonce] = react.useState(0);
			const [filters, setFilters] = react.useState({});
			const [searchCollapsed, setSearchCollapsed] = react.useState(() => new Set());
			const filter = (filters[view] ?? "").trim().toLowerCase();
			react.useEffect(() => setSearchCollapsed(new Set()), [filter, view]);
			const [expanded, setExpanded] = react.useState({});
			const [paneHeight, setPaneHeight] = react.useState(55);
			const [hunk, setHunk] = react.useState(-1);
			const statusKey = cwd === undefined ? null : `status:${sessionId}:${cwd}:${statusNonce}`;

			// The status is read whichever view is on screen: it carries the operation
			// banner, and a rebase must be visible from every view. The other three are
			// fetched only when their view is active.
			const [status, setStatus] = useLiveLoad(
				statusKey,
				(signal) => loadStatus(sessionId, signal), tab.signal, 3000, busy || tab.visible === false, true
			);
			const [history] = useLoad(view === "history" ? `history:${sessionId}:${cwd}:${dataNonce}` : null, () =>
				loadHistory(sessionId, tab.signal)
			);
			const [branches] = useLoad(view === "branches" ? `branches:${sessionId}:${cwd}:${dataNonce}` : null, () =>
				loadBranches(sessionId, tab.signal)
			);
			const [reflog] = useLoad(view === "reflog" ? `reflog:${sessionId}:${cwd}:${dataNonce}` : null, () =>
				loadReflog(sessionId, tab.signal)
			);
			// A path is required before there is anything to ask for, so the key stays
			// null until one has been chosen.
			const [blame] = useLoad(
				view === "blame" && blamePath !== "" ? `blame:${sessionId}:${blamePath}:${dataNonce}` : null,
				() => loadBlame(sessionId, blamePath, tab.signal)
			);
			const [ci] = useLiveLoad(status.value?.kind === "ready" && cwd !== undefined ? `ci:${sessionId}:${cwd}:${ciRemote}:${dataNonce}` : null,
				(signal) => loadCI(sessionId, ciRemote, signal), tab.signal, ciInterval, tab.visible === false);
			const [patch] = useLiveLoad(detail ? JSON.stringify([sessionId, cwd, detail.scope, detail.path, detail.rev, dataNonce]) : null,
				(signal) => loadDiff(sessionId, detail.path, detail.scope, detail.rev, signal), tab.signal, detail?.scope === "commit" ? Infinity : 3000, busy || tab.visible === false);
			const [auth] = useLoad(view === "ci" && authNonce > 0 ? `auth:${sessionId}:${ciRemote}:${authNonce}` : null,
				() => loadAuth(sessionId, ciRemote, tab.signal));

			const statusState = cwd === undefined ? { phase: "no-workspace" } : status;
			const ready = statusState.phase === "ready" && statusState.value?.kind === "ready" ? statusState.value : null;
			// Normalized here as well as guarded in the banner: a payload from an older
			// Host half has no `state` at all.
			const operation = ready === null ? null : (ready.state ?? null);

			const refresh = react.useCallback(() => {
				setStatusNonce((n) => n + 1);
				setDataNonce((n) => n + 1);
				setNotice(null);
			}, []);

			// The refresh command the sidebar's own chrome and shortcuts invoke.
			react.useEffect(() => tab.actions.bindCommands({ refresh }), [tab.actions, refresh]);

			// A selected path belongs to one session, repository and view.
			react.useEffect(() => setDetail(null), [sessionId, cwd, view]);
			react.useEffect(() => setHunk(-1), [detail?.scope, detail?.path, detail?.rev]);

			// A path is relative to one repository, so a different session starts empty
			// rather than blaming the same relative path somewhere else.
			react.useEffect(() => {
				setBlamePath("");
				setBlameDraft("");
				setCIRemote("");
				setAuthNonce(0);
				setFilters({});
				setExpanded({});
			}, [sessionId, cwd]);

			/**
			 * Run one mutation and fold the answer back into the panel.
			 *
			 * A refusal or a git failure is shown as a notice rather than thrown: both
			 * are ordinary answers about the repository, and the reader is the one who
			 * can act on them.
			 */
			const runMutation = react.useCallback(
				async (body) => {
					setBusy(true);
					setNotice(null);
					const result = await mutate(sessionId, body, tab.signal);
					setBusy(false);
					if (result.ok !== true) {
						setNotice(t("error").replace("{message}", messageOf(result.error)));
						return false;
					}
					const value = result.value;
					if (value.kind === "failed") {
						setNotice(value.message);
						return false;
					}
					if (value.kind === "rejected") {
						setNotice(t(REJECTIONS[value.code] ?? "rejected.generic"));
						return false;
					}
					if (value.kind !== "ready") {
						setNotice(value.kind === "no-workspace" ? t("noWorkspace") : t("noRepository"));
						return false;
					}
					// The mutation already returned the new status, so adopt it: the tree
					// updates without a second round trip or a loading flash. The other
					// views are re-read on their next activation.
					setStatus({ phase: "ready", key: statusKey, value: value.status, updatedAt: Date.now() });
					setDataNonce((n) => n + 1);
					return true;
				},
				[mutate, sessionId, tab.signal, t, statusKey]
			);

			/** Load a patch into the pane below the list. */
			const openDiff = react.useCallback(
				(scope, path, rev, label, sha) => {
					// `sha` is carried on every phase so the History row stays marked
					// while its patch is still arriving.
					setDetail({ scope, path, rev, label, sha });
				},
				[]
			);

			/**
			 * Show one file's blame.
			 *
			 * Blame is a whole view rather than a pane because it is about the file, not
			 * about one change to it; the patch pane hands its path over, which is the
			 * gesture a reader makes after asking "who wrote this line?".
			 */
			const showBlame = react.useCallback((path) => {
				setBlamePath(path);
				setBlameDraft(path);
				setView("blame");
			}, []);

			/** Which diff scope a file row should open by default. */
			const openFileDiff = react.useCallback(
				(node, scope) => {
					// Open exactly the side whose counts and selection the section displays.
					openDiff(scope, node.path, "", node.path);
				},
				[openDiff]
			);

			const onCommit = react.useCallback(
				async (text) => {
					const ok = await runMutation({ action: "commit", message: text });
					if (ok) setMessage("");
				},
				[runMutation]
			);

			const onGenerate = react.useCallback(async () => {
				if (busy || generating || message.trim() !== "") return;
				setGenerating(true);
				setGeneratedModel(null);
				setNotice(null);
				try {
					const result = await generateMessage(sessionId, t("messageLanguage"), tab.signal);
					if (result.ok !== true) throw new Error(messageOf(result.error));
					const value = result.value;
					if (value.kind !== "ready") {
						setNotice(value.kind === "rejected" ? t(`rejected.${value.code}`) : value.kind === "no-workspace" ? t("noWorkspace") : value.kind === "no-repository" ? t("noRepository") : t("generationError").replace("{message}", value.message));
						return;
					}
					// A draft must never replace text entered while the request was in flight.
					setMessage((current) => current.trim() === "" ? value.message : current);
					setGeneratedModel(`${value.model.provider}/${value.model.model}`);
				} catch (error) {
					setNotice(t("generationError").replace("{message}", messageOf(error)));
				} finally {
					setGenerating(false);
				}
			}, [busy, generating, message, generateMessage, sessionId, tab.signal, t]);

			//#region header
			const header = h(
				"div",
				{
					key: "header",
					className: "gt_header"
				},
				h("div", { className: "gt_repo" },
					h("div", { className: "gt_branch" },
						h(primitives.IconBranchOutlineRegular, { className: "gt_icon" }),
						h("span", { className: "gt_name", title: ready?.branch }, ready?.detached ? t("detached") : ready?.branch ?? "Git"),
						ready?.unborn ? h(primitives.Tag, { tone: "neutral" }, t("unborn")) : null),
					ready === null ? null : h("div", { className: "gt_repoPath", title: ready.repoRoot }, ready.repoRoot),
					ready?.base?.ahead > 0 ? h("div", { className: "gt_meta" }, t("aheadOfBase").replace("{n}", String(ready.base.ahead)).replace("{base}", ready.base.name)) : null),
				ci.value ? h(primitives.Button, { variant: "ghost", size: "sm", onClick: () => setView("ci"), title: ci.pollError ? t("ci.stale") : ci.updatedAt ? t("lastChecked").replace("{time}", new Date(ci.updatedAt).toLocaleTimeString()) : t("view.ci"),
					children: h("span", { className: "gt_ciBadge" }, "CI", ci.pollError || ci.value.kind !== "ready" ? " · !" : ciSummary(ci.value, t)) }) : null,
				h(primitives.Button, { key: "refresh", variant: "ghost", size: "sm", onClick: refresh, children: t("refresh") })
			);

			const tabs = h(
				"div",
				{ key: "tabs", className: "gt_views", role: "group", "aria-label": t("guide.title") },
				VIEWS.map((id) => viewTab(id, view === id, setView, t))
			);
			//#endregion

			// A repository that cannot be read has nothing to switch between, so the
			// explanation stands alone instead of sitting under four empty tabs.
			if (ready === null) {
				return h(
					"div",
					{ className: "gt_root" },
					header,
					h(
						"div",
						{ className: "gt_statusLine" },
						placeholder(statusState, t) ?? t("loading")
					)
				);
			}

			let content = null;
			if (view === "ci") {
				content = h(CIView, { state: ci, auth, authRequested: authNonce > 0, remote: ciRemote, t,
					expanded, onExpand: (key, open) => setExpanded((current) => ({ ...current, [key]: open })),
					onAsk: (check, step) => {
						const context = { repository: ci.value.repository, provider: ci.value.provider, host: ci.value.host, sha: ci.value.sha, job: check.name, state: check.state, url: check.url, ...(step ? { phase: step } : { phases: check.steps }), stepsError: check.stepsError };
						try { if (!askAI(sessionId, `${t("ci.askPrompt")}\n\n${JSON.stringify(context, null, 2)}`)) setNotice(t("ci.askError")); }
						catch { setNotice(t("ci.askError")); }
					},
					onAuth: () => setAuthNonce((n) => n + 1),
					onRemote: (remote) => { setCIRemote(remote); setAuthNonce(0); } });
			} else if (view === "history") {
				content = h(HistoryView, {
					key: "history",
					state: history,
					filter,
					t,
					selected: detail?.sha,
					onOpenCommit: (commit) => openDiff("commit", "", commit.sha, `${commit.short} ${commit.subject}`, commit.sha)
				});
			} else if (view === "branches") {
				content = h(BranchesView, { key: "branches", state: branches, t, filter });
			} else if (view === "blame") {
				content = h(BlameView, {
					key: "blame",
					state: blame,
					t,
					path: blamePath,
					draft: blameDraft,
					setDraft: setBlameDraft,
					// A re-show of the same path must still re-read it, so the nonce moves
					// too: the key would otherwise be identical to the last request.
					onShow: () => {
						setBlamePath(blameDraft.trim());
						setDataNonce((n) => n + 1);
					},
					onOpenCommit: (line) => openDiff("commit", "", line.sha, `${line.short} ${line.summary}`, line.sha),
					selected: detail?.sha
				});
			} else if (view === "reflog") {
				content = h(ReflogView, { key: "reflog", state: reflog, t });
			} else {
				content = h(StatusView, {
					key: "status",
					ready,
					filter,
					collapsed: filter ? searchCollapsed : collapsed,
					setCollapsed: filter ? setSearchCollapsed : setCollapsed,
					busy: busy || generating,
					message,
					setMessage,
					generating,
					generatedModel,
					t,
					selected: detail,
					onOpenDiff: openFileDiff,
					onStage: (path) => runMutation({ action: "stage", paths: [path] }),
					onUnstage: (path) => runMutation({ action: "unstage", paths: [path] }),
					onCommit,
					onGenerate,
					onCommitAction: (action) => runMutation({ action })
				});
			}

			return h(
				"div",
				{ className: "gt_root" },
				header,
				tabs,
				["status", "history", "branches"].includes(view) ? h("div", { className: "gt_search" },
					h("input", { className: "gt_input", type: "search", value: filters[view] ?? "", "aria-label": t(`search.${view}`), placeholder: t(`search.${view}`),
						onChange: (event) => setFilters((current) => ({ ...current, [view]: event.target.value })),
						onKeyDown: (event) => { if (event.key === "Escape") { event.preventDefault(); setFilters((current) => ({ ...current, [view]: "" })); } } }),
					filters[view] ? h(primitives.Button, { variant: "ghost", size: "sm", "aria-label": t("search.clear"), title: t("search.clear"), onClick: () => setFilters((current) => ({ ...current, [view]: "" })), children: "×" }) : null) : null,
				status.pollError ? h("div", { className: "gt_note gt_warning", role: "status" }, t("status.stale")) : null,
				operationBanner(operation, t),
				notice === null
					? null
					: h(
							"div",
							{
								key: "notice",
								role: "alert",
								className: "gt_alert"
							},
							notice,
							h(primitives.Button, {
								variant: "ghost",
								size: "sm",
								onClick: () => setNotice(null),
								children: t("diffClose")
							})
						),
				content,
				detail === null ? null : diffPane({ ...detail, ...patch }, t, () => setDetail(null), showBlame, {
					height: paneHeight, onResize: setPaneHeight, hunk, onHunk: setHunk,
					layout, wide, paneRef, onLayout: (mode) => { setLayout(mode); try { window.localStorage?.setItem("dsh-gitview.diff-layout", mode); } catch { /* Browser policy may disable persistence. */ } },
					wrapped, onWrap: () => setWrapped((value) => !value), copied,
					onCopy: async (text) => {
						if (await primitives.writeClipboard(text)) {
							setCopied(true);
							setTimeout(() => setCopied(false), 1000);
						}
					}
				})
			);
		}
		//#endregion

		//#region data channel
		/**
		 * The Host's `/api` routes, written DOCUMENT-RELATIVE — the leading slash is
		 * deliberately absent because the shipped convention is
		 * `"/open-in-app/apps".slice(1)` / `CHANGED_FILES_PATH.slice(1)`. A relative
		 * request keeps working when the app is mounted under a path prefix, and it is
		 * same-origin either way, so the browser attaches the auth cookie and the Host's
		 * loopback Origin fence admits it.
		 */
		const ROUTES = {
			status: "api/git.tree",
			diff: "api/git.diff",
			history: "api/git.history",
			branches: "api/git.branches",
			reflog: "api/git.reflog",
			blame: "api/git.blame",
			mutate: "api/git.mutate",
			message: "api/git.message",
			ci: "api/git.ci",
			auth: "api/git.auth"
		};

		/** Build a query string, dropping parameters the caller left unset. */
		function query(params) {
			const search = new URLSearchParams();
			for (const [key, value] of Object.entries(params)) {
				if (value === undefined || value === null || value === "") continue;
				search.set(key, String(value));
			}
			return search.toString();
		}

		/**
		 * Call one route and normalize the answer into the `{ok:true,value}` /
		 * `{ok:false,error}` envelope the body expects — the same envelope a Remote call
		 * returns — so the transport stays invisible above this line.
		 *
		 * A non-2xx status and a transport failure both become the error branch rather
		 * than a rejection, so the body's error path handles every outcome.
		 */
		async function read(route, params, signal) {
			try {
				const response = await fetch(`${route}?${query(params)}`, {
					signal,
					headers: { accept: "application/json" }
				});
				if (!response.ok) {
					return { ok: false, error: { code: `http/${response.status}`, message: `HTTP ${response.status}` } };
				}
				return { ok: true, value: await response.json() };
			} catch (error) {
				return { ok: false, error: { code: "transport", message: String(error?.message ?? error) } };
			}
		}

		/**
		 * POST one mutation.
		 *
		 * The session id goes in the query because that is where the Host's routes read
		 * it, and a 400 carries a `code` worth surfacing rather than a bare status.
		 */
		async function write(route, sessionId, body, signal) {
			try {
				const response = await fetch(`${route}?${query({ sessionId })}`, {
					method: "POST",
					signal,
					headers: { "content-type": "application/json", accept: "application/json" },
					body: JSON.stringify(body)
				});
				if (!response.ok) {
					let code = `http/${response.status}`;
					try {
						const payload = await response.json();
						if (typeof payload?.code === "string") code = payload.code;
					} catch {
						// A non-JSON error body leaves the status as the code.
					}
					return { ok: false, error: { code, message: `HTTP ${response.status}` } };
				}
				return { ok: true, value: await response.json() };
			} catch (error) {
				return { ok: false, error: { code: "transport", message: String(error?.message ?? error) } };
			}
		}

		/** The git working-tree status for one session: identity, tree, operation, base. */
		function readStatus(sessionId, signal) {
			return read(ROUTES.status, { sessionId }, signal);
		}

		/** One path's patch, under a chosen baseline. */
		function readDiff(sessionId, path, scope, rev, signal) {
			return read(ROUTES.diff, { sessionId, path, scope, rev }, signal);
		}

		/** The commit history and its lane geometry. */
		function readHistory(sessionId, signal) {
			return read(ROUTES.history, { sessionId }, signal);
		}

		/** Local and remote-tracking branches. */
		function readBranches(sessionId, signal) {
			return read(ROUTES.branches, { sessionId }, signal);
		}

		/** What moved HEAD, newest first. */
		function readReflog(sessionId, signal) {
			return read(ROUTES.reflog, { sessionId }, signal);
		}

		/** One file's blame at a revision; the path is required by the route. */
		function readBlame(sessionId, path, signal) {
			return read(ROUTES.blame, { sessionId, path }, signal);
		}

		/** Stage, unstage or commit. */
		function sendMutation(sessionId, body, signal) {
			return write(ROUTES.mutate, sessionId, body, signal);
		}
		//#endregion

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

		exports.apply = apply;
		exports.inject = inject;
		// Exposed for the boot-free tests; the module system ignores extra exports.
		// Source views use the shell's grammar subscription.
		exports.__internals = {
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
		return module.exports;
	}
});
