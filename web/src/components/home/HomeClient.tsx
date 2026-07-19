"use client";

import { useState } from "react";
import { SectionHeading } from "@/components/ui";
import { IdeaForm } from "./IdeaForm";
import { RunList } from "./RunList";
import { ScoutForm } from "./ScoutForm";

// 두 모드는 "주제를 이미 아는가"로 갈린다. 직접 입력이 기본이다 — 주제 발굴은 추가된 경로이지
// 대체된 경로가 아니라서, 기존 사용자의 첫 화면이 바뀌면 안 된다.
const MODES = [
  {
    id: "idea" as const,
    label: "직접 입력",
    description:
      "비즈니스 아이디어를 입력하면 실시간 시장 데이터를 근거로 냉정한 비판과 AI 네이티브 재설계안을 담은 컨설팅 리포트를 생성합니다.",
  },
  {
    id: "scout" as const,
    label: "주제 찾기",
    description:
      "검증할 아이디어가 아직 없다면, 최근 자본 흐름(투자·기존 기업·규제·비용 곡선)에서 주제 후보를 찾아옵니다. 후보를 고르면 그 주제로 컨설팅이 이어집니다.",
  },
];

type ModeId = (typeof MODES)[number]["id"];

// 폼과 빈 상태 예시 버튼이 아이디어 텍스트를 공유하므로 상태를 여기서 소유한다.
// 범위 힌트도 같은 이유로 여기 둔다 — 모드를 오가도 입력이 날아가지 않는다.
export function HomeClient() {
  const [mode, setMode] = useState<ModeId>("idea");
  const [idea, setIdea] = useState("");
  const [scope, setScope] = useState("");

  const active = MODES.find((item) => item.id === mode) ?? MODES[0];

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          새 컨설팅 시작
        </h1>

        {/* 탭은 장식이 아니라 두 입력 계약의 구분이다. 색을 쓰지 않고 굵기 + 하단 보더로만
            현재 위치를 표시한다 (UI_GUIDE 원칙 3 — 색은 데이터의 의미에만). */}
        <div
          role="tablist"
          aria-label="시작 방식"
          className="flex gap-1 border-b border-neutral-200"
        >
          {MODES.map((item) => {
            const selected = item.id === mode;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMode(item.id)}
                className={[
                  "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                  selected
                    ? "border-neutral-900 font-medium text-neutral-900"
                    : "border-transparent text-neutral-500 hover:text-neutral-900",
                ].join(" ")}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <p className="max-w-3xl text-[15px] leading-[1.8] text-neutral-700">
          {active.description}
        </p>

        {mode === "idea" ? (
          <IdeaForm idea={idea} onIdeaChange={setIdea} />
        ) : (
          <ScoutForm scope={scope} onScopeChange={setScope} />
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>실행 이력</SectionHeading>
        <RunList onPickExample={setIdea} />
      </section>
    </div>
  );
}
