"use client";

import { type CSSProperties, type FormEvent, useState } from "react";
import { LogoMark } from "../lib/agents";

// 로그인 화면 — Basic Auth 브라우저 프롬프트를 대체한다 (PWA standalone에서
// 매 실행마다 프롬프트가 뜨는 문제). 성공하면 /api/login이 세션 쿠키를 심고,
// proxy.ts가 그 쿠키로 통과시킨다.
export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `로그인 실패 (${r.status})`);
      }
      // 원래 가려던 곳으로 (미들웨어가 ?next=에 실어 보낸다). 외부 URL 주입은
      // same-origin 경로만 허용해서 차단.
      const next = new URLSearchParams(location.search).get("next");
      location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: "min(340px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          background: "var(--panel)",
          border: "2px solid var(--border)",
          boxShadow: "var(--px-shadow)",
          padding: "28px 24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <LogoMark size={30} />
          <b className="pixel" style={{ fontSize: 18 }}>LoopWorks</b>
        </div>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="아이디"
          autoComplete="username"
          autoCapitalize="none"
          required
          style={inputStyle}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoComplete="current-password"
          required
          style={inputStyle}
        />
        {error && <div style={{ color: "var(--red)", fontSize: 13 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ padding: "10px 12px", cursor: "pointer" }}>
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}

const inputStyle: CSSProperties = {
  background: "var(--panel-2)",
  border: "2px solid var(--border)",
  color: "var(--text)",
  padding: "10px 12px",
  font: "inherit",
  outline: "none",
};
