"use client";

import { useState } from "react";
import { SectionHeading } from "@/components/ui";
import { IdeaForm } from "./IdeaForm";
import { RunList } from "./RunList";

// 폼과 빈 상태 예시 버튼이 아이디어 텍스트를 공유하므로 상태를 여기서 소유한다.
export function HomeClient() {
  const [idea, setIdea] = useState("");

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          새 컨설팅 시작
        </h1>
        <p className="max-w-3xl text-[15px] leading-relaxed text-neutral-700">
          비즈니스 아이디어를 입력하면 실시간 시장 데이터를 근거로 냉정한 비판과
          AI 네이티브 재설계안을 담은 컨설팅 리포트를 생성합니다.
        </p>
        <IdeaForm idea={idea} onIdeaChange={setIdea} />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>실행 이력</SectionHeading>
        <RunList onPickExample={setIdea} />
      </section>
    </div>
  );
}
