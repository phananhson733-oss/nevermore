/* @input  — the expressions a class sink reads (a class-like JSX attribute, a
 *           JSX spread, classList.* / setAttribute("class", …) arguments), a
 *           TypeScript checker over the walked files, and a test for which
 *           imports are the class joiners
 * @output — the strings those expressions can produce, the imports they read,
 *           and every place the value leaves static sight: a literal glued onto
 *           something else, a parameter, a call, a member of an object it cannot
 *           see, a computed key, a name written after its declaration. Fail
 *           closed: a shape it does not model is reported, never read as empty
 * @pos    — test support for app/tailwind-source-extract.ts only; the static
 *           lookups it leans on live in tailwind-source-bindings.ts
 * 一旦本文件被更新，务必更新开头注释
 */
import ts from "typescript";
import {
  ASSIGNMENTS, assignmentsTo, computedKeyPrefix, declarationsOf, importBinding, isCssImport, isInert, isMutated,
  isNextFontVariable, isPropsObject, localFunction, objectLiterals, parameterDefaults,
  returnedExpressions, staticKey, staticText, unwrap, writeIndex, type ImportRead, type Scope,
} from "./tailwind-source-bindings.ts";

export const CLASS_NAME = /^(?:class|className|[A-Za-z]+ClassName)$/u;

const K = ts.SyntaxKind;

// Operators whose result is a boolean or a number, never a class list.
const NON_STRING: ReadonlySet<ts.SyntaxKind> = new Set([
  K.EqualsEqualsToken, K.EqualsEqualsEqualsToken, K.ExclamationEqualsToken,
  K.ExclamationEqualsEqualsToken, K.LessThanToken, K.GreaterThanToken,
  K.LessThanEqualsToken, K.GreaterThanEqualsToken, K.InstanceOfKeyword, K.InKeyword,
  K.MinusToken, K.AsteriskToken, K.SlashToken, K.PercentToken, K.AsteriskAsteriskToken,
  K.AmpersandToken, K.BarToken, K.CaretToken, K.LessThanLessThanToken,
  K.GreaterThanGreaterThanToken, K.GreaterThanGreaterThanGreaterThanToken,
]);

/** Whether an import (specifier, name in its module) is a class joiner whose arguments are the classes. */
export type CombinatorCheck = (specifier: string, importedName: string) => boolean;

export interface Sink {
  readonly kind: "value" | "spread";
  readonly node: ts.Expression;
}

export interface ValueReading {
  readonly strings: readonly string[];
  readonly imports: readonly ImportRead[];
  readonly glued: readonly string[];
  readonly opaque: readonly string[];
}

export interface ValueReader {
  readonly read: (sinks: readonly Sink[]) => ValueReading;
  readonly staticText: (node: ts.Expression) => string | null;
}

interface Ctx extends Scope {
  readonly isCombinator: CombinatorCheck;
  readonly followed: Set<ts.Node>;
  readonly strings: string[];
  readonly imports: ImportRead[];
  readonly glued: string[];
  readonly opaque: string[];
}

interface Part {
  readonly node: ts.Expression | null;
  readonly text: string | null;
}

function report(ctx: Ctx, node: ts.Node, what: string): void {
  ctx.opaque.push(`${what}: ${node.getText(ctx.source).replace(/\s+/gu, " ").slice(0, 80)}`);
}

function concatParts(ctx: Ctx, node: ts.Expression): readonly Part[] | null {
  const inner = unwrap(node);
  const leaf = (expression: ts.Expression): readonly Part[] =>
    concatParts(ctx, expression) ?? [{ node: expression, text: staticText(ctx, expression) }];
  if (ts.isTemplateExpression(inner)) {
    const spans = inner.templateSpans.flatMap((span) => [
      { node: span.expression, text: staticText(ctx, span.expression) },
      { node: null, text: span.literal.text },
    ]);
    return [{ node: null, text: inner.head.text }, ...spans];
  }
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === K.PlusToken) {
    return [...leaf(inner.left), ...leaf(inner.right)];
  }
  return null;
}

