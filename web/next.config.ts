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
};

export default nextConfig;
