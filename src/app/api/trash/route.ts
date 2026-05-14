import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

// 단일 또는 다수 메일 휴지통 이동
export async function POST(req: Request) {
  const token = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = token?.accessToken as string | undefined;
  if (!accessToken) return NextResponse.json({ error: "accessToken 없음" }, { status: 401 });

  const { ids } = await req.json(); // ids: string[]
  if (!ids || ids.length === 0) return NextResponse.json({ error: "ids 필요" }, { status: 400 });

  const results = await Promise.allSettled(
    ids.map((id: string) =>
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    )
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  return NextResponse.json({ success: true, total: ids.length, failed });
}