/** A known non-space character meets something with no space in between: a token Tailwind never sees whole. */
function glues(parts: readonly Part[]): boolean {
  const filled = parts.filter((part) => part.text !== "");
  return filled.slice(1).some((right, index) => {
    const left = filled[index];
    if (left === undefined) return false;
    const leftEnd = left.text === null ? null : /\S$/u.test(left.text);
    const rightStart = right.text === null ? null : /^\S/u.test(right.text);
    if (leftEnd === false || rightStart === false) return false;
    return leftEnd === true || rightStart === true;
  });
}

function visitConcat(ctx: Ctx, node: ts.Expression, parts: readonly Part[]): void {
  if (glues(parts)) ctx.glued.push(node.getText(ctx.source));
  for (const part of parts) {
    if (part.node !== null) visitValue(ctx, part.node);
    else if (part.text !== null && part.text !== "") ctx.strings.push(part.text);
  }
}

function visitBinary(ctx: Ctx, node: ts.BinaryExpression): void {
  const operator = node.operatorToken.kind;
  if (operator === K.AmpersandAmpersandToken) return visitValue(ctx, node.right);
  if (operator === K.BarBarToken || operator === K.QuestionQuestionToken) {
    visitValue(ctx, node.left);
    return visitValue(ctx, node.right);
  }
  if (operator === K.CommaToken || ASSIGNMENTS.has(operator)) return visitValue(ctx, node.right);
  if (!NON_STRING.has(operator)) report(ctx, node, "class value from operator");
}

/** clsx-style object: the keys are the classes, the values are conditions. */
function visitClassObject(ctx: Ctx, node: ts.ObjectLiteralExpression): void {
  for (const property of node.properties) {
    const keyed = ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property);
    const key = keyed ? staticKey(property.name) : null;
    if (key !== null) ctx.strings.push(key);
    else report(ctx, property, "class object entry");
  }
}

/** Bound to an import that really is a joiner: a local `cn` is just a function. */
function isCombinatorCall(ctx: Ctx, callee: ts.Expression): boolean {
  if (!ts.isIdentifier(callee)) return false;
  const bindings = declarationsOf(ctx, callee).flatMap((declaration) => {
    const binding = importBinding(declaration);
    return binding === null ? [] : [binding];
  });
  return bindings.length > 0 && bindings.every((b) => ctx.isCombinator(b.specifier, b.importedName));
}

function visitCall(ctx: Ctx, node: ts.CallExpression): void {
  const callee = unwrap(node.expression);
  if (isCombinatorCall(ctx, callee)) {
    for (const argument of node.arguments) {
      visitValue(ctx, ts.isSpreadElement(argument) ? argument.expression : argument);
    }
    return;
  }
  const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
  if (ts.isPropertyAccessExpression(callee) && method === "filter") return visitValue(ctx, callee.expression);
  if (ts.isPropertyAccessExpression(callee) && method === "join") {
    // Only a whitespace separator keeps every element a whole token.
    const [separator, ...extra] = node.arguments;
    const text = separator === undefined || extra.length > 0 ? null : staticText(ctx, separator);
    if (text !== null && /^\s+$/u.test(text)) return visitValue(ctx, callee.expression);
    return report(ctx, node, "class value from join");
  }
  const fn = ts.isIdentifier(callee) ? localFunction(ctx, callee) : null;
  if (fn === null) return report(ctx, node, "class value from call");
  returnedExpressions(fn).forEach((expression) => visitValue(ctx, expression));
}

function visitPropertyValue(ctx: Ctx, property: ts.ObjectLiteralElementLike): void {
  if (ts.isPropertyAssignment(property)) return visitValue(ctx, property.initializer);
  if (ts.isShorthandPropertyAssignment(property)) return visitValue(ctx, property.name);
  report(ctx, property, "class value from object member");
}

function visitProperty(ctx: Ctx, literal: ts.ObjectLiteralExpression, name: string): void {
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = objectLiterals(ctx, property.expression);
      if (spread === null) report(ctx, property, "class value from object spread");
      else spread.forEach((inner) => visitProperty(ctx, inner, name));
      continue;
    }
    const key = staticKey(property.name);
    if (key === null && name.startsWith(computedKeyPrefix(property.name))) report(ctx, property, "class value behind a computed key");
    else if (key === name) visitPropertyValue(ctx, property);
  }
}

