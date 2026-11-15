import type { NextRequest } from "next/server";
import { runImapTest } from "./check";

// POST /api/naver/imap-test: probe imap.naver.com from this project's default region.
export const POST = (request: NextRequest) => runImapTest(request);
