"use client";

import { useEffect, useState } from "react";
import type { RunDetail } from "@/lib/server/runs";
import { CompareGuard } from "./CompareGuard";
import { CompareMatrix } from "./CompareMatrix";

async function fetchRunDetail(id: string): Promise<RunDetail | null> {
  const res = await fetch(`/api/runs/${id}`);
  if (res.status === 404) {
    return null; // 없는 run
  }
  if (!res.ok) {
    throw new Error("run을 불러오지 못했습니다.");
  }
  return (await res.json()) as RunDetail;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; a: RunDetail | null; b: RunDetail | null };

export function CompareLoader({ a, b }: { a: string; b: string }) {
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let ignore = false;
    Promise.all([fetchRunDetail(a), fetchRunDetail(b)])
      .then(([detailA, detailB]) => {
        if (!ignore) {
          setLoad({ phase: "ready", a: detailA, b: detailB });
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setLoad({
            phase: "error",
            message:
              err instanceof Error ? err.message : "run을 불러오지 못했습니다.",
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [a, b]);

  if (load.phase === "loading") {
    return (
      <p className="py-16 text-center text-sm text-neutral-500">불러오는 중…</p>
    );
  }
  if (load.phase === "error") {
    return <CompareGuard message={load.message} />;
  }

  if (load.a === null || load.b === null) {
    return (
      <CompareGuard message="존재하지 않는 run이 포함되어 있습니다." />
    );
  }
  if (load.a.status !== "completed" || load.b.status !== "completed") {
    return <CompareGuard message="완료된 run만 비교할 수 있습니다." />;
  }

  return <CompareMatrix a={load.a} b={load.b} />;
}
