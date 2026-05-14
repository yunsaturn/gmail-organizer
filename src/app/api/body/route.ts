import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
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

export async function GET(req: Request) {
  const token = await getToken({
    req: req as any,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const accessToken = token?.accessToken as string | undefined;
  if (!accessToken) {
    return NextResponse.json({ error: "accessToken 없음" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id 필요" }, { status: 400 });
  }

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Gmail 호출 실패" }, { status: 500 });
  }

  const data = await res.json();
  const headers: { name: string; value: string }[] = data.payload?.headers || [];
  const date = headers.find((h) => h.name === "Date")?.value || "";
  const to   = headers.find((h) => h.name === "To")?.value   || "";

  let body = extractBody(data.payload || {});
  if (!body) body = data.snippet || "(본문 없음)";

  return NextResponse.json({ body, date, to });
}
