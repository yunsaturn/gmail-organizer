import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

// ── 서버 메모리 캐시 (프로세스 유지 동안) ────────────────────────────────────
const summaryCache = new Map<string, { summary: string; isAI: boolean }>();

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try { return Buffer.from(base64, "base64").toString("utf-8"); } catch { return ""; }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    return payload.mimeType === "text/html" ? stripHtml(decoded) : decoded;
  }
  if (Array.isArray(payload.parts)) {
    const plain = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeBase64Url(plain.body.data);
    const html = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (html?.body?.data) return stripHtml(decodeBase64Url(html.body.data));
    for (const part of payload.parts) {
      const inner = extractBody(part);
      if (inner) return inner;
    }
  }
  return "";
}

async function summarizeWithGemini(subject: string, body: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `다음 이메일을 한국어로 2~3문장으로 간결하게 요약해줘.
- 핵심 내용 + 사용자가 해야 할 행동(있다면)을 포함
- 불필요한 인사말/푸터/광고 문구는 제외
- 요약문만 반환

제목: ${subject}
본문: ${body.slice(0, 3000)}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!res.ok) {
      console.error("Gemini 요약 오류:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error("Gemini 요약 예외:", err);
    return null;
  }
}

export async function GET(req: Request) {
  const token = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = token?.accessToken as string | undefined;
  if (!accessToken) return NextResponse.json({ error: "accessToken 없음" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  // ── 캐시 히트 ──────────────────────────────────────────────────────────────
  const cached = summaryCache.get(id);
  if (cached) {
    console.log(`캐시 히트: ${id}`);
    return NextResponse.json(cached);
  }

  // ── Gmail 본문 fetch ────────────────────────────────────────────────────────
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return NextResponse.json({ error: "Gmail 호출 실패" }, { status: 500 });

  const gmailData = await res.json();
  const headers: { name: string; value: string }[] = gmailData.payload?.headers || [];
  const subject = headers.find((h) => h.name === "Subject")?.value || "";
  let body = extractBody(gmailData.payload || "");
  if (!body) body = gmailData.snippet || "";

  // ── Gemini 요약 → snippet fallback ────────────────────────────────────────
  const aiSummary = await summarizeWithGemini(subject, body);
  const summary   = aiSummary || gmailData.snippet || "내용을 불러올 수 없습니다.";
  const isAI      = aiSummary !== null;

  // ── 캐시 저장 ──────────────────────────────────────────────────────────────
  summaryCache.set(id, { summary, isAI });

  return NextResponse.json({ summary, isAI });
}