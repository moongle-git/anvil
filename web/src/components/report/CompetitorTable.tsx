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
              <th className="py-2 font-medium">링크</th>
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
                    <a
                      href={competitor.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-700 underline-offset-4 hover:underline"
                    >
                      바로가기
                    </a>
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
