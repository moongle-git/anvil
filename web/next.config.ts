import path from "node:path";
import type { NextConfig } from "next";

// 모노레포 루트(../)의 src/types를 단일 소스로 import한다 (ADR-006)
const workspaceRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  experimental: {
    // web/ 밖(루트 src/)의 TS 소스를 컴파일 대상에 포함
    externalDir: true,
    // 루트 src는 NodeNext라 상대 import에 .js 확장자를 쓴다 — 번들러가 .ts로 대체 해석하게 한다.
    // extensionAlias·externalDir 모두 webpack 전용 옵션이라 dev/build를 --webpack으로 실행한다 (package.json scripts)
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  // 정적 프리렌더된 페이지의 HTML을 브라우저가 붙들지 못하게 한다.
  //
  // Next는 ○(Static) 라우트에 `Cache-Control: s-maxage=31536000`만 실어 보낸다. s-maxage는
  // **공유 캐시 전용**이라 브라우저에는 freshness 지시가 하나도 없는 응답이고, 그러면 브라우저는
  // 휴리스틱 캐싱으로 넘어가 임의의 기간 동안 낡은 HTML을 재사용한다. 배포 후 그 HTML이
  // 가리키는 /_next/static 청크는 이미 파일명이 바뀌어 사라졌으므로 404가 나고,
  // 화면에는 "This page couldn't load"만 뜬다 — 원인이 캐시라는 단서가 어디에도 없다.
  //
  // no-cache는 "저장하지 마라"가 아니라 "쓰기 전에 재검증하라"다. ETag가 함께 나가므로
  // 바뀐 게 없으면 304로 끝나 대역폭 손해는 사실상 없다.
  //
  // /_next/static/*는 **건드리지 않는다.** 콘텐츠 해시가 파일명에 있어 빌드마다 이름이 바뀌므로
  // immutable이 정확하고, 여기에 no-cache를 걸면 매 배포가 아니라 매 요청마다 재검증하게 된다.
  //
  // ƒ(Dynamic) 라우트도 뺀다 — 이미 no-store, must-revalidate가 붙어 있어서 여기 포함시키면
  // 오히려 no-cache로 **약화된다**. 아래 목록이 정적 라우트로 한정된 이유다.
  // 새 정적 페이지를 추가하면 이 목록에도 넣어야 한다 (`npm run build` 출력의 ○ 표시가 기준).
  async headers() {
    return ["/", "/compare"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "no-cache" }],
    }));
  },
};

export default nextConfig;