function readImport(ctx: Ctx, node: ts.Expression, member: string | null): boolean {
  if (!ts.isIdentifier(node)) return false;
  const bindings = declarationsOf(ctx, node).flatMap((d) => {
    const binding = importBinding(d);
    return binding === null ? [] : [binding];
  });
  for (const binding of bindings) {
    const throughNamespace = binding.importedName === "*" && member !== null;
    ctx.imports.push({
      name: member === null ? node.text : `${node.text}.${member}`,
      specifier: binding.specifier,
      importedName: throughNamespace ? member : binding.importedName,
    });
  }
  return bindings.length > 0;
}

/** A props object read here: its callers are checked, but not its defaults or a rewrite of it. */
function visitProps(ctx: Ctx, props: ts.Identifier, read: (literal: ts.ObjectLiteralExpression) => void): void {
  if (assignmentsTo(ctx, props).length > 0 || isMutated(ctx, props)) {
    return report(ctx, props, "class value from rewritten props");
  }
  for (const fallback of parameterDefaults(ctx, props)) {
    const literals = objectLiterals(ctx, fallback);
    if (literals === null) report(ctx, fallback, "class value from props default");
    else literals.forEach(read);
  }
}

function visitMember(ctx: Ctx, node: ts.PropertyAccessExpression): void {
  const object = unwrap(node.expression);
  const property = node.name.text;
  if (isCssImport(ctx, object) || isNextFontVariable(ctx, object, property)) return;
  if (readImport(ctx, object, property)) return;
  const literals = objectLiterals(ctx, object);
  if (literals !== null) return literals.forEach((literal) => visitProperty(ctx, literal, property));
  if (CLASS_NAME.test(property) && isPropsObject(ctx, object)) {
    return visitProps(ctx, object, (literal) => visitProperty(ctx, literal, property));
  }
  report(ctx, node, "class value from member");
}

function visitElement(ctx: Ctx, node: ts.ElementAccessExpression): void {
  const object = unwrap(node.expression);
  if (isCssImport(ctx, object)) return;
  const key = staticText(ctx, node.argumentExpression);
  if (readImport(ctx, object, key)) return;
  const literals = objectLiterals(ctx, object);
  if (literals === null) return report(ctx, node, "class value from element");
  if (key !== null) return literals.forEach((literal) => visitProperty(ctx, literal, key));
  literals.forEach((literal) => literal.properties.forEach((property) => {
    if (ts.isSpreadAssignment(property)) report(ctx, property, "class value from object spread");
    else visitPropertyValue(ctx, property);
  }));
}

function visitParameterDefault(ctx: Ctx, parameter: ts.ParameterDeclaration, key: string): void {
  const fallback = parameter.initializer;
  if (fallback === undefined) return;
  const literals = objectLiterals(ctx, fallback);
  if (literals === null) return report(ctx, fallback, "class value from parameter default");
  literals.forEach((literal) => visitProperty(ctx, literal, key));
}

function visitBinding(ctx: Ctx, element: ts.BindingElement): void {
  const key = element.propertyName !== undefined ? staticKey(element.propertyName)
    : ts.isIdentifier(element.name) ? element.name.text : null;
  const pattern = element.parent;
  const root = pattern.parent;
  if (ts.isParameter(root)) {
    if (element.dotDotDotToken === undefined && (key === null || !CLASS_NAME.test(key))) {
      return report(ctx, element, "class value from destructured parameter");
    }
    // A class-named prop is checked where the props are written; its defaults are written here.
    const fallback = element.initializer;
    if (fallback !== undefined) visitValue(ctx, fallback);
    if (element.dotDotDotToken === undefined && key !== null) visitParameterDefault(ctx, root, key);
    return;
  }
  const literals = ts.isVariableDeclaration(root) && root.initializer !== undefined && ts.isObjectBindingPattern(pattern)
    ? objectLiterals(ctx, root.initializer) : null;
  if (literals === null || key === null) return report(ctx, element, "class value from destructuring");
  if (element.initializer !== undefined) visitValue(ctx, element.initializer);
  literals.forEach((literal) => visitProperty(ctx, literal, key));
}

