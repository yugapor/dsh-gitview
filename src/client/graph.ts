// @ts-nocheck -- moved verbatim from the hand-written bundle; type it when it is next changed.
import { h } from "./deps";
import { LANE_BLEED, LANE_INSET, LANE_SPAN, LANE_W } from "./model";

// The shell's syntax palette adapts to both themes, without using diff red/green.
export const GRAPH_COLORS = ["var(--shiki-token-constant)", "var(--shiki-token-function)", "var(--shiki-token-parameter)", "var(--shiki-token-keyword)"];
export function branchColor(name) {
	if (name === "main" || name === "master") return GRAPH_COLORS[0];
	let hash = 0;
	for (const char of String(name)) hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
	return GRAPH_COLORS[hash % GRAPH_COLORS.length];
}

/** Carry colour along live edges, not column numbers: a freed column is another history. */
export function colorGraph(commits) {
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
export function laneGutter(commit, width = Math.max(1, commit.width ?? 1) * LANE_W) {
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
