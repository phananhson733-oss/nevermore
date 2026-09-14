/* @input  — an expression inside a class sink, and the TypeScript checker that
 *           bound its file
 * @output — the static facts the class value reader leans on: what a name is
 *           declared as, what writes it, the text a constant spells, the object
 *           literals a value can be, whether a name is a props object (and the
 *           defaults it falls back to), a CSS Module or a next/font result
 * @pos    — test support for app/tailwind-source-values.ts and
 *           app/tailwind-source-exports.ts only
 * 一旦本文件被更新，务必更新开头注释
 */
import ts from "typescript";

export interface Writes {
  /** Every `x = …` / `x ||= …` right-hand side in the file, by the symbol assigned. */
  readonly assignments: ReadonlyMap<ts.Symbol, readonly ts.Expression[]>;
  /**
   * Names written some other way: through a member (`x.a = …`, `delete x.a`,
   * `Object.assign(x, …)`) or as a destructuring assignment target. Their
   * declaration no longer tells their value.
   */
  readonly mutated: ReadonlySet<ts.Symbol>;
}

export interface Scope extends Writes {
  readonly source: ts.SourceFile;
  readonly checker: ts.TypeChecker;
}

const K = ts.SyntaxKind;
const MAX_DEPTH = 6;
const NEXT_FONT = /^next\/font\/(?:google|local)$/u;

export const ASSIGNMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  K.EqualsToken, K.PlusEqualsToken, K.BarBarEqualsToken,
  K.QuestionQuestionEqualsToken, K.AmpersandAmpersandEqualsToken,
]);

export interface ImportRead {
  readonly name: string;
  readonly specifier: string;
  /** The name in the imported module: "default" and "*" for default / namespace imports. */
  readonly importedName: string;
}

export function unwrap(node: ts.Expression): ts.Expression {
  const wrapped =
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node);
  return wrapped ? unwrap(node.expression) : node;
}

export function isInert(node: ts.Expression): boolean {
  const keyword = node.kind === K.TrueKeyword || node.kind === K.FalseKeyword || node.kind === K.NullKeyword;
  const nothing = ts.isIdentifier(node) && node.text === "undefined";
  return keyword || nothing || ts.isNumericLiteral(node) || ts.isPrefixUnaryExpression(node) ||
    ts.isTypeOfExpression(node) || ts.isVoidExpression(node);
}

/** A property name known without running anything: `tone`, `"tone"`, `["tone"]`. */
export function staticKey(name: ts.PropertyName): string | null {
  if (ts.isComputedPropertyName(name)) {
    const key = unwrap(name.expression);
    const literal = ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key) || ts.isNumericLiteral(key);
    return literal ? key.text : null;
  }
  const plain = ts.isIdentifier(name) || ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name) || ts.isNumericLiteral(name);
  return plain ? name.text : null;
}

/** The static start of a computed key: `data-` in [`data-${id}`]; "" when there is none. */
export function computedKeyPrefix(name: ts.PropertyName): string {
  if (!ts.isComputedPropertyName(name)) return "";
  const key = unwrap(name.expression);
  return ts.isTemplateExpression(key) ? key.head.text : "";
}

export function symbolOf(ctx: Scope, node: ts.Identifier): ts.Symbol | undefined {
  const parent = node.parent;
  return ts.isShorthandPropertyAssignment(parent) && parent.name === node
    ? ctx.checker.getShorthandAssignmentValueSymbol(parent)
    : ctx.checker.getSymbolAtLocation(node);
}

export function declarationsOf(ctx: Scope, node: ts.Identifier): readonly ts.Declaration[] {
  return symbolOf(ctx, node)?.declarations ?? [];
}

export function assignmentsTo(ctx: Scope, node: ts.Identifier): readonly ts.Expression[] {
  const symbol = symbolOf(ctx, node);
  return symbol === undefined ? [] : (ctx.assignments.get(symbol) ?? []);
}

export function isMutated(ctx: Scope, node: ts.Identifier): boolean {
  const symbol = symbolOf(ctx, node);
  return symbol !== undefined && ctx.mutated.has(symbol);
}

function importDeclarationOf(node: ts.Node): ts.ImportDeclaration | undefined {
  if (ts.isImportDeclaration(node)) return node;
  return ts.isSourceFile(node) ? undefined : importDeclarationOf(node.parent);
}

export function importBinding(declaration: ts.Node): Omit<ImportRead, "name"> | null {
  const importedName = ts.isImportSpecifier(declaration)
    ? (declaration.propertyName ?? declaration.name).text
    : ts.isImportClause(declaration) ? "default"
    : ts.isNamespaceImport(declaration) ? "*" : null;
  const statement = importedName === null ? undefined : importDeclarationOf(declaration);
  const specifier = statement !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text : null;
  return importedName === null || specifier === null ? null : { specifier, importedName };
}

