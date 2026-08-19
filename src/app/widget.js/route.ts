import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "public", "widget.js");
    const script = fs.readFileSync(filePath, "utf-8");

    return new NextResponse(script, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (error) {
    return new NextResponse("// widget.js not found", {
      status: 404,
      headers: { "Content-Type": "application/javascript" },
    });
  }
}
