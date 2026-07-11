/**
 * promise가 ms 내에 완료되지 않으면 시간 초과 에러로 reject한다.
 * 외부 API 호출이 응답 없이 무한 대기(hang)하면 파이프라인 step이 catch에도
 * 도달하지 못하고 "pending"에 고착되므로, 서비스 계층에서 반드시 시간 상한을 건다.
 * 원본이 먼저 완료/실패하면 그 결과를 그대로 전파하고 타이머를 정리한다.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} 시간 초과: ${ms}ms 내에 응답이 없었다`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}
