"use client";


import { useRouter } from "next/navigation";
import { useSettings } from "../hooks/useSettings"; // 또는 경로에 맞게
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

type Category = "전체" | "광고" | "학교" | "금융" | "중요" | "기타";
type Filter = Category | "KU AI";
type DateRange = "7" | "30" | "all";

interface Email {
  id: string;
  subject: string;
  from: string;
  category: Category;
  aiClassified: boolean;
  isUnread: boolean;
  date?: string;
}
interface EmailBody { body: string; date: string; to: string; }
interface Toast { toastId: string; subject: string; from: string; }

const CATEGORY_STYLE: Record<string, string> = {
  광고: "bg-red-500/15 text-red-300 border-red-500/25 ring-red-500/10",
  학교: "bg-sky-500/15 text-sky-300 border-sky-500/25 ring-sky-500/10",
  금융: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25 ring-emerald-500/10",
  중요: "bg-amber-500/15 text-amber-300 border-amber-500/25 ring-amber-500/10",
  기타: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25 ring-zinc-500/10",
};

const FILTER_ICON: Record<Filter, string> = {
  전체: "📬", 중요: "⭐", 학교: "🎓", 금융: "💳", 광고: "📢", 기타: "📁", "KU AI": "🤖",
};

const POLL_INTERVAL = 3 * 60 * 1000;
const TOAST_DURATION = 5000;

const KU_AI_POSITIVE = [
  "수강신청", "강의계획서", "수업 변경", "휴강", "보강", "과제", "시험", "성적", "학점", "출석",
  "장학금", "장학생", "학생처", "교무처", "학사", "공모전", "해커톤", "인턴", "채용 설명회",
  "세미나", "특강", "학회", "컨퍼런스", "인공지능", "머신러닝", "딥러닝", "파이썬", "알고리즘",
  "새내기", "오리엔테이션", "동아리 모집", "학생회", "졸업", "등록금", "휴학", "복학",
];
const KU_AI_NEGATIVE = [
  "광고", "구독", "newsletter", "unsubscribe", "결제", "청구", "영수증", "배송",
  "이벤트 종료", "마감 완료", "접수 마감", "선발 완료", "결과 발표", "합격자 발표", "불합격", "처리 완료",
];

function isKUAIRelevant(email: Email, dateRange: DateRange = "all"): boolean {
  const text = (email.subject + " " + email.from).toLowerCase();
  if (dateRange !== "all" && email.date) {
    if (parseInt(email.date) < Date.now() - parseInt(dateRange) * 86400000) return false;
  }
  if (KU_AI_NEGATIVE.some((kw) => text.includes(kw.toLowerCase()))) return false;
  return email.category === "학교" || KU_AI_POSITIVE.some((kw) => text.includes(kw.toLowerCase()));
}

function formatDate(ms?: string): string {
  if (!ms) return "";
  const diff = Math.floor((Date.now() - parseInt(ms)) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  if (diff < 7) return `${diff}일 전`;
  const d = new Date(parseInt(ms));
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── 스켈레톤 카드 ──────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-2xl p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-2 h-2 rounded-full bg-zinc-700 mt-1.5 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-zinc-700 rounded-lg w-3/4" />
          <div className="h-3 bg-zinc-700/60 rounded-lg w-1/2" />
        </div>
        <div className="h-5 w-12 bg-zinc-700 rounded-full" />
      </div>
    </div>
  );
}

