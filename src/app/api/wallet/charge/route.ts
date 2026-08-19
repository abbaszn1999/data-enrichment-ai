import { NextResponse } from "next/server";

/** Charges are created only by Market Research server routes, never by the client. */
export async function POST() {
  return NextResponse.json(
    { error: "Wallet charges cannot be created from this endpoint" },
    { status: 403 }
  );
}
