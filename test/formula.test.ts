import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCabbageFormula } from "../src/formula.js";

test("evaluates the default and user-defined cabbage formulas", () => {
  assert.equal(evaluateCabbageFormula("chickenCount * 2 - cabbageInInventory", 3, 4), 2);
  assert.equal(evaluateCabbageFormula("(chickenCount + 1) * 3 - cabbageInInventory / 2", 2, 4), 7);
});

test("rejects code, unknown variables and invalid arithmetic", () => {
  for (const expression of ["process.exit()", "Math.max(chickenCount, 1)", "unknown + 1", "chickenCount / 0"]) {
    assert.throws(() => evaluateCabbageFormula(expression, 1, 1), /Invalid cabbagePlantGapFormula/u);
  }
});
