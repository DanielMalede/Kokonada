/// <reference types="node" />
import * as path from 'path';
import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { loadMutant } from '../../../testing/mutant';
import type { InlineNoticeProps } from '../../v2/components/InlineNotice/InlineNotice';
import { glyphOffset, noticeActionLayout } from '../../v2/components/InlineNotice/actionLayout';
import { blockGaps, isolateAddresses, LRI, PDI, type LegalBlock } from '../../v2/components/LegalReader/legalDocument';
import type { LegalReaderProps } from '../../v2/components/LegalReader/LegalReader';
import { readerSpace } from '../../v2/components/LegalReader/readerSpace';
import type { WellProps } from '../../v2/components/Well/Well';
import { DirectionProvider } from '../../v2/tokens/DirectionProvider';
import { BASE, DIRECTIONS } from '../../v2/tokens/tokens.generated';

// LF3: mutants planted in the real sources of the InlineNotice, the LegalReader and the Well, each killed by the same check
// its own suite makes (InlineNotice/__tests__, LegalReader/__tests__, Well/__tests__). They live here because a v2 test
// imports nothing from outside v2 (isolation.test.ts), and the planting tool is the app's (src/testing/mutant.ts), as
// heroDriverMutants.test.tsx has it. Every mutant is in memory only. The closure and face guards' own mutants are their
// planted sources (inlineNoticeClosure.test.ts, legalReaderClosure.test.ts).

jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
  const RNView = require('react-native').View;
  const timings: Array<{ toValue: number; config: { duration: number } }> = [];
  return {
    __esModule: true,
    default: { View: RNView },
    View: RNView,
    useSharedValue: (initial: number) => {
      const ref = useRef(null as null | { value: number });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useAnimatedStyle: (updater: () => Record<string, unknown>) => updater(),
    withTiming: (toValue: number, config: { duration: number }) => {
      timings.push({ toValue, config });
      return toValue;
    },
    Easing: { bezier: () => (t: number) => t },
    __timings: timings,
  };
});
const timings = (): Array<{ toValue: number; config: { duration: number } }> => jest.requireMock('react-native-reanimated').__timings;

const COMPONENTS = path.resolve(__dirname, '../../v2/components');
const NOTICE = path.join(COMPONENTS, 'InlineNotice');
const READER = path.join(COMPONENTS, 'LegalReader');
const WELL = path.join(COMPONENTS, 'Well');

type Node = ReactTestRenderer.ReactTestInstance;
const isHost = (n: Node) => typeof n.type === 'string';
const flat = (n: Node) => StyleSheet.flatten(n.props.style) ?? {};

function render(element: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(<DirectionProvider direction="abyss" face="dark">{element}</DirectionProvider>, { createNodeMock: () => ({}) });
  });
  const byId = (id: string) => r.root.find((n) => isHost(n) && n.props.testID === id);
  return { r, byId, unmount: () => act(() => r.unmount()) };
}
afterEach(() => {
  jest.restoreAllMocks();
  timings().splice(0);
});

describe('actionLayout.ts', () => {
  type Layout = typeof noticeActionLayout;
  const mutant = (find: string, replace: string) => loadMutant<{ noticeActionLayout: Layout; glyphOffset: typeof glyphOffset }>(path.join(NOTICE, 'actionLayout.ts'), [{ find, replace }], require);

  it('the real rule: the boundary fits, the gap counts, unmeasured stacks', () => {
    expect([noticeActionLayout(216, [120, 80], 16), noticeActionLayout(205, [120, 80], 16), noticeActionLayout(null, [120, 80], 16)]).toEqual(['row', 'stack', 'stack']);
  });

  it('planted: a strict comparison stacks two actions that exactly fit', () => {
    expect(mutant('needed <= column', 'needed < column').noticeActionLayout(216, [120, 80], 16)).toBe('stack');
  });

  it('planted: a rule that forgets the gap puts on one row two labels that fit only without it', () => {
    expect(mutant(' + gap * (widths.length - 1)', '').noticeActionLayout(205, [120, 80], 16)).toBe('row');
  });

  it('planted: a pair laid out on one row before it is measured', () => {
    expect(mutant("if (column === null || widths.some((w) => w === null)) return 'stack';", "if (column === null || widths.some((w) => w === null)) return 'row';").noticeActionLayout(null, [120, 80], 16)).toBe('row');
  });

  it('planted: a glyph offset that ignores the font scale sits 2 down at 2.0, not 14', () => {
    expect(glyphOffset(24, 2, 20)).toBe(14);
    expect(mutant('(lineHeight * fontScale - glyph) / 2', '(lineHeight - glyph) / 2').glyphOffset(24, 2, 20)).toBe(2);
  });
});

