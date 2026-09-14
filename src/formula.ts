type Token = { kind: "number"; value: number } | { kind: "name"; value: string } | { kind: "symbol"; value: string };

export function evaluateCabbageFormula(expression: string, chickenCount: number, cabbageInInventory: number): number {
  try {
    const parser = new FormulaParser(tokenize(expression), { chickenCount, cabbageInInventory });
    return parser.parse();
  } catch {
    throw new Error("Invalid cabbagePlantGapFormula: use only numbers, chickenCount, cabbageInInventory, parentheses and + - * /.");
  }
}

class FormulaParser {
  private index = 0;

  constructor(private readonly tokens: Token[], private readonly variables: Record<string, number>) {}

  parse(): number {
    const value = this.sum();
    if (this.index !== this.tokens.length || !Number.isFinite(value)) throw new Error();
    return value;
  }

  private sum(): number {
    let value = this.product();
    while (this.symbol("+") || this.symbol("-")) {
      const operator = this.tokens[this.index]?.value;
      this.index += 1;
      const right = this.product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  private product(): number {
    let value = this.primary();
    while (this.symbol("*") || this.symbol("/")) {
      const operator = this.tokens[this.index]?.value;
      this.index += 1;
      const right = this.primary();
      if (operator === "/" && right === 0) throw new Error();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  private primary(): number {
    const token = this.tokens[this.index];
    if (!token) throw new Error();
    if (token.kind === "symbol" && (token.value === "+" || token.value === "-")) {
      this.index += 1;
      const value = this.primary();
      return token.value === "-" ? -value : value;
    }
    if (token.kind === "number") {
      this.index += 1;
      return token.value;
    }
    if (token.kind === "name" && Object.hasOwn(this.variables, token.value)) {
      this.index += 1;
      return this.variables[token.value] as number;
    }
    if (this.symbol("(")) {
      this.index += 1;
      const value = this.sum();
      if (!this.symbol(")")) throw new Error();
      this.index += 1;
      return value;
    }
    throw new Error();
  }

  private symbol(value: string): boolean {
    return this.tokens[this.index]?.kind === "symbol" && this.tokens[this.index]?.value === value;
  }
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let rest = expression;
  while (rest.length > 0) {
    const whitespace = rest.match(/^\s+/u);
    if (whitespace) { rest = rest.slice(whitespace[0].length); continue; }
    const number = rest.match(/^(?:\d+(?:\.\d+)?|\.\d+)/u);
    if (number) { tokens.push({ kind: "number", value: Number(number[0]) }); rest = rest.slice(number[0].length); continue; }
    const name = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/u);
    if (name) { tokens.push({ kind: "name", value: name[0] }); rest = rest.slice(name[0].length); continue; }
    if (/^[()+\-*/]/u.test(rest)) { tokens.push({ kind: "symbol", value: rest[0] as string }); rest = rest.slice(1); continue; }
    throw new Error();
  }
  if (tokens.length === 0) throw new Error();
  return tokens;
}
