import test from "node:test";
import assert from "node:assert/strict";
import { manualRowId } from "../src/api.ts";

test("manual row creation works without secure-context crypto.randomUUID", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const getRandomValues = globalThis.crypto.getRandomValues.bind(
    globalThis.crypto,
  );
  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues },
    });
    const first = manualRowId(),
      second = manualRowId();
    assert.match(first, /^manual-[a-f0-9]{16}$/);
    assert.notEqual(first, second);
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor);
  }
});
