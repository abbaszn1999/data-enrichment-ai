import { describe, expect, it } from "vitest";
import {
  SIGNED_IN_PRESENCE_COOKIE,
  SIGNED_IN_PRESENCE_MAX_AGE,
  signedInPresenceCookieOptions,
  signedInPresenceDomain,
} from "./signed-in-presence";

describe("signedInPresenceDomain", () => {
  it("uses the parent Autommerce domain on the platform host", () => {
    expect(signedInPresenceDomain("platform.autommerce.com")).toBe(".autommerce.com");
    expect(signedInPresenceDomain("autommerce.com")).toBe(".autommerce.com");
  });

  it("does not set a parent domain on localhost or other hosts", () => {
    expect(signedInPresenceDomain("localhost")).toBeUndefined();
    expect(signedInPresenceDomain("127.0.0.1")).toBeUndefined();
    expect(signedInPresenceDomain("data-enrichment-ai.onrender.com")).toBeUndefined();
  });
});

describe("signedInPresenceCookieOptions", () => {
  it("sets a readable presence flag, not an HttpOnly session", () => {
    const options = signedInPresenceCookieOptions({
      hostname: "platform.autommerce.com",
      secure: true,
      signedIn: true,
    });
    expect(SIGNED_IN_PRESENCE_COOKIE).toBe("autommerce_signed_in");
    expect(options).toMatchObject({
      path: "/",
      domain: ".autommerce.com",
      secure: true,
      sameSite: "lax",
      httpOnly: false,
      maxAge: SIGNED_IN_PRESENCE_MAX_AGE,
    });
  });

  it("clears with Max-Age 0 on the same domain attributes", () => {
    const options = signedInPresenceCookieOptions({
      hostname: "platform.autommerce.com",
      secure: true,
      signedIn: false,
    });
    expect(options.maxAge).toBe(0);
    expect(options.domain).toBe(".autommerce.com");
    expect(options.httpOnly).toBe(false);
  });
});
