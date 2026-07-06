/**
 * Recursive-descent parser for Cyflow mapping expressions (the text inside
 * `{{ ... }}`). Produces an AST — there is NO `eval`; the evaluator only ever
 * looks up whitelisted functions and walks data paths.
 *
 * Grammar (informal):
 *   expr    := call | path | literal
 *   call    := IDENT '(' ( expr (';' expr)* )? ')'
 *   path    := ROOT ( '.' SEG | '[' INDEX ']' )*         ROOT = module id/key
 *   literal := STRING | NUMBER | 'true' | 'false' | 'null'
 *
 * Module paths address a module's output by id/key, e.g. `1.body.email`,
 * `1.headers.content-type` (segments may contain '-'), `2.items[0].name`.
 * Function args are separated by ';' (Make's separator).
 */

export type Node =
  | { type: "literal"; value: unknown }
  | { type: "path"; root: string; segments: string[] }
  | { type: "call"; name: string; args: Node[] };

export function parseExpression(src: string): Node {
  let pos = 0;
  const len = src.length;

  const eof = () => pos >= len;
  const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";
  const skipWs = () => {
    while (!eof() && isWs(src[pos])) pos++;
  };
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isIdentStart = (c: string) =>
    (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  const isIdentChar = (c: string) => isIdentStart(c) || isDigit(c);
  const isSegChar = (c: string) => isIdentChar(c) || c === "-";

  function fail(msg: string): never {
    throw new Error(`Malformed expression "${src.trim()}": ${msg}`);
  }

  function parseStringLiteral(): Node {
    const quote = src[pos];
    pos++;
    let out = "";
    while (!eof()) {
      const c = src[pos];
      if (c === "\\") {
        out += src[pos + 1] ?? "";
        pos += 2;
        continue;
      }
      if (c === quote) {
        pos++;
        return { type: "literal", value: out };
      }
      out += c;
      pos++;
    }
    fail("unterminated string literal");
  }

  function parseWord(pred: (c: string) => boolean): string {
    const start = pos;
    while (!eof() && pred(src[pos])) pos++;
    if (pos === start) fail("expected an identifier");
    return src.slice(start, pos);
  }

  function parsePathAfterRoot(root: string): Node {
    const segments: string[] = [];
    while (!eof()) {
      if (src[pos] === ".") {
        pos++;
        if (eof() || !isSegChar(src[pos])) fail("expected a path segment after '.'");
        segments.push(parseWord(isSegChar));
      } else if (src[pos] === "[") {
        pos++;
        skipWs();
        let seg: string;
        if (src[pos] === '"' || src[pos] === "'") {
          seg = String((parseStringLiteral() as { value: unknown }).value);
        } else {
          const start = pos;
          while (!eof() && isDigit(src[pos])) pos++;
          if (pos === start) fail("expected an index inside '[ ]'");
          seg = src.slice(start, pos);
        }
        skipWs();
        if (src[pos] !== "]") fail("expected ']'");
        pos++;
        segments.push(seg);
      } else {
        break;
      }
    }
    return { type: "path", root, segments };
  }

  function parseCallArgs(): Node[] {
    const args: Node[] = [];
    skipWs();
    if (src[pos] === ")") {
      pos++;
      return args;
    }
    for (;;) {
      args.push(parseExpr());
      skipWs();
      if (src[pos] === ";") {
        pos++;
        continue;
      }
      if (src[pos] === ")") {
        pos++;
        break;
      }
      fail("expected ';' or ')' in function arguments");
    }
    return args;
  }

  function parsePrimary(): Node {
    skipWs();
    if (eof()) fail("unexpected end of expression");
    const c = src[pos];

    if (c === '"' || c === "'") return parseStringLiteral();

    if (c === "-" && isDigit(src[pos + 1])) {
      const start = pos;
      pos++;
      while (!eof() && isDigit(src[pos])) pos++;
      if (src[pos] === "." && isDigit(src[pos + 1])) {
        pos++;
        while (!eof() && isDigit(src[pos])) pos++;
      }
      return { type: "literal", value: Number(src.slice(start, pos)) };
    }

    if (isDigit(c)) {
      // A number literal, OR a module path root (e.g. `1.body`). A '.' followed
      // by a digit is a decimal (1.5); a '.' followed by a letter is a path.
      const start = pos;
      while (!eof() && isDigit(src[pos])) pos++;
      if (src[pos] === "." && isDigit(src[pos + 1])) {
        pos++;
        while (!eof() && isDigit(src[pos])) pos++;
        return { type: "literal", value: Number(src.slice(start, pos)) };
      }
      const root = src.slice(start, pos);
      if (src[pos] === "." || src[pos] === "[") return parsePathAfterRoot(root);
      return { type: "literal", value: Number(root) };
    }

    if (isIdentStart(c)) {
      const word = parseWord(isIdentChar);
      if (word === "true") return { type: "literal", value: true };
      if (word === "false") return { type: "literal", value: false };
      if (word === "null") return { type: "literal", value: null };
      skipWs();
      if (src[pos] === "(") {
        pos++;
        return { type: "call", name: word, args: parseCallArgs() };
      }
      return parsePathAfterRoot(word);
    }

    fail(`unexpected character '${c}'`);
  }

  function parseExpr(): Node {
    skipWs();
    return parsePrimary();
  }

  const result = parseExpr();
  skipWs();
  if (!eof()) fail(`unexpected trailing input '${src.slice(pos)}'`);
  return result;
}
