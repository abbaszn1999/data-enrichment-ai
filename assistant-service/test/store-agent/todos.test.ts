import { describe, expect, it } from "vitest";
import type { TodoItem } from "../../../src/lib/store-agent/protocol";
import { mergeTodos } from "../../src/store-agent/events";

const t = (id: string, content: string, status: TodoItem["status"] = "pending"): TodoItem => ({ id, content, status });

describe("mergeTodos", () => {
  const plan = [t("a", "Backup prices"), t("b", "Apply 15%"), t("c", "Add tags")];

  it("applies a partial update to the list shown so far", () => {
    // The SDK sends only the changed steps, numbered from 0.
    const next = mergeTodos(plan, [t("0", "Backup prices", "completed"), t("1", "Apply 15%", "in_progress")], true);
    expect(next.map((x) => [x.content, x.status])).toEqual([
      ["Backup prices", "completed"],
      ["Apply 15%", "in_progress"],
      ["Add tags", "pending"],
    ]);
  });

  it("treats a short list of known steps as a merge, and a new full list as a replacement", () => {
    expect(mergeTodos(plan, [t("0", "Add tags", "completed")], false)).toHaveLength(3);
    expect(mergeTodos(plan, [t("x", "Something else")], false)).toEqual([t("x", "Something else")]);
  });
});
