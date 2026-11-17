/// <reference types="node" />
// QA-115, required-props half (Stage 0 Q2). An action callback (`on[A-Z]*`) is a required prop with no
// no-op default. This scanner reads the syntax tree and flags:
//   · optional-prop: an optional `on[A-Z]*` property or method signature whose type is a function, a union
//     holding one, or a reference named like a callback (…Handler, …Callback, …Listener);
//   · noop-default: an `on[A-Z]*` binding destructured with a default that does nothing: `() => {}`,
//     `function () {}`, `() => undefined`, or an identifier or member named `noop`.
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
const CALLBACK_TYPE_NAME = /(Handler|Callback|Listener)$/;

function isCallbackType(type: ts.TypeNode | undefined): boolean {
  if (!type) return false;
  if (ts.isFunctionTypeNode(type)) return true;
  if (ts.isParenthesizedTypeNode(type)) return isCallbackType(type.type);
  if (ts.isUnionTypeNode(type)) return type.types.some(isCallbackType);
  if (ts.isTypeReferenceNode(type)) {
    const name = ts.isIdentifier(type.typeName) ? type.typeName.text : type.typeName.right.text;
    return CALLBACK_TYPE_NAME.test(name);
  }
  return false;
}

function isNoop(init: ts.Expression): boolean {
  let e = init;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
    const body = e.body;
    if (ts.isBlock(body)) return body.statements.length === 0;
    let b: ts.Expression = body;
    while (ts.isParenthesizedExpression(b)) b = b.expression;
    return (ts.isIdentifier(b) && b.text === 'undefined') || ts.isVoidExpression(b);
  }
  if (ts.isIdentifier(e)) return /^noop$/i.test(e.text);
  if (ts.isPropertyAccessExpression(e)) return /^noop$/i.test(e.name.text);
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
    if ((ts.isPropertySignature(node) || ts.isMethodSignature(node)) && node.questionToken) {
      const prop = nameText(node.name);
      if (prop && ACTION.test(prop) && (ts.isMethodSignature(node) || isCallbackType(node.type))) add(node, prop, 'optional-prop');
    } else if (ts.isBindingElement(node) && node.initializer && ts.isObjectBindingPattern(node.parent)) {
      const prop = nameText(node.propertyName) ?? nameText(node.name);
      if (prop && ACTION.test(prop) && isNoop(node.initializer)) add(node, prop, 'noop-default');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