export function isCssImport(ctx: Scope, node: ts.Expression): boolean {
  if (!ts.isIdentifier(node)) return false;
  return declarationsOf(ctx, node).some((d) => importBinding(d)?.specifier.endsWith(".css") === true);
}

/** A `const` initializer nothing writes over. */
export function constInitializer(ctx: Scope, node: ts.Identifier): ts.Expression | null {
  const symbol = ctx.checker.getSymbolAtLocation(node);
  const [declaration, ...others] = symbol?.declarations ?? [];
  if (symbol === undefined || declaration === undefined || others.length > 0) return null;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) return null;
  const isConst = (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0;
  const written = (ctx.assignments.get(symbol)?.length ?? 0) > 0 || ctx.mutated.has(symbol);
  return isConst && !written ? declaration.initializer : null;
}

/** Adds as a number, not as text: `1 + 1` is 2, not "11". */
function isNumeric(ctx: Scope, node: ts.Expression, depth = 0): boolean {
  const inner = unwrap(node);
  if (ts.isNumericLiteral(inner) || ts.isPrefixUnaryExpression(inner)) return true;
  if (depth >= MAX_DEPTH) return false;
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === K.PlusToken) {
    return isNumeric(ctx, inner.left, depth + 1) && isNumeric(ctx, inner.right, depth + 1);
  }
  const constant = ts.isIdentifier(inner) ? constInitializer(ctx, inner) : null;
  return constant !== null && isNumeric(ctx, constant, depth + 1);
}

export function staticText(ctx: Scope, node: ts.Expression, depth = 0): string | null {
  const inner = unwrap(node);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isNumericLiteral(inner)) {
    return inner.text;
  }
  if (depth >= MAX_DEPTH) return null;
  if (ts.isTemplateExpression(inner)) {
    const spans = inner.templateSpans.map((span) => staticText(ctx, span.expression, depth + 1));
    if (spans.some((text) => text === null)) return null;
    return inner.templateSpans.reduce(
      (text, span, index) => text + (spans[index] ?? "") + span.literal.text,
      inner.head.text,
    );
  }
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === K.PlusToken) {
    if (isNumeric(ctx, inner.left) && isNumeric(ctx, inner.right)) return null;
    const left = staticText(ctx, inner.left, depth + 1);
    const right = staticText(ctx, inner.right, depth + 1);
    return left === null || right === null ? null : left + right;
  }
  const constant = ts.isIdentifier(inner) ? constInitializer(ctx, inner) : null;
  return constant === null ? null : staticText(ctx, constant, depth + 1);
}

export function returnedExpressions(fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression): readonly ts.Expression[] {
  const body = fn.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [body];
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) found.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/** The same-file implementation a name calls: an overload signature has no body and is skipped. */
export function localFunction(ctx: Scope, node: ts.Identifier): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null {
  for (const declaration of declarationsOf(ctx, node)) {
    if (declaration.getSourceFile() !== ctx.source) continue;
    if (ts.isFunctionDeclaration(declaration)) {
      if (declaration.body !== undefined) return declaration;
      continue;
    }
    const named = ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name) ? declaration.name : null;
    const initializer = named === null ? null : constInitializer(ctx, named);
    const fn = initializer === null ? undefined : unwrap(initializer);
    if (fn !== undefined && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return fn;
  }
  return null;
}

/** Object literals a value can be: directly, through a const, or either arm of a conditional. */
export function objectLiterals(ctx: Scope, node: ts.Expression, depth = 0): readonly ts.ObjectLiteralExpression[] | null {
  const inner = unwrap(node);
  if (ts.isObjectLiteralExpression(inner)) return [inner];
  if (isInert(inner)) return [];
  if (depth >= MAX_DEPTH) return null;
  if (ts.isConditionalExpression(inner)) {
    const whenTrue = objectLiterals(ctx, inner.whenTrue, depth + 1);
    const whenFalse = objectLiterals(ctx, inner.whenFalse, depth + 1);
    return whenTrue === null || whenFalse === null ? null : [...whenTrue, ...whenFalse];
  }
  const constant = ts.isIdentifier(inner) ? constInitializer(ctx, inner) : null;
  return constant === null ? null : objectLiterals(ctx, constant, depth + 1);
}

function bindingRoot(node: ts.Node): ts.VariableDeclaration | ts.ParameterDeclaration | undefined {
  if (ts.isBindingElement(node)) return bindingRoot(node.parent.parent);
  return ts.isVariableDeclaration(node) || ts.isParameter(node) ? node : undefined;
}

