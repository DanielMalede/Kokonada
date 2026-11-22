/// <reference types="node" />
// QA-115, required-props half (Stage 0 Q2). An action callback (`on[A-Z]*`) is a required prop with no
// no-op default. This scanner reads the syntax tree and flags:
//   · optional-prop: an optional `on[A-Z]*` property or method signature whose type is a function, a union
//     holding one, `Function`, a reference named like a callback (…Handler, …Callback, …Listener), or an
//     indexed access to an `on[A-Z]*` key (`PressableProps['onPress']`); and a required one whose type
//     admits `undefined` beside a callback (`(() => void) | undefined`), which is optional in all but name;
//   · noop-default: an `on[A-Z]*` binding destructured with a default that does nothing: `() => {}`,
//     `function () {}`, `() => undefined`, `() => null`, `Function.prototype`, or an identifier or member
//     named `noop`.
// It is a report until src/design/v2 and src/pages are on main (D8 rule 3); OPS-420 registers the gate.

import ts from 'typescript';
import { parseSource } from '../../src/testing/guards/sourceFiles';

/** The trees this scanner gates. Empty until V1 merges: over a missing tree it would pass vacuously. */
export const ACTION_PROP_GATE_ROOTS: string[] = [];

export interface ActionPropFinding {
  file: string;
  line: number;
  prop: string;
  kind: 'optional-prop' | 'noop-default';
}

const ACTION = /^on[A-Z]\w*$/;
const CALLBACK_TYPE_NAME = /^Function$|(Handler|Callback|Listener)$/;

function isCallbackType(type: ts.TypeNode | undefined): boolean {
  if (!type) return false;
  if (ts.isFunctionTypeNode(type)) return true;
  if (ts.isParenthesizedTypeNode(type)) return isCallbackType(type.type);
  if (ts.isUnionTypeNode(type)) return type.types.some(isCallbackType);
  if (ts.isIndexedAccessTypeNode(type)) {
    const index = type.indexType;
    return ts.isLiteralTypeNode(index) && ts.isStringLiteral(index.literal) && ACTION.test(index.literal.text);
  }
  if (ts.isTypeReferenceNode(type)) {
    const name = ts.isIdentifier(type.typeName) ? type.typeName.text : type.typeName.right.text;
    return CALLBACK_TYPE_NAME.test(name);
  }
  return false;
}

/** A required prop typed `X | undefined` with a callback X: optional in all but name. */
function admitsUndefinedCallback(type: ts.TypeNode | undefined): boolean {
  let t = type;
  while (t && ts.isParenthesizedTypeNode(t)) t = t.type;
  return !!t && ts.isUnionTypeNode(t) && t.types.some((m) => m.kind === ts.SyntaxKind.UndefinedKeyword) && t.types.some(isCallbackType);
}

function isNoop(init: ts.Expression): boolean {
  let e = init;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
    const body = e.body;
    if (ts.isBlock(body)) return body.statements.length === 0;
    let b: ts.Expression = body;
    while (ts.isParenthesizedExpression(b)) b = b.expression;
    return (ts.isIdentifier(b) && b.text === 'undefined') || ts.isVoidExpression(b) || b.kind === ts.SyntaxKind.NullKeyword;
  }
  if (ts.isIdentifier(e)) return /^noop$/i.test(e.text);
  if (ts.isPropertyAccessExpression(e)) {
    if (ts.isIdentifier(e.expression) && e.expression.text === 'Function' && e.name.text === 'prototype') return true;
    return /^noop$/i.test(e.name.text);
  }
  return false;
}

const nameText = (n: ts.PropertyName | ts.BindingName | undefined): string | undefined =>
  n && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : undefined;

export function scanActionProps(source: string, fileName: string): ActionPropFinding[] {
  const sf = parseSource(source, fileName);
  const out: ActionPropFinding[] = [];
  const add = (node: ts.Node, prop: string, kind: ActionPropFinding['kind']) =>
    out.push({ file: fileName, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, prop, kind });
  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node) || ts.isMethodSignature(node)) {
      const prop = nameText(node.name);
      const optional = !!node.questionToken && (ts.isMethodSignature(node) || isCallbackType(node.type));
      const requiredButUndefined = !node.questionToken && ts.isPropertySignature(node) && admitsUndefinedCallback(node.type);
      if (prop && ACTION.test(prop) && (optional || requiredButUndefined)) add(node, prop, 'optional-prop');
    } else if (ts.isBindingElement(node) && node.initializer && ts.isObjectBindingPattern(node.parent)) {
      const prop = nameText(node.propertyName) ?? nameText(node.name);
      if (prop && ACTION.test(prop) && isNoop(node.initializer)) add(node, prop, 'noop-default');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
