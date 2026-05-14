import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

async function refreshAccessToken(token: any) {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type:    "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });
    const refreshed = await res.json();
    if (!res.ok) throw refreshed;
    return {
      ...token,
      accessToken:          refreshed.access_token,
      accessTokenExpiresAt: Date.now() + refreshed.expires_in * 1000,
      refreshToken:         refreshed.refresh_token ?? token.refreshToken,
    };
  } catch (err) {
    console.error("토큰 갱신 실패:", err);
    return { ...token, error: "RefreshTokenError" };
  }
}

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:       "openid email profile https://www.googleapis.com/auth/gmail.modify",
          access_type: "offline",
          prompt:      "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }: any) {
      if (account) {
        return {
          ...token,
          accessToken:          account.access_token,
          refreshToken:         account.refresh_token,
          accessTokenExpiresAt: account.expires_at * 1000,
        };
      }
      if (Date.now() < token.accessTokenExpiresAt) return token;
      return await refreshAccessToken(token);
    },
    async session({ session, token }: any) {
      session.accessToken = token.accessToken;
      session.error       = token.error;
      return session;
    },
  },
});

export { handler as GET, handler as POST };