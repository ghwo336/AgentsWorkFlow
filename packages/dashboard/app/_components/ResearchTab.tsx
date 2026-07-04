"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { agentById, PixelAvatar, RESEARCH_PROJECT, ROLE_COLOR } from "../lib/agents";
import { api } from "../lib/api";
import { Markdown } from "../lib/Markdown";
import type { ResearchFolder, Run, RunDetail } from "../lib/types";

// 홈의 🔍 리서치 탭 — 리서치 하나가 "탭 하나 = 대화 스레드 하나"다. 질문을
// 제출하면 리서치 팀 run이 생기고 — 상현(Grok)이 X를, 예림(Claude)이 웹을
// 동시에 조사해 보고서 두 개가 나란히 온다 — 보고서가 나온 뒤에도(reported)
// 같은 탭에서 후속 질문을 이어갈 수 있다. 스레드 본문은 run의 팀 채팅
// (user 질문 ↔ research 보고서, 화자는 msg.agent)으로 그린다.
//
// 폴더: 사용자가 만든 그룹(예: "블록체인")으로 리서치들을 묶는다. 위 줄이
// 폴더 칩(📂 전체 / 📁 각 폴더 / ＋ 새 폴더), 아래 줄이 선택된 폴더 안의
// 리서치 탭. 폴더를 고른 채 새 리서치를 시작하면 그 폴더로 자동 분류되고,
// 스레드 안의 드롭다운으로 언제든 다른 폴더로 옮길 수 있다.

const X_RESEARCHER = "sanghyun"; // 상현 (Grok — X 실시간)
const WEB_RESEARCHER = "yerim"; // 예림 (Claude — 웹 전반)
const RESEARCH_SEATS = [`research:${X_RESEARCHER}`, `research:${WEB_RESEARCHER}`];

// 리서치 화면용 상태 라벨 — 코드 파이프라인 어휘(committed)를 그대로 노출하지
// 않는다. committed는 reported 도입 전의 리서치 run (하위 호환).
const STATUS_LABEL: Record<string, string> = {
  reported: "완료",
  committed: "완료",
  researching: "조사 중",
  planning: "준비 중",
  failed: "실패",
};
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
const isRunning = (s: string) => s === "researching" || s === "planning";

