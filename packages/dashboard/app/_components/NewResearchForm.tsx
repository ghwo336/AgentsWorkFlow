"use client";

import { useState } from "react";
import { agentById, PixelAvatar, RESEARCH_PROJECT } from "../lib/agents";
import { api } from "../lib/api";
import { errMsg } from "../lib/err";
import { RESEARCH_SEATS, WEB_RESEARCHER, X_RESEARCHER } from "../lib/research";
import type { ResearchFolder } from "../lib/types";

// "＋ 새 리서치" 화면 — 질문을 제출하면 리서치 팀 run을 시작하고, 보고 있던
// 폴더가 있으면 그 폴더로 자동 분류한다.
export function NewResearchForm({
  folder,
  onStarted,
}: {
  folder: ResearchFolder | null; // 선택돼 있으면 새 리서치를 이 폴더로 자동 분류
  onStarted: (id: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || starting) return;
    setStarting(true);
    try {
      const title = q.length > 60 ? `${q.slice(0, 60)}…` : q;
      const { id } = await api.startRun({
        project: RESEARCH_PROJECT,
        title,
        brief: q,
        agents: RESEARCH_SEATS,
      });
      // 폴더를 보고 있었다면 그 폴더로 분류 — 실패해도 리서치는 시작됐으므로
      // 막지 않는다 (미분류로 남을 뿐, 스레드에서 옮기면 된다).
      if (folder) await api.setRunFolder(id, folder.id).catch(() => {});
      setQuestion("");
      onStarted(id);
    } catch (err) {
      setError(errMsg(err, "리서치 시작 실패"));
    } finally {
      setStarting(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <PixelAvatar agent={agentById(X_RESEARCHER)} size={40} />
        <PixelAvatar agent={agentById(WEB_RESEARCHER)} size={40} />
        <div>
          <b className="pixel">🔍 새 리서치{folder ? ` — 📁 ${folder.name}` : ""}</b>
          <div className="muted small" style={{ marginTop: 2 }}>
            상현(X 실시간)과 예림(웹 전반)이 동시에 조사해서 보고서 두 개로 답해요. 보고서가 나온
            뒤에도 같은 탭에서 계속 물어볼 수 있어요.
            {folder ? ` 이 리서치는 '${folder.name}' 폴더에 담겨요.` : ""}
          </div>
        </div>
      </div>
      <div style={{ height: 10 }} />
      <textarea
        placeholder="궁금한 것을 물어보세요 (예: 2026년 기준 Next.js와 Remix 중 무엇을 쓰는 게 좋을까? 근거와 함께)"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        style={{ width: "100%", resize: "vertical" }}
      />
      <div style={{ height: 8 }} />
      <button type="submit" disabled={starting || !question.trim()}>
        {starting ? "시작하는 중…" : "조사 시작 →"}
      </button>
      {error && (
        <div className="small" style={{ color: "var(--red)", marginTop: 8 }}>
          {error}
        </div>
      )}
    </form>
  );
}
