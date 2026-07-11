"use client";

import { useState } from "react";
import type { CompetitorService } from "@anvil/types";
import { Badge, Button } from "@/components/ui";

const INITIAL_VISIBLE = 8;

export function CompetitorTable({
  competitors,
}: {
  competitors: CompetitorService[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded
    ? competitors
    : competitors.slice(0, INITIAL_VISIBLE);
  const hiddenCount = competitors.length - visible.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[15px] text-neutral-700">
          <thead>
            <tr className="border-b border-neutral-200 text-xs font-medium text-neutral-500">
              <th className="py-2 pr-4 font-medium">이름</th>
              <th className="py-2 pr-4 font-medium">설명</th>
              <th className="py-2 pr-4 font-medium">가격</th>
              <th className="py-2 font-medium">URL (미검증)</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((competitor) => (
              <tr
                key={competitor.name}
                className="border-b border-neutral-100 align-top"
              >
                <td className="py-3 pr-4 font-medium text-neutral-900">
                  {competitor.name}
                </td>
                <td className="py-3 pr-4">{competitor.description}</td>
                <td className="py-3 pr-4">
                  {competitor.pricingHint ? (
                    <Badge tone="neutral">{competitor.pricingHint}</Badge>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="py-3">
                  {competitor.url ? (
                    // LLM이 타이핑한 URL이라 실측 60%가 죽어 있다. href를 걸면 "검증됐다"는 거짓
                    // 신호가 되므로 텍스트로만 남긴다 — 색도 링크색(blue)을 쓰지 않는다 (ADR-013)
                    <span
                      data-unverified-url
                      title="LLM 자기보고 URL — 검증되지 않아 링크를 걸지 않았습니다"
                      className="break-all text-xs text-neutral-500"
                    >
                      {competitor.url}
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 ? (
        <div>
          <Button variant="secondary" onClick={() => setExpanded(true)}>
            {hiddenCount}개 더보기
          </Button>
        </div>
      ) : null}
    </div>
  );
}