function visitIdentifier(ctx: Ctx, node: ts.Identifier): void {
  const declarations = declarationsOf(ctx, node);
  if (declarations.length === 0) return report(ctx, node, "class value from an undeclared name");
  if (isMutated(ctx, node)) report(ctx, node, "class value written through a member or destructuring");
  const assigned = assignmentsTo(ctx, node);
  for (const declaration of declarations) {
    const binding = importBinding(declaration);
    if (binding !== null) {
      if (!binding.specifier.endsWith(".css")) ctx.imports.push({ name: node.text, ...binding });
    } else if (ts.isVariableDeclaration(declaration)) {
      if (declaration.initializer === undefined && assigned.length === 0) report(ctx, declaration, "class value never assigned");
      if (declaration.initializer !== undefined) visitValue(ctx, declaration.initializer);
    } else if (ts.isBindingElement(declaration)) {
      visitBinding(ctx, declaration);
    } else if (ts.isParameter(declaration) && CLASS_NAME.test(node.text)) {
      const fallback = declaration.initializer;
      if (fallback !== undefined) visitValue(ctx, fallback);
    } else {
      report(ctx, declaration, ts.isParameter(declaration) ? "class value from parameter" : "class value from declaration");
    }
  }
  assigned.forEach((value) => visitValue(ctx, value));
}

function visitValue(ctx: Ctx, node: ts.Expression): void {
  const inner = unwrap(node);
  if (ctx.followed.has(inner)) return;
  ctx.followed.add(inner);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) return void ctx.strings.push(inner.text);
  if (isInert(inner)) return;
  const parts = concatParts(ctx, inner);
  if (parts !== null) return visitConcat(ctx, inner, parts);
  if (ts.isBinaryExpression(inner)) return visitBinary(ctx, inner);
  if (ts.isConditionalExpression(inner)) {
    visitValue(ctx, inner.whenTrue);
    return visitValue(ctx, inner.whenFalse);
  }
  if (ts.isArrayLiteralExpression(inner)) {
    return inner.elements.forEach((e) => visitValue(ctx, ts.isSpreadElement(e) ? e.expression : e));
  }
  if (ts.isObjectLiteralExpression(inner)) return visitClassObject(ctx, inner);
  if (ts.isCallExpression(inner)) return visitCall(ctx, inner);
  if (ts.isPropertyAccessExpression(inner)) return visitMember(ctx, inner);
  if (ts.isElementAccessExpression(inner)) return visitElement(ctx, inner);
  if (ts.isIdentifier(inner)) return visitIdentifier(ctx, inner);
  report(ctx, inner, "class value of an unmodelled shape");
}

/** Class-named keys of a spread object literal become classes. */
function visitSpreadLiteral(ctx: Ctx, literal: ts.ObjectLiteralExpression): void {
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      visitSpread(ctx, property.expression);
      continue;
    }
    const key = staticKey(property.name);
    // Class-named keys are letters only: a computed key starting `data-` can never be one.
    if (key === null && /^[A-Za-z]*$/u.test(computedKeyPrefix(property.name))) report(ctx, property, "class value behind a computed key");
    else if (key !== null && CLASS_NAME.test(key)) visitPropertyValue(ctx, property);
  }
}

function visitSpread(ctx: Ctx, node: ts.Expression): void {
  const inner = unwrap(node);
  if (isPropsObject(ctx, inner)) return visitProps(ctx, inner, (literal) => visitSpreadLiteral(ctx, literal));
  const literals = objectLiterals(ctx, inner);
  if (literals === null) return report(ctx, inner, "class value from JSX spread");
  literals.forEach((literal) => visitSpreadLiteral(ctx, literal));
}

export function valueReader(source: ts.SourceFile, checker: ts.TypeChecker, isCombinator: CombinatorCheck): ValueReader {
  const writes = writeIndex(source, checker);
  const fresh = (): Ctx => ({
    ...writes, source, checker, isCombinator, followed: new Set(), strings: [], imports: [], glued: [], opaque: [],
  });
  return {
    read: (sinks) => {
      const ctx = fresh();
      sinks.forEach((sink) => (sink.kind === "spread" ? visitSpread(ctx, sink.node) : visitValue(ctx, sink.node)));
      return { strings: [...ctx.strings], imports: [...ctx.imports], glued: [...ctx.glued], opaque: [...ctx.opaque] };
    },
    staticText: (node) => staticText(fresh(), node),
  };
}
