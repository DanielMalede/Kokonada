// The lab's one Yoga layout model for its RTL tests (UI-242; it replaces the copies the witness, storm and grain RTL tests
// each carried). It says where a host node of a react-test-renderer tree lands on the device, in dp, by React Native's
// rules on Android, so a test can measure a probe where the harness would read it:
//
//   · the swap: under RTL, with I18nManager.doLeftAndRightSwapInRTL on (the default), Fabric turns every `left` into
//     `start` and every `right` into `end` (YogaLayoutableShadowNode::swapLeftAndRightInYogaStyleProps), whatever the
//     node's own direction;
//   · direction: a node's `direction` style holds for it and its children; without one it inherits, from the root's
//     (I18nManager.isRTL) at the top;
//   · an absolute child resolves its start and end by its containing node's direction, not its own (Yoga's
//     AbsoluteLayout.cpp: layoutAbsoluteChild takes the current node's direction), and needs a width (or both sides) and a
//     height (or both top and bottom);
//   · a row lays its in-flow children from its start edge (the right edge under rtl), each with a width or flex 1, each as
//     tall as the row unless it has a height; a column stacks them from the top, flex 1 taking what is left, each as wide
//     as the column unless it has a width, and a child with a width sits at the cross-start edge (the right under rtl)
//     unless the column centres its items. `justifyContent: 'center'` centres the stack on the main axis.
//   · a uniform `borderWidth` leaves its node where it is and lays its children inside the border, absolute and in-flow
//     alike (Yoga places both inside it); a paint-only style (a colour, an opacity, an overflow, a transform, a corner
//     radius, a border colour, a shadow, a background image) moves nothing.
//
// Fail-closed: any other style key or value that moves a node (a margin, a padding, one side's border, row-reverse, a
// percentage) is an error, never a guess, so a scene that starts placing Views another way fails its RTL test until the
// model knows it. yogaRtlModel.test.tsx pins each rule.

import type ReactTestRenderer from 'react-test-renderer';

export type Box = { x: number; y: number; width: number; height: number };
export type Node = ReactTestRenderer.ReactTestInstance;
export type Dir = 'ltr' | 'rtl';
/** How the device lays out: whether left and right are swapped, and the root's direction. */
export type Rules = { swap: boolean; rootDir: Dir };

/** The device's rules from I18nManager (or a stand-in with the same two fields). */
export function layoutRules(i18n: { isRTL: boolean; doLeftAndRightSwapInRTL?: boolean }): Rules {
  return { swap: i18n.isRTL && i18n.doLeftAndRightSwapInRTL !== false, rootDir: i18n.isRTL ? 'rtl' : 'ltr' };
}

/** A style array or object, flattened as React Native flattens it (later wins, falsy entries dropped). */
export const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;

/** The host nodes from the outermost down to `node` itself. */
export function hostChain(node: Node): Node[] {
  const chain: Node[] = [];
  for (let n: Node | null = node; n !== null; n = n.parent) if (typeof n.type === 'string') chain.unshift(n);
  return chain;
}

/** A host node's nearest host children, through any composite components between them. */
export function hostChildren(node: Node): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      if (typeof c.type === 'string') out.push(c);
      else walk(c);
    }
  };
  walk(node);
  return out;
}

/** Style keys that do not move a node (paint only), and the values of the keys that do, which this model knows. */
const INERT = new Set(['backgroundColor', 'opacity', 'overflow', 'transform', 'borderRadius', 'borderColor', 'boxShadow', 'experimental_backgroundImage']);
const KNOWN = new Set(['flex', 'direction', 'flexDirection', 'alignItems', 'justifyContent', 'position', 'left', 'right', 'top', 'bottom', 'start', 'end', 'width', 'height', 'borderWidth']);

function checked(node: Node): Record<string, unknown> {
  const s = flat(node.props.style);
  const problem = (why: string) => new Error(`unmodelled style on ${node.props.testID ?? node.props.nativeID ?? node.type}: ${why} in ${JSON.stringify(s)}`);
  for (const [k, v] of Object.entries(s)) {
    if (INERT.has(k) || v === undefined) continue;
    if (!KNOWN.has(k)) throw problem(k);
    if (['left', 'right', 'top', 'bottom', 'start', 'end', 'width', 'height', 'borderWidth'].includes(k) && typeof v !== 'number') throw problem(`${k} ${JSON.stringify(v)}`);
    if (k === 'flex' && v !== 1) throw problem(`flex ${JSON.stringify(v)}`);
    if (k === 'direction' && v !== 'ltr' && v !== 'rtl' && v !== 'inherit') throw problem(`direction ${JSON.stringify(v)}`);
    if (k === 'flexDirection' && v !== 'row' && v !== 'column') throw problem(`flexDirection ${JSON.stringify(v)}`);
    if (k === 'alignItems' && v !== 'center' && v !== 'stretch') throw problem(`alignItems ${JSON.stringify(v)}`);
    if (k === 'justifyContent' && v !== 'center' && v !== 'flex-start') throw problem(`justifyContent ${JSON.stringify(v)}`);
    if (k === 'position' && v !== 'absolute' && v !== 'relative') throw problem(`position ${JSON.stringify(v)}`);
  }
  if (s.position !== 'absolute' && ['left', 'right', 'top', 'bottom', 'start', 'end'].some((k) => s[k] !== undefined)) throw problem('an inset on an in-flow node');
  return s;
}

