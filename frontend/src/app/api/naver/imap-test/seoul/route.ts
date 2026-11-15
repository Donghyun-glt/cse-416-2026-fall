import type { NextRequest } from "next/server";
import { runImapTest } from "../check";

// POST /api/naver/imap-test/seoul: the same probe, pinned to the Seoul region, to see
// whether Naver treats a Korean server differently from the default (US) one.
export const preferredRegion = "icn1";
export const POST = (request: NextRequest) => runImapTest(request);
