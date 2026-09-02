import { describe, expect, it } from "vitest";
import { jsonRowToRecord } from "./store";

describe("worksheet row store", () => {
  it("stores the full row payload under data", () => {
    const row = {
      id: "r1",
      rowIndex: 2,
      status: "ready",
      mainImagePath: "a.png",
    };
    const record = jsonRowToRecord("sess", row);
    expect(record.session_id).toBe("sess");
    expect(record.row_id).toBe("r1");
    expect(record.row_index).toBe(2);
    expect(record.status).toBe("ready");
    expect(record.data).toEqual(row);
  });
});
