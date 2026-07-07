import Link from "next/link";
import { EmptyState } from "@/components/ui";

// 비교 불가 상황(파라미터 누락/동일 id/404/미완료) 공통 안내 + 홈 링크
export function CompareGuard({ message }: { message: string }) {
  return (
    <EmptyState
      title="비교할 수 없습니다"
      description={message}
      action={
        <Link
          href="/"
          className="text-sm font-medium text-blue-700 underline-offset-4 hover:underline"
        >
          홈으로 돌아가기
        </Link>
      }
    />
  );
}
