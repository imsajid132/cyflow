import { describe, expect, it } from "vitest";
import {
  evaluateTemplate,
  resolveParamsTree,
  type MappingScope,
} from "../src/index";

const scope: MappingScope = {
  "1": {
    body: { email: "ADA@b.com", name: "Ada", firstName: "Ada", lastName: "Lovelace" },
    headers: { "content-type": "application/json" },
    createdAt: "2024-01-05T10:20:30Z",
    n: 5,
    flag: true,
    nothing: null,
    items: [{ name: "a" }, { name: "b" }, { name: "c" }],
  },
  "2": { total: 10, count: 4 },
};

const evalT = (s: string) => evaluateTemplate(s, scope);

describe("simple tokens & types", () => {
  it("resolves a simple token to its raw value", () => {
    expect(evalT("{{1.body.email}}")).toBe("ADA@b.com");
  });
  it("preserves numbers, booleans, and null", () => {
    expect(evalT("{{1.n}}")).toBe(5);
    expect(evalT("{{1.flag}}")).toBe(true);
    expect(evalT("{{1.nothing}}")).toBeNull();
  });
  it("returns objects/arrays with type preserved for a whole-token map", () => {
    expect(evalT("{{1.items}}")).toEqual([{ name: "a" }, { name: "b" }, { name: "c" }]);
  });
  it("leaves plain strings (no braces) unchanged", () => {
    expect(evalT("just text")).toBe("just text");
  });
  it("interpolates tokens inside surrounding text", () => {
    expect(evalT("Hi {{1.body.name}}!")).toBe("Hi Ada!");
  });
});

describe("nested paths, hyphens, arrays", () => {
  it("reads a hyphenated header key", () => {
    expect(evalT("{{1.headers.content-type}}")).toBe("application/json");
  });
  it("indexes into arrays by dot and bracket", () => {
    expect(evalT("{{1.items.0.name}}")).toBe("a");
    expect(evalT("{{1.items[2].name}}")).toBe("c");
  });
});

describe("missing values", () => {
  it("resolves a missing path to undefined", () => {
    expect(evalT("{{1.body.nope}}")).toBeUndefined();
    expect(evalT("{{9.anything}}")).toBeUndefined();
  });
  it("renders missing values as empty inside text", () => {
    expect(evalT("x{{1.body.nope}}y")).toBe("xy");
  });
});

describe("functions", () => {
  it("upper / lower / trim", () => {
    expect(evalT("{{upper(1.body.name)}}")).toBe("ADA");
    expect(evalT("{{lower(1.body.email)}}")).toBe("ada@b.com");
    expect(evalT('{{trim("  hi  ")}}')).toBe("hi");
  });
  it("concat joins arguments", () => {
    expect(evalT('{{concat(1.body.firstName; " "; 1.body.lastName)}}')).toBe("Ada Lovelace");
  });
  it("replace swaps all occurrences", () => {
    expect(evalT('{{replace(1.body.email; "b.com"; "example.com")}}')).toBe("ADA@example.com");
  });
  it("get reads a nested path", () => {
    expect(evalT('{{get(1.body; "email")}}')).toBe("ADA@b.com");
  });
  it("map pulls a key from every element", () => {
    expect(evalT('{{map(1.items; "name")}}')).toEqual(["a", "b", "c"]);
  });
  it("formatDate formats in UTC", () => {
    expect(evalT('{{formatDate(1.createdAt; "YYYY-MM-DD")}}')).toBe("2024-01-05");
    expect(evalT('{{formatDate(1.createdAt; "HH:mm:ss")}}')).toBe("10:20:30");
  });
  it("math functions", () => {
    expect(evalT("{{add(2.total; 2.count)}}")).toBe(14);
    expect(evalT("{{subtract(2.total; 2.count)}}")).toBe(6);
    expect(evalT("{{multiply(2.total; 2.count)}}")).toBe(40);
    expect(evalT("{{divide(2.total; 2.count)}}")).toBe(2.5);
  });
  it("default falls back on null/undefined/empty", () => {
    expect(evalT('{{default(1.nothing; "fallback")}}')).toBe("fallback");
    expect(evalT('{{default(1.body.nope; "fallback")}}')).toBe("fallback");
    expect(evalT('{{default(1.body.name; "fallback")}}')).toBe("Ada");
  });
  it("supports nested function calls", () => {
    expect(evalT('{{upper(concat(1.body.firstName; "-"; 1.body.lastName))}}')).toBe("ADA-LOVELACE");
  });
});

describe("failed expressions throw a clear error", () => {
  it("unknown function", () => {
    expect(() => evalT("{{bogus(1.body.email)}}")).toThrow(/Unknown function/);
  });
  it("malformed syntax", () => {
    expect(() => evalT("{{1.}}")).toThrow(/Malformed expression/);
  });
  it("division by zero", () => {
    expect(() => evalT("{{divide(1; 0)}}")).toThrow(/division by zero/);
  });
});

describe("resolveParamsTree", () => {
  it("walks the whole params tree and leaves plain values unchanged", () => {
    const params = {
      url: "https://api.test/users",
      method: "POST",
      headers: { "x-user": "{{1.body.email}}" },
      body: { greeting: "Hi {{1.body.name}}", count: 3, keep: "literal" },
      tags: ["{{upper(1.body.name)}}", "static"],
    };
    const resolved = resolveParamsTree(params, scope);
    expect(resolved).toEqual({
      url: "https://api.test/users",
      method: "POST",
      headers: { "x-user": "ADA@b.com" },
      body: { greeting: "Hi Ada", count: 3, keep: "literal" },
      tags: ["ADA", "static"],
    });
  });
});