// refreshKey: 부모(HomeClient)가 SSE 이벤트마다 올려주는 카운터 — 값이 바뀔
// 때마다 목록과 열려 있는 스레드를 다시 읽는다 (EventSource는 부모 것 하나만 사용).
export function ResearchTab({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [folders, setFolders] = useState<ResearchFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  // null = 📂 전체 (미분류 포함 모든 리서치).
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  // null = "＋ 새 리서치" 탭.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  // 드래그 중인 리서치가 올라와 있는 폴더 칩 ("all" = 📂 전체 = 미분류로).
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, fs] = await Promise.all([
        api.listRuns(RESEARCH_PROJECT),
        api.listResearchFolders(),
      ]);
      setRuns(rows);
      setFolders(fs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "리서치 목록 로드 실패");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const activeFolder = folders.find((f) => f.id === activeFolderId) ?? null;
  // 지워진 폴더를 보고 있었다면 전체로 복귀.
  if (activeFolderId && folders.length && !activeFolder) setActiveFolderId(null);
  const visibleRuns = activeFolderId ? runs.filter((r) => r.folderId === activeFolderId) : runs;

  function openFolder(folderId: string | null) {
    setActiveFolderId(folderId);
    // 폴더에 들어가면 그 폴더의 첫 리서치 스레드부터 보여준다 — 비어 있을
    // 때만 "＋ 새 리서치". 전체는 새 질문 화면이 시작점.
    const first = folderId ? runs.find((r) => r.folderId === folderId) : null;
    setActiveId(first?.id ?? null);
  }

  // 리서치 탭을 폴더 칩에 끌어다 놓기 — "all" 칩이면 미분류로 꺼낸다.
  async function dropRun(e: React.DragEvent, folderId: string | null) {
    e.preventDefault();
    setDropTarget(null);
    const runId = e.dataTransfer.getData("text/run-id");
    if (!runId) return;
    try {
      await api.setRunFolder(runId, folderId);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "폴더 이동 실패");
    }
  }

  // 폴더 칩을 드롭 대상으로 만드는 공통 핸들러 (key: "all" 또는 폴더 id).
  function dropProps(key: string, folderId: string | null) {
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTarget(key);
      },
      onDragLeave: () => setDropTarget((cur) => (cur === key ? null : cur)),
      onDrop: (e: React.DragEvent) => dropRun(e, folderId),
      style: dropTarget === key ? { outline: "2px dashed var(--accent)" } : undefined,
    };
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const folder = await api.createResearchFolder(name);
      setNewFolderName("");
      setNewFolderOpen(false);
      await load();
      openFolder(folder.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "폴더 생성 실패");
    }
  }

  async function deleteFolder(folder: ResearchFolder) {
    const inside = runs.filter((r) => r.folderId === folder.id).length;
    const ok = window.confirm(
      inside > 0
        ? `'${folder.name}' 폴더를 삭제할까요? 안의 리서치 ${inside}개는 지워지지 않고 미분류로 돌아가요.`
        : `'${folder.name}' 폴더를 삭제할까요?`
    );
    if (!ok) return;
    try {
      await api.deleteResearchFolder(folder.id);
      openFolder(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "폴더 삭제 실패");
    }
  }

  return (
    <>
      {/* 폴더 줄 — 전체 / 각 폴더 / ＋ 새 폴더 */}
      <div className="viz-tabs" style={{ marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className={`viz-tab${activeFolderId === null ? " active" : ""}`}
          onClick={() => openFolder(null)}
          {...dropProps("all", null)}
        >
          📂 전체 ({runs.length})
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`viz-tab${activeFolderId === f.id ? " active" : ""}`}
            onClick={() => openFolder(f.id)}
            title={`${f.name} — 리서치 탭을 끌어다 놓으면 이 폴더로 들어가요`}
            {...dropProps(f.id, f.id)}
          >
            📁 {f.name} ({f.runCount})
          </button>
        ))}
        {newFolderOpen ? (
          <form onSubmit={createFolder} className="row" style={{ gap: 6, alignItems: "center" }}>
            <input
              autoFocus
              placeholder="폴더 이름 (예: 블록체인)"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              style={{ width: 180 }}
            />
            <button type="submit" disabled={!newFolderName.trim()}>
              만들기
            </button>
            <button
              type="button"
              onClick={() => {
                setNewFolderOpen(false);
                setNewFolderName("");
              }}
            >
              취소
            </button>
          </form>
        ) : (
          <button type="button" className="viz-tab" onClick={() => setNewFolderOpen(true)}>
            ＋ 새 폴더
          </button>
        )}
        {activeFolder && (
          <button
            type="button"
            className="viz-tab"
            style={{ marginLeft: "auto", color: "var(--red)" }}
            onClick={() => deleteFolder(activeFolder)}
            title="폴더만 삭제돼요 — 안의 리서치는 미분류로 돌아가요"
          >
            🗑 폴더 삭제
          </button>
        )}
      </div>

      {/* 리서치 줄 — 선택된 폴더 안의 스레드 탭 */}
      <div className="viz-tabs" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className={`viz-tab${activeId === null ? " active" : ""}`}
          onClick={() => setActiveId(null)}
        >
          ＋ 새 리서치
        </button>
        {visibleRuns.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`viz-tab${activeId === r.id ? " active" : ""}`}
            onClick={() => setActiveId(r.id)}
            title={`${r.title} — 위 폴더로 끌어다 놓을 수 있어요`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/run-id", r.id);
              e.dataTransfer.effectAllowed = "move";
            }}
          >
            {isRunning(r.status) ? "🔎 " : ""}
            {r.title.length > 18 ? `${r.title.slice(0, 18)}…` : r.title}
          </button>
        ))}
        {activeFolderId && visibleRuns.length === 0 && (
          <span className="muted small" style={{ alignSelf: "center" }}>
            이 폴더는 아직 비어 있어요 — 새 리서치를 시작하거나, 📂 전체에서 리서치 탭을 위
            폴더 칩으로 끌어다 놓아 보세요.
          </span>
        )}
      </div>

      {error && (
        <div className="small" style={{ color: "var(--red)", marginBottom: 10 }}>
          {error}
        </div>
      )}

      {activeId === null ? (
        <NewResearchForm
          folder={activeFolder}
          onStarted={(id) => {
            setActiveId(id);
            load();
          }}
        />
      ) : (
        <ResearchThread
          id={activeId}
          refreshKey={refreshKey}
          folders={folders}
          onMoved={(folderId) => {
            setActiveFolderId(folderId);
            load();
          }}
        />
      )}
    </>
  );
}

function NewResearchForm({
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
      setError(err instanceof Error ? err.message : "리서치 시작 실패");
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
    </form>
  );
}

