/** 每次执行独立编译 async cell；SDK schema 生成声明先做类型诊断，错误发生在任何 host effect 之前。 */
import ts from "typescript";
import path from "node:path";
import type { CompiledCell } from "../types/CompiledCell.js";

/** 编译源码并保留行号及 source map；标准库仅开放 ECMAScript，不引入 Node/DOM。 */
export function compile_cell(code: string, language: string, declarations: string): CompiledCell {
  const filename = "/downcity-cell.ts";
  const source = `async function __cell() {\n${code}\n}\n__cell();`;
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, strict: true, noImplicitAny: false,
    lib: ["lib.es2022.d.ts"], types: [], sourceMap: true, inlineSources: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const original_get = host.getSourceFile.bind(host);
  const original_exists = host.fileExists.bind(host);
  const original_read = host.readFile.bind(host);
  const library_directory = path.dirname(ts.getDefaultLibFilePath(options));
  const is_library = (name: string): boolean => path.dirname(path.resolve(name)) === library_directory && /^lib\.[a-z0-9.]+\.d\.ts$/u.test(path.basename(name));
  // 编译器的引用解析也是文件访问边界；脚本不能借三斜线或 import type 读取宿主文件。
  host.getSourceFile = (name, version, on_error, should_create) => name === filename ? ts.createSourceFile(name, source, version, true)
    : name === "/downcity-sdk.d.ts" ? ts.createSourceFile(name, declarations, version, true) : is_library(name) ? original_get(name, version, on_error, should_create) : undefined;
  host.fileExists = name => name === filename || name === "/downcity-sdk.d.ts" || is_library(name) && original_exists(name);
  host.readFile = name => name === filename ? source : name === "/downcity-sdk.d.ts" ? declarations : is_library(name) ? original_read(name) : undefined;
  const program = ts.createProgram([filename, "/downcity-sdk.d.ts"], options, host);
  const file = program.getSourceFile(filename)!;
  // import/export 与动态 import 均在进入引擎前拒绝；JS 也走语法检查。
  const forbidden: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportEqualsDeclaration(node)
      || ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) forbidden.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const references = ts.preProcessFile(code);
  if (references.referencedFiles.length || references.typeReferenceDirectives.length || references.libReferenceDirectives.length) throw new Error("compile_error: source reference directives are unavailable");
  if (forbidden.length) throw new Error("compile_error: imports and exports are unavailable in application cells");
  const diagnostics = [...program.getSyntacticDiagnostics(file), ...(language === "typescript" ? program.getSemanticDiagnostics(file) : [])];
  if (diagnostics.length) {
    const diagnostic = diagnostics[0]!;
    const location = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    throw new Error(`compile_error: ${Math.max(1, location.line)}:${location.character + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  let javascript = "";
  let source_map = "";
  program.emit(file, (name, text) => { if (name.endsWith(".js")) javascript = text; else if (name.endsWith(".js.map")) source_map = text; });
  return { javascript, source_map };
}
