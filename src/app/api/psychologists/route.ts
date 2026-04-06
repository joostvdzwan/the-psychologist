import { getPsychologistsMeta } from "@/lib/psychologists";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ psychologists: getPsychologistsMeta() });
}
