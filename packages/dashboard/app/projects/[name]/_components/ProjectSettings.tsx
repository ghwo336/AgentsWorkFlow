"use client";

import { useEffect, useState } from "react";
import { RepoPicker } from "./RepoPicker";

// Project-level default repo dir. Persisted on the project, so every new run in
// it starts pre-filled instead of re-typing the path each time.
export function ProjectSettings({
  defaultTargetDir,
  repos,
  onSave,
}: {
  defaultTargetDir: string;
  repos: string[];
  onSave: (dir: string) => Promise<void>;
}) {
  const [dir, setDir] = useState(defaultTargetDir);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDir(defaultTargetDir), [defaultTargetDir]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(dir.trim());
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const dirty = dir.trim() !== defaultTargetDir;

  return (
    <div className="panel">
      <b>기본 저장소</b>
      <div className="muted small" style={{ marginTop: 4, marginBottom: 8 }}>
        이 프로젝트의 새 작업에 자동으로 채워집니다.
      </div>
      <RepoPicker
        value={dir}
        repos={repos}
        onChange={(v) => {
          setDir(v);
          setSaved(false);
        }}
      />
      <div className="row" style={{ marginTop: 8, gap: 8, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={saving || !dirty}>
          {saving ? "저장 중…" : "저장"}
        </button>
        {saved && !dirty && <span className="muted small">✅ 저장됨</span>}
      </div>
    </div>
  );
}