describe('InlineNotice.tsx', () => {
  type Notice = (p: InlineNoticeProps) => React.ReactElement;
  const plant = (find: string, replace: string) => loadMutant<{ InlineNotice: Notice }>(path.join(NOTICE, 'InlineNotice.tsx'), [{ find, replace }], require).InlineNotice;
  const actions: InlineNoticeProps['actions'] = [
    { kind: 'link', label: 'Link', onPress: () => undefined },
    { kind: 'button', label: 'Dismiss', onPress: () => undefined },
  ];
  /** The suite's checks: the roles in order, the link alone underlined, the body selectable when asked. */
  const facts = (N: Notice) => {
    const v = render(<N body="Body" script="latin" selectable actions={actions} />);
    const out = {
      roles: [0, 1].map((i) => v.byId(`inlineNotice.action.${i}`).props.accessibilityRole),
      underline: [0, 1].map((i) => flat(v.byId(`inlineNotice.action.${i}.label`)).textDecorationLine ?? null),
      selectable: v.byId('inlineNotice.body').props.selectable === true,
      minHeight: flat(v.byId('inlineNotice.action.0')).minHeight,
    };
    v.unmount();
    return out;
  };
  const REAL = { roles: ['link', 'button'], underline: ['underline', null], selectable: true, minHeight: BASE.target.min };

  it('the real notice', () => {
    const { InlineNotice } = require('../../v2/components/InlineNotice/InlineNotice');
    expect(facts(InlineNotice)).toEqual(REAL);
  });

  it('planted: every action given the button role (the link loses its role)', () => {
    expect(facts(plant("accessibilityRole={action.kind === 'link' ? 'link' : 'button'}", "accessibilityRole={'button'}")).roles).toEqual(['button', 'button']);
  });

  it('planted: the button underlined as a link is', () => {
    expect(facts(plant("action.kind === 'link' && styles.underline", 'styles.underline')).underline).toEqual(['underline', 'underline']);
  });

  it('planted: the selectable flag dropped', () => {
    expect(facts(plant('selectable={selectable}', 'selectable={false}')).selectable).toBe(false);
  });

  it('planted: an action row below target.min', () => {
    expect(facts(plant('minHeight: tokens.base.target.min,', 'minHeight: tokens.base.spacing[\'10\'] - 8,')).minHeight).toBe(40);
  });
});

describe('legalDocument.ts', () => {
  const SPACE = readerSpace({ base: BASE, direction: DIRECTIONS.abyss });
  const p: LegalBlock = { kind: 'paragraph', text: 'p' };
  const h: LegalBlock = { kind: 'heading', text: 'h' };
  const load = (find: string, replace: string) => loadMutant<{ blockGaps: typeof blockGaps; isolateAddresses: typeof isolateAddresses }>(path.join(READER, 'legalDocument.ts'), [{ find, replace }], require);

  it('the real rules', () => {
    expect(blockGaps([p, h, p], SPACE)).toEqual([0, 32, 8]);
    const mail = isolateAddresses('write to data.protection@example.org');
    expect(isolateAddresses(mail)).toBe(mail);
  });

  it('planted: the block under a heading given the paragraph gap', () => {
    expect(load("blocks[i - 1].kind === 'heading' ? space.headingGapBelow : space.paragraphGap", 'space.paragraphGap').blockGaps([p, h, p], SPACE)).toEqual([0, 32, 16]);
  });

  it('planted: a first heading given the gap above (the document starts low)', () => {
    expect(load('if (i === 0) return 0;\n', '').blockGaps([h, p], SPACE)).toEqual([32, 8]);
  });

  it('planted: the lookbehind dropped, so an isolated email is isolated again from its dot', () => {
    const m = load('(?<![\\u2066\\w.%+\\-@/:])', '\\b');
    const mail = m.isolateAddresses('write to data.protection@example.org');
    expect(m.isolateAddresses(mail)).not.toBe(mail);
  });
});

