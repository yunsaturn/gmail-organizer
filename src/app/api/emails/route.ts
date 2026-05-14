import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

// 서버 메모리 캐시 (프로세스 재시작 전까지 유지)
const classifyCache = new Map<string, Category>();

type Category = "광고" | "학교" | "금융" | "중요" | "기타";

function classifyByRule(subject: string, from: string): Category | null {
  const text = (subject + " " + from).toLowerCase();

  if (
    text.includes("promo") || text.includes("sale") || text.includes("coupon") ||
    text.includes("광고") || text.includes("newsletter") || text.includes("unsubscribe") ||
    text.includes("할인") || text.includes("이벤트") || text.includes("특가") ||
    text.includes("구독") || text.includes("혜택")
  ) return "광고";

  if (
    text.includes("school") || text.includes("university") || text.includes("class") ||
    text.includes("공지") || text.includes("학교") || text.includes("수업") ||
    text.includes("과제") || text.includes("강의") || text.includes("학사") ||
    text.includes("성적") || text.includes("수강")
  ) return "학교";

  if (
    text.includes("bank") || text.includes("invoice") || text.includes("payment") ||
    text.includes("receipt") || text.includes("결제") || text.includes("청구") ||
    text.includes("입금") || text.includes("출금") || text.includes("카드") ||
    text.includes("계좌") || text.includes("거래")
  ) return "금융";

  return null;
}

async function classifyWithGemini(
  emails: { id: string; subject: string; from: string }[]
): Promise<Record<string, Category>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return {};

  const emailList = emails
    .map((e) => `[${e.id}]\n제목: ${e.subject}\n보낸사람: ${e.from}`)
    .join("\n\n");

  const prompt = `이메일을 아래 카테고리 중 하나로 분류해줘.
카테고리: 광고, 학교, 금융, 중요, 기타
반드시 JSON만 응답. 예시: {"id1": "광고", "id2": "중요"}
${emailList}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 4000,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const content = data.candidates?.[0]?.message?.content || data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(content) as Record<string, Category>;
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  const token = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = token?.accessToken as string | undefined;
  if (!accessToken) {
    return NextResponse.json({ error: "accessToken 없음" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const pageToken = searchParams.get("pageToken") || "";

  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("maxResults", "100");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const listRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listData = await listRes.json();
  const messages: { id: string }[] = listData.messages || [];
  const nextPageToken: string | null = listData.nextPageToken || null;

  const detailed = await Promise.all(
    messages.map(async (msg) => {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}` +
        `?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      const headers: { name: string; value: string }[] = data.payload?.headers || [];
      const subject = headers.find((h) => h.name === "Subject")?.value || "(제목 없음)";
      const from = headers.find((h) => h.name === "From")?.value || "(보낸사람 없음)";
      const isUnread = (data.labelIds || []).includes("UNREAD");
      return { id: msg.id, subject, from, isUnread, date: data.internalDate as string };
    })
  );

  const withRule = detailed.map((e) => ({
    ...e,
    ruleCategory: classifyByRule(e.subject, e.from) ?? classifyCache.get(e.id) ?? null,
  }));
  const needsAI = withRule.filter((e) => e.ruleCategory === null);
  const aiResults = needsAI.length > 0 ? await classifyWithGemini(needsAI) : {};

  // AI 결과 캐시 저장
  Object.entries(aiResults).forEach(([id, cat]) => classifyCache.set(id, cat as Category));


  const emails = withRule.map((e) => ({
    id: e.id,
    subject: e.subject,
    from: e.from,
    isUnread: e.isUnread,
    category: (e.ruleCategory ?? aiResults[e.id] ?? "기타") as Category,
    aiClassified: e.ruleCategory === null,
    date: e.date,
  }));

  return NextResponse.json({ emails, nextPageToken });
}