export default function Home() {
  const { data: session } = useSession();
  const router = useRouter();
  const { settings, ready } = useSettings();

  const FILTER_TABS: Filter[] = [
    "전체",
    ...(settings.kuaiEnabled ? ["KU AI" as Filter] : []),
    "중요", "학교", "금융", "광고", "기타",
  ];

  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("전체");
  const [dateRange, setDateRange] = useState<DateRange>("30");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [summaryIsAI, setSummaryIsAI] = useState<Record<string, boolean>>({});
  const [summaryLoadingId, setSummaryLoadingId] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState<Record<string, boolean>>({});
  const [bodies, setBodies] = useState<Record<string, EmailBody>>({});
  const [bodyLoadingId, setBodyLoadingId] = useState<string | null>(null);
  const [trashingId, setTrashingId] = useState<string | null>(null);
  const [trashingAll, setTrashingAll] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const isInitialRef = useRef(true);

  const showToast = (email: Email) => {
    const toastId = `${email.id}-${Date.now()}`;
    setToasts((p) => [...p.slice(-4), { toastId, subject: email.subject, from: email.from }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.toastId !== toastId)), TOAST_DURATION);
  };

  const pollEmails = async () => {
    try {
      const res = await fetch("/api/emails");
      const data = await res.json();
      const fetched: Email[] = data.emails || [];
      if (isInitialRef.current) {
        fetched.forEach((e) => seenIdsRef.current.add(e.id));
        isInitialRef.current = false;
        return;
      }
      const newEmails = fetched.filter((e) => !seenIdsRef.current.has(e.id));
      fetched.forEach((e) => seenIdsRef.current.add(e.id));
      newEmails.filter((e) => isKUAIRelevant(e, "all")).forEach(showToast);
      if (newEmails.length > 0) {
        setEmails((prev) => {
          const ids = new Set(prev.map((e) => e.id));
          const truly_new = newEmails.filter((e) => !ids.has(e.id));
          return truly_new.length > 0 ? [...truly_new, ...prev] : prev;
        });
      }
    } catch { }
  };

  useEffect(() => {
    if (!session) return;
    const t = setInterval(pollEmails, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [session]);

  const fetchEmails = async () => {
    setLoading(true); setEmails([]); setNextPageToken(null);
    isInitialRef.current = true;
    try {
      const res = await fetch("/api/emails");
      const data = await res.json();
      const fetched: Email[] = data.emails || [];
      fetched.forEach((e) => seenIdsRef.current.add(e.id));
      isInitialRef.current = false;
      setEmails(fetched);
      setNextPageToken(data.nextPageToken || null);
    } finally { setLoading(false); }
  };

  const loadMore = async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/emails?pageToken=${nextPageToken}`);
      const data = await res.json();
      const fetched: Email[] = data.emails || [];
      fetched.forEach((e) => seenIdsRef.current.add(e.id));
      setEmails((p) => [...p, ...fetched]);
      setNextPageToken(data.nextPageToken || null);
    } finally { setLoadingMore(false); }
  };

  useEffect(() => { if (session) fetchEmails(); }, [session]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (summaries[id]) return;
    setSummaryLoadingId(id);
    try {
      const res = await fetch(`/api/summary?id=${id}`);
      const data = await res.json();
      setSummaries((p) => ({ ...p, [id]: data.summary || "요약 없음" }));
      setSummaryIsAI((p) => ({ ...p, [id]: data.isAI ?? false }));
    } catch {
      setSummaries((p) => ({ ...p, [id]: "요약 오류" }));
    } finally { setSummaryLoadingId(null); }
  };

  const toggleOriginal = async (id: string) => {
    const next = !showOriginal[id];
    setShowOriginal((p) => ({ ...p, [id]: next }));
    if (!next || bodies[id]) return;
    setBodyLoadingId(id);
    try {
      const res = await fetch(`/api/body?id=${id}`);
      const data = await res.json();
      setBodies((p) => ({ ...p, [id]: data }));
    } catch {
      setBodies((p) => ({ ...p, [id]: { body: "불러오기 실패", date: "", to: "" } }));
    } finally { setBodyLoadingId(null); }
  };

  const markAsRead = async (id: string) => {
    await fetch("/api/mark-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setEmails((p) => p.map((e) => e.id === id ? { ...e, isUnread: false } : e));
  };

  const trashEmail = async (id: string) => {
    setTrashingId(id);
    try {
      await fetch("/api/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
      setEmails((p) => p.filter((e) => e.id !== id));
      if (expandedId === id) setExpandedId(null);
    } finally { setTrashingId(null); }
  };

  const trashAllAds = async () => {
    const adIds = emails.filter((e) => e.category === "광고").map((e) => e.id);
    if (!adIds.length || !confirm(`광고 메일 ${adIds.length}개를 휴지통으로 이동할까요?`)) return;
    setTrashingAll(true);
    try {
      await fetch("/api/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: adIds }) });
      setEmails((p) => p.filter((e) => e.category !== "광고"));
      if (expandedId && adIds.includes(expandedId)) setExpandedId(null);
    } finally { setTrashingAll(false); }
  };

  const countByFilter = (f: Filter) => {
    if (f === "전체") return emails.length;
    if (f === "KU AI") return emails.filter((e) => isKUAIRelevant(e, dateRange)).length;
    return emails.filter((e) => e.category === f).length;
  };

  const filtered = emails
    .filter((e) => filter === "전체" ? true : filter === "KU AI" ? isKUAIRelevant(e, dateRange) : e.category === filter)
    .filter((e) => !search || `${e.subject} ${e.from}`.toLowerCase().includes(search.toLowerCase()));

  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-5 text-3xl">📬</div>
          <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Gmail 자동 정리</h1>
          <p className="text-zinc-400 mb-8 text-sm">Google 로그인 후 메일을 자동으로 분류합니다</p>
          <button
            onClick={() => signIn("google")}
            className="bg-blue-500 hover:bg-blue-400 active:scale-95 text-white px-8 py-3 rounded-xl font-semibold transition-all duration-150 shadow-lg shadow-blue-500/25"
          >
            Google 로그인
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="h-screen bg-zinc-950 text-white flex overflow-hidden">
      <style>{`
        @keyframes shrink { from { width:100% } to { width:0% } }
        @keyframes slideUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
        .slide-up { animation: slideUp 0.2s ease-out forwards; }
        .expand-content { animation: slideUp 0.15s ease-out forwards; }
      `}</style>

      {/* ── 토스트 ── */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.toastId} className="slide-up bg-zinc-800 border border-emerald-500/40 rounded-2xl p-4 w-80 shadow-2xl shadow-black/50 pointer-events-auto">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0 text-base">🤖</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-emerald-400 font-semibold mb-0.5 tracking-wide uppercase">새 KU AI 메일</p>
                <p className="text-white text-sm font-medium truncate">{t.subject}</p>
                <p className="text-zinc-400 text-xs truncate">{t.from}</p>
              </div>
              <button onClick={() => setToasts((p) => p.filter((x) => x.toastId !== t.toastId))} className="text-zinc-500 hover:text-white transition text-xs mt-0.5">✕</button>
            </div>
            <div className="mt-3 h-0.5 bg-zinc-700 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ animation: `shrink ${TOAST_DURATION}ms linear forwards` }} />
            </div>
          </div>
        ))}
      </div>

      {/* ── 사이드바 ── */}
      <aside className={`flex flex-col flex-shrink-0 bg-zinc-900 h-screen border-r border-zinc-800 transition-all duration-200 ${sidebarOpen ? "w-52" : "w-14"}`}>
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-zinc-800 flex-shrink-0">
          <button onClick={() => setSidebarOpen((v) => !v)} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition text-sm">☰</button>
          {sidebarOpen && <span className="font-bold text-white tracking-tight truncate">메일 정리</span>}
        </div>

        <nav className="py-3 flex-1 overflow-y-auto px-2 space-y-0.5">
          {FILTER_TABS.map((f) => {
            const count = countByFilter(f);
            const isActive = filter === f;
            const isKU = f === "KU AI";
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${isActive
                  ? isKU ? "bg-emerald-500/15 text-emerald-300" : "bg-blue-500/15 text-blue-300"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  }`}
              >
                <span className="text-base flex-shrink-0">{FILTER_ICON[f]}</span>
                {sidebarOpen && (
                  <>
                    <span className="flex-1 text-left">{f === "KU AI" ? "KU AI 필터" : f}</span>
                    {count > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-md font-semibold ${isActive
                        ? isKU ? "bg-emerald-500/20 text-emerald-300" : "bg-blue-500/20 text-blue-300"
                        : "bg-zinc-800 text-zinc-400"
                        }`}>{count}</span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-zinc-800 flex-shrink-0">
          <button
            onClick={() => router.push("/settings")}
            className="w-full flex items-center gap-2.5 text-zinc-500 hover:text-white transition text-sm px-3 py-2 rounded-xl hover:bg-zinc-800 mb-1"
          >
            <span className="flex-shrink-0 text-base">⚙️</span>
            {sidebarOpen && <span>설정</span>}
          </button>
          <button
            onClick={() => signOut()}
            className="w-full flex items-center gap-2.5 text-zinc-500 hover:text-red-400 transition text-sm px-3 py-2 rounded-xl hover:bg-zinc-800"
          >
            <span className="flex-shrink-0 text-base">🚪</span>
            {sidebarOpen && <span>로그아웃</span>}
          </button>
        </div>
      </aside>

      {/* ── 메인 ── */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* 헤더 */}
        <header className="flex items-center gap-3 px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur flex-shrink-0">
          <div className="flex-1 relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none">🔍</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="제목, 보낸 사람 검색..."
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-blue-500/50 text-white text-sm rounded-xl pl-10 pr-4 py-2.5 outline-none transition-colors placeholder:text-zinc-600"
            />
          </div>

          {filter === "광고" && countByFilter("광고") > 0 && (
            <button
              onClick={trashAllAds} disabled={trashingAll}
              className="bg-red-500/10 hover:bg-red-500/20 active:scale-95 text-red-400 border border-red-500/20 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex-shrink-0 disabled:opacity-50"
            >
              {trashingAll ? "삭제 중..." : `🗑️ 광고 ${countByFilter("광고")}개 삭제`}
            </button>
          )}

          <button
            onClick={fetchEmails} disabled={loading}
            className="w-9 h-9 flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 active:scale-95 border border-zinc-800 rounded-xl text-sm transition-all flex-shrink-0 disabled:opacity-50"
          >
            {loading ? "⏳" : "🔄"}
          </button>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-xs">👤</div>
            <span className="text-zinc-400 text-xs truncate max-w-28">{session.user?.email}</span>
          </div>
        </header>

        {/* KU AI 필터 바 */}
        {filter === "KU AI" && (
          <div className="flex items-center gap-3 px-5 py-2 bg-emerald-500/5 border-b border-emerald-500/15 flex-shrink-0">
            <span className="text-xs text-emerald-400 font-medium">🤖 고대 AI 1학년 맞춤</span>
            <div className="flex gap-1 ml-auto">
              {(["7", "30", "all"] as DateRange[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDateRange(d)}
                  className={`text-xs px-2.5 py-1 rounded-lg transition-all border ${dateRange === d
                    ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/40"
                    : "text-zinc-500 border-zinc-800 hover:border-zinc-600 hover:text-zinc-300"
                    }`}
                >
                  {d === "7" ? "7일" : d === "30" ? "30일" : "전체"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 메일 목록 */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* 스켈레톤 로딩 */}
          {loading && (
            <div className="space-y-2 max-w-3xl mx-auto">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="text-center py-20">
              <div className="text-4xl mb-3 opacity-30">
                {filter === "KU AI" ? "🤖" : "📭"}
              </div>
              <p className="text-zinc-500 text-sm">
                {filter === "KU AI"
                  ? `최근 ${dateRange !== "all" ? dateRange + "일 내 " : ""}고대 AI 관련 메일 없음`
                  : search ? `"${search}" 검색 결과 없음` : "메일이 없습니다"}
              </p>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="space-y-1.5 max-w-3xl mx-auto">
              {filtered.map((email, idx) => {
                const isExpanded = expandedId === email.id;
                const isSummarizing = summaryLoadingId === email.id;
                const isTrashing = trashingId === email.id;
                const summary = summaries[email.id];
                const isAI = summaryIsAI[email.id];
                const original = bodies[email.id];
                const originalOpen = showOriginal[email.id];
                const isFetchingBody = bodyLoadingId === email.id;

                return (
                  <div
                    key={email.id}
                    className={`border rounded-2xl transition-all duration-200 cursor-pointer ${isExpanded
                      ? "bg-zinc-800/80 border-blue-500/30 shadow-lg shadow-blue-500/5"
                      : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50"
                      } ${isTrashing ? "opacity-30 pointer-events-none scale-98" : ""}`}
                    style={{ animationDelay: `${idx * 30}ms` }}
                    onClick={() => toggleExpand(email.id)}
                  >
                    {/* 메일 헤더 */}
                    <div className="flex items-start gap-3 p-4">
                      <div className="flex-shrink-0 mt-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full transition-all ${email.isUnread ? "bg-blue-400 shadow-sm shadow-blue-400" : "bg-transparent"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`truncate text-sm leading-snug ${email.isUnread ? "text-white font-semibold" : "text-zinc-300 font-medium"}`}>
                          {email.subject}
                        </p>
                        <p className="text-zinc-500 text-xs truncate mt-0.5">{email.from}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {email.date && <span className="text-xs text-zinc-600">{formatDate(email.date)}</span>}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${CATEGORY_STYLE[email.category] ?? CATEGORY_STYLE["기타"]}`}>
                          {email.category}
                        </span>
                        {email.aiClassified && <span className="text-purple-500 text-xs">✦</span>}
                        <span className={`text-zinc-600 text-xs transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}>▾</span>
                      </div>
                    </div>

                    {/* 펼친 내용 */}
                    {isExpanded && (
                      <div onClick={(e) => e.stopPropagation()} className="expand-content px-4 pb-4 space-y-4">
                        <div className="h-px bg-zinc-800" />

                        {/* 요약 */}
                        <div className="bg-zinc-900/60 rounded-xl p-3.5">
                          <p className="text-xs font-semibold mb-2 tracking-wide uppercase {isAI ? 'text-purple-400' : 'text-zinc-500'}">
                            {isAI ? "✦ AI 요약" : "📄 미리보기"}
                          </p>
                          {isSummarizing ? (
                            <div className="space-y-2">
                              <div className="h-3 bg-zinc-800 rounded animate-pulse w-full" />
                              <div className="h-3 bg-zinc-800 rounded animate-pulse w-4/5" />
                            </div>
                          ) : (
                            <p className="text-zinc-200 text-sm leading-relaxed whitespace-pre-line">{summary}</p>
                          )}
                        </div>

                        {/* 액션 버튼 */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => toggleOriginal(email.id)}
                            className="text-xs text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-all active:scale-95"
                          >
                            {originalOpen ? "숨기기" : "📄 원본 보기"}
                          </button>

                          {email.isUnread && (
                            <button
                              onClick={() => markAsRead(email.id)}
                              className="text-xs text-blue-400 hover:text-blue-300 px-3 py-1.5 rounded-lg border border-blue-500/25 hover:border-blue-400/40 transition-all active:scale-95"
                            >
                              ✓ 읽음
                            </button>
                          )}

                          <button
                            onClick={() => trashEmail(email.id)}
                            className="text-xs text-red-500 hover:text-red-400 px-3 py-1.5 rounded-lg border border-red-500/20 hover:border-red-400/30 transition-all active:scale-95 ml-auto"
                          >
                            🗑️ 삭제
                          </button>
                        </div>

                        {/* 원본 */}
                        {originalOpen && (
                          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                            {isFetchingBody ? (
                              <div className="space-y-2">
                                {[...Array(3)].map((_, i) => <div key={i} className="h-3 bg-zinc-800 rounded animate-pulse" style={{ width: `${100 - i * 15}%` }} />)}
                              </div>
                            ) : original ? (
                              <>
                                {original.date && <p className="text-xs text-zinc-600 mb-1">📅 {original.date}</p>}
                                {original.to && <p className="text-xs text-zinc-600 mb-3 truncate">To: {original.to}</p>}
                                <pre className="text-zinc-300 text-xs leading-relaxed whitespace-pre-wrap break-words font-mono max-h-80 overflow-y-auto">
                                  {original.body}
                                </pre>
                              </>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 더 불러오기 */}
              {nextPageToken && !search && (
                <div className="text-center pt-4 pb-6">
                  <button
                    onClick={loadMore} disabled={loadingMore}
                    className="bg-zinc-900 hover:bg-zinc-800 active:scale-95 text-zinc-300 border border-zinc-800 px-8 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                  >
                    {loadingMore ? "불러오는 중..." : "더 불러오기"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}