const num = (v: unknown) => (v === undefined ? undefined : (v as number));
const ownDir = (s: Record<string, unknown>, inherited: Dir): Dir => (s.direction === 'ltr' || s.direction === 'rtl' ? s.direction : inherited);

/** A node's resolved direction: the nearest `direction` on it or above it, else the root's. */
export function directionOf(node: Node, rules: Rules): Dir {
  let dir = rules.rootDir;
  for (const n of hostChain(node)) dir = ownDir(flat(n.props.style), dir);
  return dir;
}

/** The main-axis size an in-flow child takes before flex: its own, or (for a row in a column) its tallest child's. */
function fixedMain(child: Node, row: boolean): number | null {
  const s = checked(child);
  if (s.flex === 1) return null;
  const own = num(row ? s.width : s.height);
  if (own !== undefined) return own;
  if (!row && s.flexDirection === 'row') {
    const heights = hostChildren(child).filter((c) => checked(c).position !== 'absolute').map((c) => num(checked(c).height));
    if (heights.every((h) => h !== undefined)) return Math.max(0, ...(heights as number[]));
  }
  throw new Error(`unmodelled ${row ? 'width' : 'height'}: ${child.props.testID ?? child.props.nativeID ?? child.type} has no size and no flex 1 on the main axis`);
}

/** Where `node` lands inside `parentBox`, its parent laid out in direction `parentDir`. */
function place(node: Node, parent: Node | null, parentBox: Box, parentDir: Dir, rules: Rules): Box {
  const s = checked(node);
  if (parent === null) return parentBox;
  const ps = checked(parent);
  if (s.position === 'absolute') {
    let start = num(s.start);
    let end = num(s.end);
    let left = num(s.left);
    let right = num(s.right);
    if (rules.swap) {
      if (left !== undefined) start = left;
      if (right !== undefined) end = right;
      left = undefined;
      right = undefined;
    }
    const L = left ?? (parentDir === 'rtl' ? end : start);
    const R = right ?? (parentDir === 'rtl' ? start : end);
    const T = num(s.top);
    const B = num(s.bottom);
    const width = num(s.width) ?? (L !== undefined && R !== undefined ? parentBox.width - L - R : undefined);
    const height = num(s.height) ?? (T !== undefined && B !== undefined ? parentBox.height - T - B : undefined);
    if (width === undefined || height === undefined) throw new Error(`unmodelled absolute size on ${node.props.testID ?? node.props.nativeID ?? node.type}: ${JSON.stringify(s)}`);
    const x = L !== undefined ? parentBox.x + L : R !== undefined ? parentBox.x + parentBox.width - R - width : parentBox.x;
    const y = T !== undefined ? parentBox.y + T : B !== undefined ? parentBox.y + parentBox.height - B - height : parentBox.y;
    return { x, y, width, height };
  }
  // In flow: the parent's flex line.
  const row = ps.flexDirection === 'row';
  const siblings = hostChildren(parent).filter((c) => checked(c).position !== 'absolute');
  const i = siblings.indexOf(node);
  const mains = siblings.map((c) => fixedMain(c, row));
  const total = row ? parentBox.width : parentBox.height;
  const fixed = mains.reduce<number>((a, m) => a + (m ?? 0), 0);
  const flexed = mains.filter((m) => m === null).length;
  const sizeOf = (m: number | null) => (m ?? Math.max(0, total - fixed) / flexed);
  const before = mains.slice(0, i).reduce<number>((a, m) => a + sizeOf(m), 0);
  const main = sizeOf(mains[i]);
  const lead = ps.justifyContent === 'center' && flexed === 0 ? (total - fixed) / 2 : 0;
  const crossTotal = row ? parentBox.height : parentBox.width;
  const crossOwn = num(row ? s.height : s.width);
  const cross = crossOwn ?? crossTotal;
  const crossAt = ps.alignItems === 'center' ? (crossTotal - cross) / 2 : 0;
  if (row) {
    const fromStart = lead + before;
    const x = parentDir === 'rtl' ? parentBox.x + parentBox.width - fromStart - main : parentBox.x + fromStart;
    return { x, y: parentBox.y + crossAt, width: main, height: cross };
  }
  // A column: the cross axis is horizontal, its start the right edge under rtl.
  const x = ps.alignItems === 'center' || crossOwn === undefined
    ? parentBox.x + crossAt
    : parentDir === 'rtl' ? parentBox.x + parentBox.width - cross : parentBox.x;
  return { x, y: parentBox.y + lead + before, width: cross, height: main };
}

/** The box a node lays its children in: its frame inside its uniform border. */
function inside(box: Box, s: Record<string, unknown>): Box {
  const b = num(s.borderWidth) ?? 0;
  return { x: box.x + b, y: box.y + b, width: box.width - 2 * b, height: box.height - 2 * b };
}

/** Where a host node lands, in dp, the outermost host filling `stage`. */
export function frameOf(node: Node, stage: Box, rules: Rules): Box {
  const chain = hostChain(node);
  let box = stage;
  let content = stage;
  let dir = rules.rootDir;
  let parent: Node | null = null;
  for (const n of chain) {
    box = place(n, parent, content, dir, rules);
    const s = checked(n);
    dir = ownDir(s, dir);
    content = inside(box, s);
    parent = n;
  }
  return box;
}

/** The node the lab's measureInWindow is asked about, by its nativeID (a Probe's `probe-<id>`). */
export function hostByNativeId(root: Node, nativeID: string | undefined): Node {
  return root.find((n) => typeof n.type === 'string' && n.props.nativeID === nativeID);
}
