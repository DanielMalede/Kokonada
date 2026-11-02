/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { FIELD_SKSL } from '../fieldShader.ts';

// T12, fork 2 (architect B4 forks, 2B): the field's output contract is sRGB-encoded, unmanaged and 8-bit.
//   C2: every Skia <Canvas> under src/design/v2 and src/design/lab asks for colorSpace "srgb" (Skia's
//       default is "p3") and is not opaque (opaque switches Android to a SurfaceView, another composition
//       path the device witness would have to prove again);
//   C3: the SkSL uses no colour-managed construct and returns through the manual encode.
// (C1, FieldView's own canvas, is in FieldView.test.tsx.)

const DESIGN = path.resolve(__dirname, '../../..');
const ROOTS = ['v2', 'lab'].map((d) => path.join(DESIGN, d));

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') sources(full, out);
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Each <Canvas> in `source` that does not ask for colorSpace "srgb", or that is opaque, with its line. */
export function canvasOffences(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const check = (tag: ts.JsxTagNameExpression, attributes: ts.JsxAttributes, at: ts.Node) => {
    if (!ts.isIdentifier(tag) || tag.text !== 'Canvas') return;
    const line = file.getLineAndCharacterOfPosition(at.getStart()).line + 1;
    const attr = (name: string) => attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === name);
    const colour = attr('colorSpace');
    const literal = colour?.initializer && ts.isStringLiteral(colour.initializer) ? colour.initializer.text : null;
    if (literal !== 'srgb') out.push(`${fileName}:${line} <Canvas> without colorSpace="srgb"`);
    if (attr('opaque') !== undefined) out.push(`${fileName}:${line} <Canvas> is opaque`);
    if (attributes.properties.some((p) => ts.isJsxSpreadAttribute(p))) out.push(`${fileName}:${line} <Canvas> takes spread props`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node)) check(node.tagName, node.attributes, node);
    if (ts.isJsxOpeningElement(node)) check(node.tagName, node.attributes, node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** The colour-managed constructs the field's SkSL must not use, and whether it returns through encode. */
export function skslOffences(sksl: string): string[] {
  const out: string[] = [];
  for (const banned of ['layout(color)', 'toLinearSrgb', 'fromLinearSrgb']) if (sksl.includes(banned)) out.push(banned);
  if (!/return half4\(encode\([^;]*\), encode\([^;]*\), encode\([^;]*\), 1\.0\);\s*}\s*$/.test(sksl)) out.push('main does not return through encode');
  return out;
}

describe('C2: every v2 and lab Skia canvas asks for sRGB and is not opaque', () => {
  const files = ROOTS.flatMap((root) => sources(root));

  it('the scan sees the real tree, FieldSurface’s canvas included', () => {
    expect(files.map((f) => path.relative(DESIGN, f).split(path.sep).join('/'))).toEqual(expect.arrayContaining(['v2/field/FieldSurface.tsx', 'lab/LabRoot.tsx']));
    expect(fs.readFileSync(path.join(DESIGN, 'v2/field/FieldSurface.tsx'), 'utf8')).toContain('<Canvas');
  });

  it('no canvas offends', () => {
    expect(files.flatMap((f) => canvasOffences(fs.readFileSync(f, 'utf8'), path.relative(DESIGN, f)))).toEqual([]);
  });

  it('planted: no prop, "p3", an expression, opaque and spread props are each flagged; "srgb" is not', () => {
    expect(canvasOffences('const a = <Canvas style={s}><X /></Canvas>;', 'plant.tsx')).toHaveLength(1);
    expect(canvasOffences('const a = <Canvas colorSpace="p3" />;', 'plant.tsx')).toHaveLength(1);
    expect(canvasOffences('const a = <Canvas colorSpace={space} />;', 'plant.tsx')).toHaveLength(1);
    expect(canvasOffences('const a = <Canvas colorSpace="srgb" opaque />;', 'plant.tsx')).toHaveLength(1);
    expect(canvasOffences('const a = <Canvas colorSpace="srgb" {...rest} />;', 'plant.tsx')).toHaveLength(1);
    expect(canvasOffences('const a = <Canvas style={s} colorSpace="srgb"><X /></Canvas>;', 'plant.tsx')).toEqual([]);
  });
});

describe('C3: the field SkSL is unmanaged and ends in the manual encode', () => {
  it('FIELD_SKSL has no colour-managed construct and returns through encode', () => {
    expect(skslOffences(FIELD_SKSL)).toEqual([]);
  });

  it('planted: layout(color), toLinearSrgb, fromLinearSrgb and a bare return are each flagged', () => {
    expect(skslOffences(FIELD_SKSL.replace('uniform shader uBlueNoise;', 'layout(color) uniform half4 uTint;\nuniform shader uBlueNoise;'))).toEqual(['layout(color)']);
    expect(skslOffences(FIELD_SKSL.replace('float3 lab = float3(L, A, B);', 'float3 lab = toLinearSrgb(float3(L, A, B));'))).toEqual(['toLinearSrgb']);
    expect(skslOffences(`${FIELD_SKSL}\n// fromLinearSrgb`)).toContain('fromLinearSrgb');
    expect(skslOffences(FIELD_SKSL.replace(/return half4\(encode[^;]*;/, 'return half4(linear, 1.0);'))).toEqual(['main does not return through encode']);
  });
});
