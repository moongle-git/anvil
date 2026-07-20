#!/usr/bin/env bash
#
# anvil 배포 스크립트 — Phase 9-deploy
#
#   ssh 로 서버에 들어가 anvil 사용자로 실행한다:
#     cd /opt/anvil && ./scripts/deploy.sh
#
# git pull → npm ci → npm run build → systemctl restart 네 단계를 매번 같은 순서로 돌린다.
# 자동화가 목적이 아니라 **순서 보장**이 목적이다. 사람이 출력을 보면서 실행하는 스크립트다.
#
# sudo 가 필요한 지점은 단 하나다: systemctl restart anvil-web (7단계).
# 나머지는 전부 배포 사용자 권한으로 돈다. sudoers 설정은 docs/DEPLOY.md 가 안내한다.
# **sudo 지점을 늘리지 마라** — 6단계가 stop/start 대신 kill 로 포트를 비우는 이유가 그것이다.
#
# 이 스크립트가 하지 않는 것:
#   - DB 마이그레이션. openDb 의 DDL 이 전부 IF NOT EXISTS 이고 스키마 시딩이 멱등이라
#     앱이 켜지면서 알아서 정리된다. 이 프로젝트에 마이그레이션 러너는 없다 (ARCHITECTURE).
#   - 백업. WAL 모드 SQLite 는 -wal/-shm 이 함께 있어야 정합해서 cp 가 안전하지 않다.
#     백업은 sqlite3 .backup / VACUUM INTO 로 런북이 다룬다 (docs/DEPLOY.md).
#   - 롤백. 단일 사용자 내부 도구다. 다운타임 몇 초는 문제가 아니다.
#
# 헬스체크는 **한다**. 원래는 이것도 비목표였는데, is-active 만 보던 확인이 크래시 루프를
# 통과시켜 "배포 성공" 을 찍고 끝난 사고가 있었다. 8단계는 실제 HTTP 응답을 기다린다.

set -euo pipefail

# step 0 의 deploy/anvil-web.service 와 반드시 일치해야 하는 두 값이다.
# 어긋나면 이 체크아웃을 빌드해놓고 엉뚱한 트리를 서비스하는 유닛을 재시작하게 된다.
readonly SERVICE="anvil-web"
readonly EXPECTED_ROOT="/opt/anvil"

FORCE=0

