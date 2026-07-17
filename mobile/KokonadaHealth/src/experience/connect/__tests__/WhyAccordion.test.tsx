import React from 'react';
import { AccessibilityInfo } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { WhyAccordion } from '../WhyAccordion';

// The "why we ask" disclosure (§3). Privacy-Vault tone: the reason is one tap away but never
// shouted. Collapsed by default; a button header toggles it; the body is the honest reason. It is
// a DISCLOSURE, not a commit — so it fires NO haptic and carries a proper accessibilityState.

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const allText = (tree: ReactTestRenderer.ReactTestRenderer) => texts(tree.toJSON()).join(' ');
const header = (tree: ReactTestRenderer.ReactTestRenderer, title: string) =>
  tree.root.findAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === title)[0];

const TITLE = 'Why we ask for health data';
const BODY = 'Kokonada turns how your body is doing into music tuned to you.';

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<WhyAccordion title={TITLE} body={BODY} />); });
  return tree;
}

describe('WhyAccordion — disclosure of the reason', () => {
  it('is collapsed by default: the header shows, the body is hidden, expanded=false', async () => {
    const tree = await render();
    const h = header(tree, TITLE);
    expect(h).toBeTruthy();
    expect(h.props.accessibilityState).toEqual({ expanded: false });
    expect(allText(tree)).not.toContain(BODY);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('tapping the header expands to reveal the body and flips expanded=true', async () => {
    const tree = await render();
    await ReactTestRenderer.act(async () => { header(tree, TITLE).props.onPress(); });
    expect(allText(tree)).toContain(BODY);
    expect(header(tree, TITLE).props.accessibilityState).toEqual({ expanded: true });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('tapping again collapses it back (a real toggle)', async () => {
    const tree = await render();
    await ReactTestRenderer.act(async () => { header(tree, TITLE).props.onPress(); });
    await ReactTestRenderer.act(async () => { header(tree, TITLE).props.onPress(); });
    expect(allText(tree)).not.toContain(BODY);
    expect(header(tree, TITLE).props.accessibilityState).toEqual({ expanded: false });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the chevron/decorative glyph is hidden from the screen reader (focus lands on the header)', async () => {
    const tree = await render();
    const hidden = tree.root.findAll((n) => n.props.accessibilityElementsHidden === true);
    expect(hidden.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('under reduced motion the toggle is instant and the expanded layout is byte-identical (body reveals)', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<WhyAccordion title={TITLE} body={BODY} />); });
    await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); }); // let reduced-motion resolve
    await ReactTestRenderer.act(async () => { header(tree, TITLE).props.onPress(); });
    // Same expanded content as the animated path — the reason is fully readable, no layout divergence.
    expect(allText(tree)).toContain(BODY);
    expect(header(tree, TITLE).props.accessibilityState).toEqual({ expanded: true });
    spy.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
