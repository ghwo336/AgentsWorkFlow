import type { MetadataRoute } from "next";

// PWA 매니페스트 — iOS/Android 홈 화면 설치 시 standalone(주소창 없는 전체화면)
// 앱으로 뜨게 한다. proxy.ts가 이 경로(/manifest.webmanifest)를 인증 예외로
// 두는 이유: 브라우저가 매니페스트를 쿠키 없이 가져가는 경우가 있어서다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LoopWorks",
    short_name: "LoopWorks",
    description: "기획 → 개발 → 검증 → 커밋, AI 에이전트 팀 대시보드",
    start_url: "/",
    display: "standalone",
    background_color: "#12141c",
    theme_color: "#12141c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // 일반 아이콘은 풀블리드(봇이 캔버스 가득), maskable만 여백판 — 원형
      // 마스크의 safe zone(중심 반경 40%) 밖이 잘려나가기 때문.
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
