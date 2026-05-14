"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Settings {
  kuaiEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  kuaiEnabled: false,
};

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
        enabled ? "bg-blue-500" : "bg-zinc-700"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("gmail-organizer-settings");
    if (raw) {
      try { setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) }); } catch {}
    }
  }, []);

  const update = (key: keyof Settings, value: boolean) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("gmail-organizer-settings", JSON.stringify(next));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* 헤더 */}
      <header className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800">
        <button
          onClick={() => router.push("/")}
          className="text-zinc-400 hover:text-white transition text-sm flex items-center gap-2"
        >
          ← 돌아가기
        </button>
        <h1 className="text-lg font-bold tracking-tight">설정</h1>
        {saved && (
          <span className="ml-auto text-xs text-emerald-400 font-medium animate-pulse">
            ✓ 저장됨
          </span>
        )}
      </header>

      <div className="max-w-xl mx-auto px-6 py-8 space-y-6">

        {/* 실험실 섹션 */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
              실험실
            </h2>
            <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-medium">
              BETA
            </span>
          </div>
          <p className="text-xs text-zinc-600 mb-4">개발 중인 기능입니다. 예고 없이 변경될 수 있습니다.</p>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800">
            {/* KU AI 필터 */}
            <div className="flex items-start gap-4 p-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🤖</span>
                  <p className="text-sm font-semibold text-white">KU AI 필터</p>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  고려대 인공지능학과 1학년에게 유용한 메일만 모아 보여줍니다.
                  수강신청, 과제, 공모전, 세미나 등 관련 메일을 자동으로 필터링합니다.
                </p>
              </div>
              <div className="flex-shrink-0 pt-0.5">
                <Toggle
                  enabled={settings.kuaiEnabled}
                  onToggle={() => update("kuaiEnabled", !settings.kuaiEnabled)}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 일반 섹션 (추후 확장용) */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
            일반
          </h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-600 text-center">추가 설정 준비 중...</p>
          </div>
        </section>

      </div>
    </div>
  );
}