describe('LegalReader.tsx', () => {
  type Reader = (p: LegalReaderProps) => React.ReactElement;
  const plant = (find: string, replace: string) => loadMutant<{ LegalReader: Reader }>(path.join(READER, 'LegalReader.tsx'), [{ find, replace }], require).LegalReader;
  const PROPS: LegalReaderProps = {
    document: { title: 'T', version: '1', dateLabel: 'D', blocks: [{ kind: 'heading', text: 'H' }, { kind: 'paragraph', text: 'P' }, { kind: 'list', items: ['a', 'b'] }] },
    script: 'latin',
    address: 'https://example.org/x',
    lines: { current: (a) => `at ${a}`, version: (v, d) => `${v} ${d}` },
    closeLabel: 'Close',
    onClose: () => undefined,
    tier: 'still',
  };
  /** The suite's checks: Heebo only (on Android), the address isolated, paragraphs selectable, the still tier instant. */
  const facts = (R: Reader) => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const v = render(<R {...PROPS} />);
    const faces = v.r.root.findAllByType(Text).map((n) => String(flat(n).fontFamily));
    act(() => v.r.root.find((n) => !isHost(n) && n.props.testID === 'legalReader.scroll' && typeof n.props.onScroll === 'function').props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 9 } } }));
    const out = {
      heeboOnly: faces.every((f) => /^Heebo-/.test(f)),
      current: v.byId('legalReader.current').props.children,
      selectable: v.byId('legalReader.block.paragraph').props.selectable === true,
      durations: timings().map((t) => t.config.duration),
      currentFirst: (v.byId('legalReader.meta').children as Node[]).map((m) => m.props.testID)[0],
    };
    v.unmount();
    timings().splice(0);
    return out;
  };
  const REAL = { heeboOnly: true, current: `at ${LRI}https://example.org/x${PDI}`, selectable: true, durations: [0], currentFirst: 'legalReader.current' };

  it('the real reader', () => {
    const { LegalReader } = require('../../v2/components/LegalReader/LegalReader');
    expect(facts(LegalReader)).toEqual(REAL);
  });

  it('planted: the title set in the voice face (CMP-122)', () => {
    expect(facts(plant("const weight = role === 'title' ? tokens.direction.type.ui.title.weight : ui[role][script].weight;\n    return { ...fontFace(tokens.base.type.face.ui, weight)", "const weight = role === 'title' ? tokens.direction.type.ui.title.weight : ui[role][script].weight;\n    return { ...fontFace(role === 'title' ? tokens.base.type.face.voice : tokens.base.type.face.ui, role === 'title' ? 400 : weight)")).heeboOnly).toBe(false);
  });

  it('planted: the hosted address not isolated', () => {
    expect(facts(plant('lines.current(`${LRI}${address}${PDI}`)', 'lines.current(address)')).current).toBe('at https://example.org/x');
  });

  it('planted: a paragraph that cannot be selected', () => {
    expect(facts(plant('<Text testID="legalReader.block.paragraph" selectable', '<Text testID="legalReader.block.paragraph"')).selectable).toBe(false);
  });

  it('planted: the hairline fading at the still tier', () => {
    expect(facts(plant("duration: tier === 'still' ? 0 : press.duration", 'duration: press.duration')).durations).toEqual([BASE.motion.press.duration]);
  });

  it('planted: the version line drawn first (item 97 swapped back)', () => {
    const swapped = plant(
      '<View testID="legalReader.meta">\n            <Text testID="legalReader.current"',
      '<View testID="legalReader.meta">\n            <Text testID="legalReader.versionFirst" />\n            <Text testID="legalReader.current"',
    );
    expect(facts(swapped).currentFirst).toBe('legalReader.versionFirst');
  });
});

describe('Well.tsx', () => {
  type WellC = (p: WellProps) => React.ReactElement;
  const hintLabel = (W: WellC) => {
    const v = render(<W actionShown={false} hint="Hint" hintAccessibilityLabel="Label" script="latin" tier="still" host="button" hintAlign="start" />);
    const label = v.r.root.findAll((n) => isHost(n) && String(n.type) === 'Text')[0].props.accessibilityLabel;
    v.unmount();
    return label;
  };

  it('the real Well gives the hint its label', () => {
    const { Well } = require('../../v2/components/Well/Well');
    expect(hintLabel(Well)).toBe('Label');
  });

  it('planted: the label never reaches the hint', () => {
    const W = loadMutant<{ Well: WellC }>(path.join(WELL, 'Well.tsx'), [{ find: ' accessibilityLabel={hintAccessibilityLabel}', replace: '' }], require).Well;
    expect(hintLabel(W)).toBeUndefined();
  });
});