usage() {
  cat <<'EOF'
사용법: ./scripts/deploy.sh [--force] [--help]

  --force   선행 확인(배포 경로 일치·실행 중인 run 탐지)을 건너뛴다.
            워킹트리가 더러운 것은 건너뛰지 않는다 — 서버에서 직접 고친 것을 날리지 않기 위해서다.
  --help    이 도움말.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "알 수 없는 인자: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31m배포 중단: %s\033[0m\n' "$1" >&2; exit 1; }

# cwd 가 어디든 레포 루트에서 돌게 만든다. 스크립트 자신의 위치가 기준이다.
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── 1. 선행 확인 ──────────────────────────────────────────────────────────────
step "1/8 선행 확인"
echo "레포 루트: $REPO_ROOT"

if [[ "$REPO_ROOT" != "$EXPECTED_ROOT" ]]; then
  if [[ $FORCE -eq 0 ]]; then
    fail "배포 경로가 $EXPECTED_ROOT 이 아니다 (현재: $REPO_ROOT).
  systemd 유닛(anvil-web.service)의 WorkingDirectory 는 $EXPECTED_ROOT 이므로,
  여기서 빌드하고 서비스를 재시작하면 빌드한 트리와 서비스하는 트리가 달라진다.
  의도한 것이라면 --force 로 진행하라."
  fi
  echo "경고: 배포 경로 불일치를 --force 로 건너뛴다 (기대: $EXPECTED_ROOT)"
fi

git rev-parse --git-dir >/dev/null 2>&1 || fail "git 레포가 아니다: $REPO_ROOT"

# 서버에서 직접 수정한 것을 조용히 날리지 않는다. 이 확인은 --force 로도 건너뛰지 않는다.
# .env.production·data/ 는 .gitignore 에 있어 여기 잡히지 않는다.
dirty="$(git status --porcelain)"
if [[ -n "$dirty" ]]; then
  printf '%s\n' "$dirty" >&2
  fail "워킹트리가 깨끗하지 않다. 위 변경을 커밋하거나 되돌린 뒤 다시 실행하라."
fi
echo "워킹트리 깨끗함"

# ── 2. 실행 중인 run 확인 ─────────────────────────────────────────────────────
step "2/8 실행 중인 consult 프로세스 확인"

# run 상태 파생 규칙(15분 stall 임계 등)은 PRD 가 소유한다. 셸에서 재구현하면 두 개의 진실이 된다.
# 여기서는 프로세스 존재만 본다 — 빌드가 갈아엎을 파일을 지금 읽고 있는 프로세스가 있는가.
# tsx 는 소스를 실행 중에 읽으므로(npm run consult), 배포는 진행 중인 run 을 예측 불가 상태로 만든다.
# systemd 의 KillMode=process 가 살려두는 바로 그 프로세스다.
running_pids="$(pgrep -f 'src/cli/index\.ts' || true)"
if [[ -n "$running_pids" ]]; then
  count="$(printf '%s\n' "$running_pids" | wc -l | tr -d ' ')"
  if [[ $FORCE -eq 0 ]]; then
    fail "진행 중인 consult 프로세스가 ${count}개 있다 (PID: $(echo "$running_pids" | tr '\n' ' ')).
  지금 배포하면 그 run 이 읽고 있는 소스가 교체되어 결과를 예측할 수 없다.
  run 하나는 Gemini 실비를 태우며 최악 6분까지 돈다 (ADR-012, ADR-016).
  끝날 때까지 기다리거나, 감수한다면 --force 로 진행하라."
  fi
  echo "경고: 진행 중인 consult ${count}개를 --force 로 무시한다"
else
  echo "진행 중인 consult 없음"
fi

# ── 3. 코드 갱신 ──────────────────────────────────────────────────────────────
step "3/8 git pull --ff-only"
# --ff-only: 서버에서 merge commit 을 만들지 않는다. 한 번 생기면 다음 배포가 충돌한다.
git pull --ff-only

# ── 4. 의존성 설치 ────────────────────────────────────────────────────────────
step "4/8 npm ci (devDependencies 포함)"
# devDeps 를 빼면 안 된다. 두 가지가 devDependency 다:
#   - tsx        : npm run consult 가 TypeScript 소스를 직접 실행하는 데 쓴다
#   - tsc/next   : npm run build 자체
# tsx 가 없으면 빌드는 시끄럽게 실패하지만, 그보다 나쁜 경우가 있다 — spawnConsult 는
# stdio:"ignore" 로 자식을 띄우므로(ADR-007) CLI 실행 실패가 아무 로그도 남기지 않는다.
# 웹은 runId 를 정상 응답하고 run 은 영원히 pending 에 머문다. 원인을 찾기 극히 어렵다.
# --include=dev 를 명시하는 이유: 셸 환경에 NODE_ENV=production 이 새어 들어와 있으면
# npm 이 devDeps 를 조용히 건너뛴다. 이 플래그가 그것을 무력화한다.
npm ci --include=dev

# ── 5. 빌드 ───────────────────────────────────────────────────────────────────
step "5/8 npm run build"
# 루트 tsc + web(next build) 를 함께 돈다. next.config.ts 의 externalDir 때문에
# web 빌드가 루트 src/ 까지 컴파일 대상에 넣는다.
# 여기서 실패하면 set -e 가 즉시 죽인다 — 깨진 빌드로 restart 까지 가면 서비스가 내려간다.
npm run build

# ── 6. 남은 next-server 정리 ─────────────────────────────────────────────────
step "6/8 :3000 을 잡고 있는 next-server 정리"

# **이 단계가 없으면 재시작이 조용히 실패한다.** 유닛의 KillMode=process 는 systemd 가 아는
# 메인 프로세스만 죽인다. 그런데 ExecStart 가 `npm run start -w web` 이라 메인은 **npm 래퍼**이고,
# 실제로 :3000 을 bind 하는 next-server 는 그 자식이다. 즉 재시작 때 npm 만 사라지고
# next-server 는 고아로 살아남아 포트를 계속 쥔다. 새 인스턴스는 EADDRINUSE 로 죽고,
# Restart=on-failure 가 5초마다 무한 재시도한다 (실제로 417 회까지 돈 적이 있다).
#
# 그동안 고아는 **옛 코드로 정상 응답한다.** 그래서 증상이 "배포했는데 변경사항이 없다" 로만
# 보이고, 디스크의 .next 는 새 빌드로 갈린 뒤라 옛 BUILD_ID 청크가 404 나면서
# 캐시가 걷히는 순간 페이지가 통째로 깨진다. 원인을 짐작하기 대단히 어렵다.
#
# KillMode=process 자체는 바꾸지 않는다 — 진행 중인 consult 자식을 지키려고 고른 값이다(ADR-007).
# 여기서는 재시작 직전에 포트만 확실히 비운다.
#
# stop/start 로 나누지 않고 restart 를 유지하는 이유는 sudoers 다. 배포 사용자에게 허용된 것은
# `systemctl restart anvil-web` **하나뿐이고**(docs/DEPLOY.md), 늘리면 이 스크립트가 권한에서 막힌다.
# next-server 와 배포 사용자가 둘 다 anvil 이라 kill 에는 sudo 가 필요 없다.

port_pids() {
  # -H: 헤더 제거. users:(("next-server (v1",pid=108761,fd=21)) 에서 pid 만 뽑는다.
  # ss 는 같은 사용자의 소켓만 프로세스 정보를 보여주는데, 여기서는 둘 다 anvil 이라 충분하다.
  ss -lptnH 'sport = :3000' 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
}

leftover="$(port_pids || true)"
if [[ -z "$leftover" ]]; then
  echo ":3000 이미 비어 있음"
else
  for pid in $leftover; do
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    # consult 는 :3000 을 bind 하지 않으므로 여기 잡히면 전제가 틀린 것이다.
    # 조용히 죽이면 Gemini 실비를 태우던 run 이 흔적 없이 사라진다 — 멈추고 사람에게 넘긴다.
    if [[ "$args" == *"src/cli/index.ts"* ]]; then
      fail "PID $pid 는 consult 인데 :3000 을 잡고 있다. 전제가 깨졌으니 수동으로 확인하라."
    fi
    echo "  SIGTERM → PID $pid ($args)"
    kill "$pid" 2>/dev/null || true
  done

  # 종료를 기다린다. RestartSec=5 안에 끝내야 systemd 의 자동 재시작과 겹치지 않는다.
  for _ in 1 2 3; do
    [[ -z "$(port_pids)" ]] && break
    sleep 1
  done
  for pid in $(port_pids); do
    echo "  SIGTERM 무시 — SIGKILL → PID $pid"
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1

  if [[ -n "$(port_pids)" ]]; then
    fail ":3000 을 비우지 못했다. 수동 확인: ss -lptn 'sport = :3000'"
  fi
  echo ":3000 비움"
fi

# ── 7. 서비스 재시작 ──────────────────────────────────────────────────────────
step "7/8 systemctl restart $SERVICE"
# 유닛의 KillMode=process 덕분에 진행 중인 consult 자식은 이 재시작에서 죽지 않는다.
sudo systemctl restart "$SERVICE"

# ── 8. 사후 확인 ──────────────────────────────────────────────────────────────
step "8/8 기동 확인"

# **is-active 만으로는 부족하다.** 크래시 루프 중인 유닛은 재시작 사이에 activating 과 failed 를
# 오가므로, 타이밍이 맞으면 죽어가는 서비스가 이 검사를 통과한다. 이번 사고가 정확히 그랬다.
# 그래서 실제로 HTTP 응답을 받을 때까지 기다린다. Caddy 의 basic auth 는 엣지에 있으므로
# localhost:3000 직접 요청에는 붙지 않는다 — 200 이 나와야 정상이다.
deadline=$((SECONDS + 60))
until curl -fsS -o /dev/null -m 3 "http://localhost:3000/"; do
  if (( SECONDS >= deadline )); then
    echo "현재 상태: $(systemctl is-active "$SERVICE" || true)" >&2
    echo "재시작 횟수: $(systemctl show "$SERVICE" -p NRestarts --value || true)" >&2
    echo "로그: sudo journalctl -u $SERVICE -n 50 --no-pager" >&2
    fail "$SERVICE 가 60초 안에 응답하지 않았다."
  fi
  sleep 2
done

# 재시작 횟수가 쌓여 있으면 지금은 떠 있어도 루프를 돌다 우연히 성공한 것일 수 있다.
# 실패로 보지는 않되(정상 배포에서도 누적된다) 사람이 볼 수 있게 남긴다.
restarts="$(systemctl show "$SERVICE" -p NRestarts --value 2>/dev/null || true)"
if [[ -n "$restarts" && "$restarts" != "0" ]]; then
  echo "참고: 유닛 누적 재시작 횟수 $restarts (크래시 루프였다면 journalctl 로 확인하라)"
fi

printf '\n\033[32m배포 완료 — %s 응답 확인 (%s)\033[0m\n' "$SERVICE" "$(git rev-parse --short HEAD)"
