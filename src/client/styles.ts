// @ts-nocheck -- moved verbatim from the hand-written bundle; type it when it is next changed.
import { TAB_ID } from "./sidebar";

// Theme colours and primitives belong to the shell; this sheet owns the layout.
export const CSS = `
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

.gt_wView { container: gt-view / inline-size; overflow: hidden; box-sizing: border-box; height: 100%; min-height: 0; min-width: 0; display: flex; flex-direction: column; flex: auto; color: var(--dsw-alias-label-primary); font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 1.5; }
.gt_wHead { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 16px; padding: 8px 12px 8px 16px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.gt_wRepo { display: flex; align-items: center; gap: 8px; min-width: 0; }
.gt_wBranch { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0; }
.gt_wNote { color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); white-space: nowrap; flex: none; }
.gt_wRepoPath { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 2 auto; }
.gt_wHeadEnd { display: flex; align-items: center; justify-content: flex-end; gap: 2px; min-width: 0; }
.gt_wCi { display: inline-flex; align-items: center; gap: 6px; font: var(--dsw-font-xxs-12); }

.gt_wReview, .gt_wRepository { flex: 1 1 auto; min-height: 0; display: grid; position: relative; }
.gt_wReview { grid-template-columns: minmax(248px, 300px) minmax(0, 1fr); }
.gt_wRepository { grid-template-columns: minmax(208px, 248px) minmax(0, 1fr) auto; }
.gt_wRail { min-height: 0; min-width: 0; display: flex; flex-direction: column; border-right: .5px solid var(--dsw-alias-border-l2); }
.gt_wRailHead { flex: none; display: flex; align-items: center; gap: 2px; padding: 12px 8px 4px 16px; }
.gt_wRailTitle { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; }
.gt_wFilter { flex: none; padding: 4px 12px 6px; }
.gt_wFilter .gt_input, .gt_wListHead .gt_input { padding: 6px 10px; font: var(--dsw-font-xxs-12); }
.gt_wRailBody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 8px 8px; scrollbar-gutter: stable; }
.gt_wRail .gt_group { border: 0; border-radius: 0; margin: 0 0 6px; padding: 0; }
.gt_wRail .gt_section { position: sticky; top: 0; z-index: 1; background: var(--dsw-alias-bg-layer-1); padding: 10px 8px 4px; }
.gt_wRail .gt_row { padding: 4px 8px; }
.gt_wView .gt_row[aria-current=true] { box-shadow: none; background: var(--dsw-alias-interactive-bg-hover); }
.gt_wView .gt_row[aria-current=true] .gt_name, .gt_wView .gt_row[aria-current=true] .gt_wSubjectText { font-weight: 600; }
.gt_wKeys { flex: none; margin: 0; padding: 6px 16px 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.gt_wRemotes > summary { cursor: pointer; list-style: none; }
.gt_wRemotes > summary::-webkit-details-marker { display: none; }
.gt_wBranchRow:disabled { cursor: default; color: var(--dsw-alias-label-secondary); }
.gt_wBranchRow:disabled:hover { background: 0 0; }
.gt_wHere { margin: 10px 0 12px; padding: 6px 4px 4px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.gt_wHereTitle { padding: 2px 8px 4px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.gt_wHereBranch { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 8px; font-weight: 600; }
.gt_wTrack { flex: none; margin-left: auto; display: inline-flex; gap: 6px; font: var(--dsw-font-xxxs-11); font-weight: 500; font-variant-numeric: tabular-nums; }
.gt_wHereSub { padding: 0 8px 4px 28px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gt_wHere .gt_row { padding: 4px 8px; }
.gt_wHere .gt_row > .gt_count { flex: none; margin-left: auto; font: var(--dsw-font-xxxs-11); }
.gt_wHere .gt_row:disabled { cursor: default; }
.gt_wHere .gt_row:disabled:hover { background: 0 0; }
.gt_wHereCheck { padding-left: 20px !important; }

.gt_wCommit { flex: none; display: flex; flex-direction: column; gap: 6px; margin: 2px 12px 8px; }
.gt_wMessageBox { position: relative; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); transition: border-color .15s cubic-bezier(.16, 1, .3, 1); }
.gt_wMessageBox:focus-within { border-color: var(--dsw-alias-border-l1); }
.gt_wMessage { box-sizing: border-box; display: block; width: 100%; min-height: 34px; max-height: 160px; margin: 0; padding: 7px 36px 7px 10px; border: 0; outline: none; resize: none; background: transparent; color: inherit; font: inherit; line-height: 1.45; field-sizing: content; }
.gt_wMessage::placeholder { color: var(--dsw-alias-label-tertiary); }
.gt_wGenerate { position: absolute; top: 3px; right: 3px; }
.gt_wCommitButton { width: 100%; justify-content: center; }
.gt_wCommitMeta { display: flex; flex-direction: column; gap: 2px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }

.gt_wMain { container: gt-main / inline-size; position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.gt_wDoc { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.gt_wDocHead { flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; padding: 8px 12px 8px 16px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.gt_wDocHead > .gt_wPath { flex: 1 1 160px; }
.gt_wPath { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gt_wDir { color: var(--dsw-alias-label-tertiary); }
.gt_wFile { font-weight: 600; }
.gt_wTools { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; margin-left: auto; }
.gt_wTools > .gt_meta { gap: 2px; font-variant-numeric: tabular-nums; }
.gt_wTools button[aria-pressed=true] { background: var(--dsw-alias-interactive-bg-hover); }
.gt_wTools button[aria-pressed=true] .gt_icon { color: var(--dsw-alias-label-primary); }
.gt_wDocBody { flex: 1 1 auto; min-height: 0; overflow: auto; }
.gt_wDocBody .gt_patch { padding: 6px 0 24px; }
.gt_wEmpty { margin: auto; max-width: 44ch; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 48px 24px; text-align: center; color: var(--dsw-alias-label-secondary); }
.gt_wEmpty p { margin: 0; }
.gt_wEmpty .gt_wEmptyTitle { color: var(--dsw-alias-label-primary); font-weight: 600; }
.gt_wEmpty button { margin-top: 12px; }

.gt_wListHead { flex: none; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 16px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.gt_wListHead .gt_input { flex: 0 1 300px; width: auto; }
.gt_wListHead > .gt_meta { margin-left: auto; font-variant-numeric: tabular-nums; }
.gt_wLedger { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px 8px 16px; scrollbar-gutter: stable; }
.gt_wLedgerRow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 132px) 64px 40px; column-gap: 16px; min-height: 34px; padding-top: 0; padding-bottom: 0; }
.gt_wLedgerRow[data-ahead=true] .gt_wSubjectText { font-weight: 500; }
.gt_wLedgerRow[data-head=true] { background: var(--dsw-alias-bg-layer-2); }
.gt_wJump { position: absolute; left: 50%; z-index: 2; display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); cursor: pointer; box-shadow: 0 4px 14px rgb(0 0 0 / .18); transform: translateX(-50%); animation: gt_wRise .2s cubic-bezier(.16, 1, .3, 1); }
.gt_wJump[data-place=below] { bottom: 16px; }
.gt_wJump[data-place=above] { top: 64px; }
.gt_wJump:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gt_wJump:focus-visible { outline: 2px solid var(--dsw-alias-link); outline-offset: 2px; }
@keyframes gt_wRise { from { opacity: 0; transform: translate(-50%, 6px); } }
@media (prefers-reduced-motion: reduce) { .gt_wJump { animation: none; } }
/* Refs give way before the subject does, and nothing paints into the next column. */
.gt_wSubject { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
.gt_wSubject > :not(.gt_wSubjectText) { flex: 0 1 auto; min-width: 0; max-width: 60%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.gt_wSubjectText { flex: 1 1 0; min-width: 8ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gt_wAuthor { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
.gt_wLedgerRow .gt_time { margin-left: 0; text-align: right; }

.gt_wInspector { width: min(560px, 46cqw); min-width: 0; min-height: 0; display: flex; flex-direction: column; border-left: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); animation: gt_wReveal .24s cubic-bezier(.16, 1, .3, 1); }
.gt_wInspector[data-kind=commit] { width: min(760px, 56cqw); }
/* VS Code's flat list: the name, then its folder, quiet; git's letter last; actions on hover. */
.gt_wFileRow { padding-top: 3px; padding-bottom: 3px; }
.gt_wFileRow > .gt_name { flex: 0 1 auto; }
.gt_wFileRow > .gt_wDir { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--dsw-font-xxs-12); }
.gt_wFileRow > .gt_change { flex: none; width: 1.2em; text-align: center; font-weight: 600; }
.gt_wFileRow > .gt_actions { visibility: hidden; }
.gt_wFileRow:hover > .gt_actions, .gt_wFileRow:focus-within > .gt_actions, .gt_wFileRow[aria-current=true] > .gt_actions { visibility: visible; }
.gt_wCommitFiles { position: relative; padding: 2px 0 6px; }
.gt_wCommitFiles .gt_wFileRow { padding-left: 6px; }
.gt_wCommitFiles > .gt_note { padding-left: 6px; }
.gt_wLanes { position: absolute; top: 0; bottom: 0; pointer-events: none; overflow: hidden; }
@keyframes gt_wReveal { from { opacity: 0; transform: translateX(16px); } }
@media (prefers-reduced-motion: reduce) { .gt_wInspector { animation: none; } }
.gt_wInspectHead { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 14px 12px 12px 16px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.gt_wInspectTitle { display: flex; align-items: flex-start; gap: 8px; }
.gt_wInspectTitle strong { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; text-wrap: pretty; }
.gt_wInspectBody { flex: 1 1 auto; min-height: 0; overflow: auto; }
.gt_wInspectBody > .gt_ciView { overflow: visible; padding: 12px 16px; }
.gt_wFileHead { flex: none; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 16px; background: var(--dsw-alias-bg-layer-1); border-bottom: .5px solid var(--dsw-alias-border-l3); font: var(--dsw-font-xxs-12); }
.gt_wFileHead > .gt_wPath { flex: 1; }

/* The ledger answers to its own width, which the inspector takes from. */
@container gt-main (max-width: 680px) { .gt_wLedgerRow { grid-template-columns: minmax(0, 1fr) 64px 40px; } .gt_wLedgerRow .gt_wAuthor { display: none; } }
@container gt-main (max-width: 460px) { .gt_wLedgerRow { grid-template-columns: minmax(0, 1fr) 40px; } .gt_wLedgerRow .gt_sha { display: none; } }
@container gt-view (max-width: 760px) {
	.gt_wHead { grid-template-columns: minmax(0, 1fr) auto; }
	.gt_wHeadEnd { display: none; }
	.gt_wReview, .gt_wRepository { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
	.gt_wRail { max-height: 40vh; border-right: 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
	.gt_wInspector { position: absolute; inset: 0; z-index: 2; width: auto; border-left: 0; }
}

.gt_setRow { display: flex; align-items: center; gap: 8px; padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.gt_setText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-right: 48px; }
.gt_setTitle { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
.gt_setDesc { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.gt_setSelector { display: inline-flex; align-items: center; gap: 12px; height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.gt_setSelector:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gt_setSelector:focus-visible { outline: 2px solid var(--dsw-alias-link); outline-offset: 2px; }
`;

/** The document this bundle is running in, when there is one. */
export const STYLE_ID = "dsh-gitview/panel.css";

/**
 * Put the stylesheet in the document once.
 *
 * The idiom — a `data-plugin-css` marker naming the owning package — is the one
 * every shipped client bundle uses, so the tag can be found and replaced rather
 * than duplicated. It is guarded because this module is also loaded in tests and
 * in any context without a DOM.
 */
export function injectStyles() {
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