// 리서치 스레드 하나 — 대화(질문↔보고서) + 후속 질문 입력. 첫 말풍선은
// run.brief(최초 질문), 이후는 팀 채팅의 user/research 턴.
function ResearchThread({
  id,
  refreshKey,
  folders,
  onMoved,
}: {
  id: string;
  refreshKey: number;
  folders: ResearchFolder[];
  onMoved: (folderId: string | null) => void; // 이동 후 부모가 그 폴더로 따라간다
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 탭 전환 시 이전 스레드가 잠깐 비치지 않도록 id가 바뀌면 즉시 비운다.
  const shownId = useRef(id);
  if (shownId.current !== id) {
    shownId.current = id;
    if (detail) setDetail(null);
  }

  const load = useCallback(async () => {
    try {
      setDetail(await api.getResearchRun(id));
    } catch {
      /* 다음 refresh에서 재시도 */
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!detail) return <div className="panel muted small">스레드 불러오는 중…</div>;

  const running = isRunning(detail.status);
  const turns = detail.chatMsgs.filter((m) => m.role === "user" || m.role === "research");
  // 채팅 기록이 없는 옛 run(스레드 도입 전) 호환: 보고서는 Run.plan에만 있다.
  // 그 시절 리서치는 전부 Claude 리서처(현 예림)의 작업이다.
  const legacyReport = !running && !turns.some((m) => m.role === "research") ? detail.plan : null;
  const lastEvents = detail.events.slice(-5);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || sending || running) return;
    setSending(true);
    try {
      await api.researchFollowUp(id, q);
      setQuestion("");
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "후속 질문 전송 실패");
    } finally {
      setSending(false);
    }
  }

  async function moveToFolder(folderId: string | null) {
    if (moving) return;
    setMoving(true);
    try {
      await api.setRunFolder(id, folderId);
      setError(null);
      await load();
      onMoved(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "폴더 이동 실패");
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="panel">
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <b className="agent-chip">
          <PixelAvatar agent={agentById(X_RESEARCHER)} size={22} active={running} />
          <PixelAvatar agent={agentById(WEB_RESEARCHER)} size={22} active={running} />
          <span style={{ color: ROLE_COLOR.research }}>{detail.title}</span>
        </b>
        <span className="row" style={{ gap: 8, alignItems: "center" }}>
          <select
            value={detail.folderId ?? ""}
            disabled={moving}
            onChange={(e) => moveToFolder(e.target.value || null)}
            title="이 리서치를 담을 폴더"
          >
            <option value="">📂 미분류</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                📁 {f.name}
              </option>
            ))}
          </select>
          <span className={`badge b-${detail.status}`}>{statusLabel(detail.status)}</span>
        </span>
      </div>

      {/* 보고서가 길다 — 공용 chat-thread의 280px 상한을 스레드용으로 늘린다 */}
      <div className="chat-thread" style={{ marginTop: 12, maxHeight: "62vh" }}>
        <ThreadBubble agentId={null} text={detail.brief ?? ""} />
        {turns.map((m) =>
          m.text ? (
            <ThreadBubble
              key={m.id}
              agentId={m.role === "user" ? null : (m.agent ?? WEB_RESEARCHER)}
              text={m.text}
            />
          ) : null
        )}
        {legacyReport && <ThreadBubble agentId={WEB_RESEARCHER} text={legacyReport} />}
        {running && (
          <div className="chat-msg chat-assistant">
            <span className="chat-who">리서치팀</span>
            <div className="chat-bubble">
              <div className="small">
                🔎 상현(X)·예림(웹)이 조사 중… 완료되는 대로 보고서가 하나씩 나타나요.
              </div>
              <div className="log" style={{ marginTop: 8 }}>
                {lastEvents.map((ev) => (
                  <div key={ev.id} className="line">
                    <span className={ev.level === "error" ? "err" : ev.level === "warn" ? "warn" : ""}>
                      {ev.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {detail.error && (
        <div className="small" style={{ color: "var(--red)", marginTop: 8, whiteSpace: "pre-wrap" }}>
          {detail.error}
        </div>
      )}
      {error && (
        <div className="small" style={{ color: "var(--red)", marginTop: 8 }}>
          {error}
        </div>
      )}

      {!running && (
        <form onSubmit={submit} style={{ marginTop: 12 }}>
          <textarea
            placeholder={
              detail.status === "failed"
                ? "조사가 실패했어요 — 질문을 다시 보내면 이어서 시도해요."
                : "후속 질문을 이어서 물어보세요 — 상현·예림이 위 대화를 기억한 채로 답해요."
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            style={{ width: "100%", resize: "vertical" }}
          />
          <div style={{ height: 8 }} />
          <button type="submit" disabled={sending || !question.trim()}>
            {sending ? "보내는 중…" : "후속 질문 →"}
          </button>
        </form>
      )}
    </div>
  );
}

// agentId = null → 사용자 말풍선, 그 외 → 해당 리서처(상현/예림)의 말풍선.
function ThreadBubble({ agentId, text }: { agentId: string | null; text: string }) {
  const mine = agentId === null;
  const who = mine ? null : agentById(agentId);
  return (
    <div className={`chat-msg ${mine ? "chat-user" : "chat-assistant"}`}>
      <span className="chat-who">
        {mine || !who ? (
          "나"
        ) : (
          <span className="row" style={{ gap: 4, alignItems: "center" }}>
            <PixelAvatar agent={who} size={16} /> {who.name} · {who.roleLabel}
          </span>
        )}
      </span>
      <div className="chat-bubble">
        <Markdown className="md">{text}</Markdown>
      </div>
    </div>
  );
}
