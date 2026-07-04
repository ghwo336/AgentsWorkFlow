// 화면 오류 문구 공용 헬퍼 — Error면 그 메시지, 아니면 한국어 fallback 문구.
// (컴포넌트마다 반복되던 `err instanceof Error ? err.message : "..."` 패턴.)
export function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
