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
  },
};

export default nextConfig;
