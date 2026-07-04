"use client";

import { useCallback, useState } from "react";
import { ResearchTab } from "../_components/ResearchTab";
import { useOrchestratorEvents } from "../lib/hooks/useOrchestratorEvents";

// 리서치 섹션 — 예전엔 홈 안 탭이었지만 이제 독립 라우트(/research)다.
// ResearchTab이 SSE 이벤트마다 목록/스레드를 다시 읽도록 refreshKey를 배선한다
// (예전 HomeClient가 하던 역할).
export default function ResearchPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  useOrchestratorEvents(useCallback(() => setRefreshKey((n) => n + 1), []));
  return (
    <div className="wrap">
      <ResearchTab refreshKey={refreshKey} />
    </div>
  );
}
