import { Button } from "./Button";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

// fetch 실패 등 오류 상황 공통 표시 — 에러 카드 + "다시 시도" 버튼 (모든 화면 일관).
export function ErrorState({
  title = "문제가 발생했습니다",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-md border border-red-200 bg-red-50 px-6 py-12 text-center"
    >
      <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      {message ? (
        <p className="text-[15px] leading-relaxed text-neutral-700">{message}</p>
      ) : null}
      {onRetry ? (
        <div className="mt-1">
          <Button variant="secondary" onClick={onRetry}>
            다시 시도
          </Button>
        </div>
      ) : null}
    </div>
  );
}
