/* @input  — an expression inside a class sink, and the TypeScript checker that
 *           bound its file
 * @output — the static facts the class value reader leans on: what a name is
 *           declared as, the text a constant spells, the object literals a value
 *           can be, whether a name is a props object, a CSS Module or a
 *           next/font result
 * @pos    — test support for app/tailwind-source-values.ts only
 * 一旦本文件被更新，务必更新开头注释
 */
import ts from "typescript";

export interface Scope {
  readonly source: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  /** Every `x = …` / `x ||= …` right-hand side in the file, by the symbol assigned. */
  readonly assignments: ReadonlyMap<ts.Symbol, readonly ts.Expression[]>;
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

export function staticKey(name: ts.PropertyName): string | null {
  const plain = ts.isIdentifier(name) || ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name) || ts.isNumericLiteral(name);
  return plain ? name.text : null;
}

export function declarationsOf(ctx: Scope, node: ts.Identifier): readonly ts.Declaration[] {
  const parent = node.parent;
  const symbol = ts.isShorthandPropertyAssignment(parent) && parent.name === node
    ? ctx.checker.getShorthandAssignmentValueSymbol(parent)
    : ctx.checker.getSymbolAtLocation(node);
  return symbol?.declarations ?? [];
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

/** A never-reassigned `const` initializer. */
export function constInitializer(ctx: Scope, node: ts.Identifier): ts.Expression | null {
  const symbol = ctx.checker.getSymbolAtLocation(node);
  const [declaration, ...others] = symbol?.declarations ?? [];
  if (declaration === undefined || others.length > 0) return null;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) return null;
  const isConst = (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0;
  const reassigned = symbol !== undefined && (ctx.assignments.get(symbol)?.length ?? 0) > 0;
  return isConst && !reassigned ? declaration.initializer : null;
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

export function localFunction(ctx: Scope, node: ts.Identifier): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null {
  for (const declaration of declarationsOf(ctx, node)) {
    if (declaration.getSourceFile() !== ctx.source) continue;
    if (ts.isFunctionDeclaration(declaration)) return declaration;
    const initializer = ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
      ? unwrap(declaration.initializer) : undefined;
    if (initializer !== undefined && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
      return initializer;
    }
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
export function isPropsObject(ctx: Scope, node: ts.Expression): boolean {
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

export function isNextFontVariable(ctx: Scope, object: ts.Expression, property: string): boolean {
  if (property !== "variable" || !ts.isIdentifier(object)) return false;
  const initializer = constInitializer(ctx, object);
  const call = initializer === null ? undefined : unwrap(initializer);
  const callee = call !== undefined && ts.isCallExpression(call) ? unwrap(call.expression) : undefined;
  if (callee === undefined || !ts.isIdentifier(callee)) return false;
  return declarationsOf(ctx, callee).some((d) => NEXT_FONT.test(importBinding(d)?.specifier ?? ""));
}

export function assignmentIndex(source: ts.SourceFile, checker: ts.TypeChecker): ReadonlyMap<ts.Symbol, readonly ts.Expression[]> {
  const index = new Map<ts.Symbol, readonly ts.Expression[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && ASSIGNMENTS.has(node.operatorToken.kind)) {
      const target = unwrap(node.left);
      const symbol = ts.isIdentifier(target) ? checker.getSymbolAtLocation(target) : undefined;
      if (symbol !== undefined) index.set(symbol, [...(index.get(symbol) ?? []), node.right]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return index;
}
