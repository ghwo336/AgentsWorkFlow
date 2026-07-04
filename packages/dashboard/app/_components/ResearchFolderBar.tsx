"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { errMsg } from "../lib/err";
import type { ResearchFolder, Run } from "../lib/types";

// 리서치 폴더 칩 줄 — 📂 전체 / 📁 각 폴더 / ＋ 새 폴더 / 🗑 삭제. 폴더의
// 생성·삭제, 그리고 드롭으로 들어오는 리서치의 폴더 이동까지 폴더에 관한
// 책임은 전부 여기서 진다 (드래그 시작은 ResearchTab의 스레드 탭 쪽).
// "전체" 칩에 떨어뜨리면 미분류로 꺼낸다.
export function ResearchFolderBar({
  folders,
  runs,
  activeFolderId,
  onOpen,
  reload,
}: {
  folders: ResearchFolder[];
  runs: Run[];
  activeFolderId: string | null; // null = 📂 전체
  onOpen: (folderId: string | null) => void; // 칩 클릭/생성/삭제 후 이동할 폴더
  reload: () => Promise<void>; // 폴더 변경 후 목록 재조회 (부모 소유)
}) {
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  // 드래그 중인 리서치가 올라와 있는 폴더 칩 ("all" = 📂 전체 = 미분류로).
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeFolder = folders.find((f) => f.id === activeFolderId) ?? null;

  async function dropRun(e: React.DragEvent, folderId: string | null) {
    e.preventDefault();
    setDropTarget(null);
    const runId = e.dataTransfer.getData("text/run-id");
    if (!runId) return;
    try {
      await api.setRunFolder(runId, folderId);
      setError(null);
      await reload();
    } catch (err) {
      setError(errMsg(err, "폴더 이동 실패"));
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
      setError(null);
      await reload();
      onOpen(folder.id);
    } catch (err) {
      setError(errMsg(err, "폴더 생성 실패"));
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
      setError(null);
      onOpen(null);
      await reload();
    } catch (err) {
      setError(errMsg(err, "폴더 삭제 실패"));
    }
  }

  return (
    <>
      <div className="viz-tabs" style={{ marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className={`viz-tab${activeFolderId === null ? " active" : ""}`}
          onClick={() => onOpen(null)}
          {...dropProps("all", null)}
        >
          📂 전체 ({runs.length})
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`viz-tab${activeFolderId === f.id ? " active" : ""}`}
            onClick={() => onOpen(f.id)}
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
      {error && (
        <div className="small" style={{ color: "var(--red)", marginBottom: 8 }}>
          {error}
        </div>
      )}
    </>
  );
}