/** A props object or props rest: its class-named keys are checked where the props are written. */
export function isPropsObject(ctx: Scope, node: ts.Expression): node is ts.Identifier {
  if (!ts.isIdentifier(node)) return false;
  return declarationsOf(ctx, node).some((declaration) => {
    if (ts.isParameter(declaration)) return true;
    if (!ts.isBindingElement(declaration) || declaration.dotDotDotToken === undefined) return false;
    const root = bindingRoot(declaration.parent.parent);
    if (root !== undefined && ts.isParameter(root)) return true;
    const from = root?.initializer === undefined ? undefined : unwrap(root.initializer);
    return from !== undefined && isPropsObject(ctx, from);
  });
}

/** What a props parameter falls back to when no caller writes it: `(props = {…})`, `({ ...rest } = {…})`. */
export function parameterDefaults(ctx: Scope, node: ts.Identifier, depth = 0): readonly ts.Expression[] {
  return declarationsOf(ctx, node).flatMap((declaration) => {
    const root = ts.isParameter(declaration) ? declaration
      : ts.isBindingElement(declaration) ? bindingRoot(declaration.parent.parent) : undefined;
    if (root !== undefined && ts.isParameter(root)) return root.initializer === undefined ? [] : [root.initializer];
    // A props rest taken from a local, `const { ...rest } = props`, falls back to what props does.
    const from = root?.initializer === undefined ? undefined : unwrap(root.initializer);
    return from !== undefined && ts.isIdentifier(from) && depth < MAX_DEPTH ? parameterDefaults(ctx, from, depth + 1) : [];
  });
}

export function isNextFontVariable(ctx: Scope, object: ts.Expression, property: string): boolean {
  if (property !== "variable" || !ts.isIdentifier(object)) return false;
  const initializer = constInitializer(ctx, object);
  const call = initializer === null ? undefined : unwrap(initializer);
  const callee = call !== undefined && ts.isCallExpression(call) ? unwrap(call.expression) : undefined;
  if (callee === undefined || !ts.isIdentifier(callee)) return false;
  return declarationsOf(ctx, callee).some((d) => NEXT_FONT.test(importBinding(d)?.specifier ?? ""));
}

function baseIdentifier(node: ts.Expression): ts.Identifier | undefined {
  const inner = unwrap(node);
  if (ts.isIdentifier(inner)) return inner;
  const member = ts.isPropertyAccessExpression(inner) || ts.isElementAccessExpression(inner);
  return member ? baseIdentifier(inner.expression) : undefined;
}

function destructuredTargets(node: ts.Expression): readonly ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) found.push(child);
    else if (ts.isPropertyAssignment(child)) visit(child.initializer);
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function objectAssignTarget(node: ts.CallExpression): ts.Expression | undefined {
  const callee = unwrap(node.expression);
  const isAssign = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Object" && callee.name.text === "assign";
  return isAssign ? node.arguments[0] : undefined;
}

function mutatedBy(node: ts.Node): readonly ts.Identifier[] {
  if (ts.isBinaryExpression(node) && ASSIGNMENTS.has(node.operatorToken.kind)) {
    const target = unwrap(node.left);
    if (ts.isObjectLiteralExpression(target) || ts.isArrayLiteralExpression(target)) return destructuredTargets(target);
    const base = ts.isIdentifier(target) ? undefined : baseIdentifier(target);
    return base === undefined ? [] : [base];
  }
  const written = ts.isDeleteExpression(node) ? node.expression
    : ts.isCallExpression(node) ? objectAssignTarget(node) : undefined;
  const base = written === undefined ? undefined : baseIdentifier(written);
  return base === undefined ? [] : [base];
}

export function writeIndex(source: ts.SourceFile, checker: ts.TypeChecker): Writes {
  const assignments = new Map<ts.Symbol, readonly ts.Expression[]>();
  const mutated = new Set<ts.Symbol>();
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && ASSIGNMENTS.has(node.operatorToken.kind) && ts.isIdentifier(unwrap(node.left))) {
      const symbol = checker.getSymbolAtLocation(unwrap(node.left));
      if (symbol !== undefined) assignments.set(symbol, [...(assignments.get(symbol) ?? []), node.right]);
    }
    for (const identifier of mutatedBy(node)) {
      // `({ tone } = …)` writes the variable tone, not the shorthand property's own symbol.
      const parent = identifier.parent;
      const symbol = ts.isShorthandPropertyAssignment(parent) && parent.name === identifier
        ? checker.getShorthandAssignmentValueSymbol(parent)
        : checker.getSymbolAtLocation(identifier);
      if (symbol !== undefined) mutated.add(symbol);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { assignments, mutated };
}
