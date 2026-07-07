"use client";

import { useSearchParams } from "next/navigation";
import { CompareGuard } from "./CompareGuard";
import { CompareLoader } from "./CompareLoader";

export function CompareClient() {
  const params = useSearchParams();
  const a = params.get("a");
  const b = params.get("b");

  if (!a || !b || a === b) {
    return (
      <CompareGuard message="비교하려면 서로 다른 두 개의 완료된 run이 필요합니다." />
    );
  }

  return <CompareLoader a={a} b={b} />;
}
