import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const token = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = token?.accessToken as string | undefined;
  if (!accessToken) return NextResponse.json({ error: "accessToken 없음" }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    }
  );

  if (!res.ok) return NextResponse.json({ error: "읽음 처리 실패" }, { status: 500 });
  return NextResponse.json({ success: true });
}
