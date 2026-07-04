"use client";

import { useState } from "react";
import { RESEARCH_PROJECT } from "../lib/agents";
import { api } from "../lib/api";
import { isRunning } from "../lib/research";
import { useLoad } from "../lib/hooks/useLoad";
import { NewResearchForm } from "./NewResearchForm";
import { ResearchFolderBar } from "./ResearchFolderBar";
import { ResearchThread } from "./ResearchThread";

// 홈의 🔍 리서치 탭 — 리서치 하나가 "탭 하나 = 대화 스레드 하나"다. 질문을
// 제출하면 리서치 팀 run이 생기고 — 상현(Grok)이 X를, 예림(Claude)이 웹을
// 동시에 조사해 보고서 두 개가 나란히 온다 — 보고서가 나온 뒤에도(reported)
// 같은 탭에서 후속 질문을 이어갈 수 있다.
//
// 이 컴포넌트는 "무엇을 보고 있는가"(폴더 선택 + 스레드 선택 + 목록 데이터)만
// 든다. 폴더 줄의 CRUD/드롭은 ResearchFolderBar, 새 질문은 NewResearchForm,
// 스레드 본문은 ResearchThread 몫.
//
// refreshKey: 부모(HomeClient)가 SSE 이벤트마다 올려주는 카운터 — 값이 바뀔
// 때마다 목록과 열려 있는 스레드를 다시 읽는다 (EventSource는 부모 것 하나만 사용).
export function ResearchTab({ refreshKey }: { refreshKey: number }) {
  // null = 📂 전체 (미분류 포함 모든 리서치).
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  // null = "＋ 새 리서치" 탭.
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data, error, reload } = useLoad(
    async () => {
      const [runs, folders] = await Promise.all([
        api.listRuns(RESEARCH_PROJECT),
        api.listResearchFolders(),
      ]);
      return { runs, folders };
    },
    [refreshKey],
    { errorLabel: "리서치 목록 로드 실패" }
  );
  const runs = data?.runs ?? [];
  const folders = data?.folders ?? [];

  const activeFolder = folders.find((f) => f.id === activeFolderId) ?? null;
  // 지워진 폴더를 보고 있었다면 전체로 복귀 — 렌더 중 자기 상태를 조정하는
  // React 공식 패턴("adjusting state during render"): setState 후 이 렌더 결과를
  // 버리고 즉시 다시 렌더하므로 effect 없이 안전하다.
  if (activeFolderId && folders.length && !activeFolder) setActiveFolderId(null);
  const visibleRuns = activeFolderId ? runs.filter((r) => r.folderId === activeFolderId) : runs;

  function openFolder(folderId: string | null) {
    setActiveFolderId(folderId);
    // 폴더에 들어가면 그 폴더의 첫 리서치 스레드부터 보여준다 — 비어 있을
    // 때만 "＋ 새 리서치". 전체는 새 질문 화면이 시작점.
    const first = folderId ? runs.find((r) => r.folderId === folderId) : null;
    setActiveId(first?.id ?? null);
  }

  return (
    <>
      <ResearchFolderBar
        folders={folders}
        runs={runs}
        activeFolderId={activeFolderId}
        onOpen={openFolder}
        reload={reload}
      />

      {/* 리서치 줄 — 선택된 폴더 안의 스레드 탭. 탭을 위 폴더 칩에 끌어다
          놓으면 그 폴더로 이동한다 (드롭 처리는 ResearchFolderBar). */}
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
            reload();
          }}
        />
      ) : (
        <ResearchThread
          id={activeId}
          refreshKey={refreshKey}
          folders={folders}
          onMoved={(folderId) => {
            setActiveFolderId(folderId);
            reload();
          }}
        />
      )}
    </>
  );
}
