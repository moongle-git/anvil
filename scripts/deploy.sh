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
# sudo 가 필요한 지점은 단 하나다: systemctl restart anvil-web (6단계).
# 나머지는 전부 배포 사용자 권한으로 돈다. sudoers 설정은 docs/DEPLOY.md 가 안내한다.
#
# 이 스크립트가 하지 않는 것:
#   - DB 마이그레이션. openDb 의 DDL 이 전부 IF NOT EXISTS 이고 스키마 시딩이 멱등이라
#     앱이 켜지면서 알아서 정리된다. 이 프로젝트에 마이그레이션 러너는 없다 (ARCHITECTURE).
#   - 백업. WAL 모드 SQLite 는 -wal/-shm 이 함께 있어야 정합해서 cp 가 안전하지 않다.
#     백업은 sqlite3 .backup / VACUUM INTO 로 런북이 다룬다 (docs/DEPLOY.md).
#   - 롤백·헬스체크 폴링. 단일 사용자 내부 도구다. 다운타임 몇 초는 문제가 아니다.

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
step "1/7 선행 확인"
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
step "2/7 실행 중인 consult 프로세스 확인"

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
step "3/7 git pull --ff-only"
# --ff-only: 서버에서 merge commit 을 만들지 않는다. 한 번 생기면 다음 배포가 충돌한다.
git pull --ff-only

# ── 4. 의존성 설치 ────────────────────────────────────────────────────────────
step "4/7 npm ci (devDependencies 포함)"
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
step "5/7 npm run build"
# 루트 tsc + web(next build) 를 함께 돈다. next.config.ts 의 externalDir 때문에
# web 빌드가 루트 src/ 까지 컴파일 대상에 넣는다.
# 여기서 실패하면 set -e 가 즉시 죽인다 — 깨진 빌드로 restart 까지 가면 서비스가 내려간다.
npm run build

# ── 6. 서비스 재시작 ──────────────────────────────────────────────────────────
step "6/7 systemctl restart $SERVICE"
# 유닛의 KillMode=process 덕분에 진행 중인 consult 자식은 이 재시작에서 죽지 않는다.
sudo systemctl restart "$SERVICE"

# ── 7. 사후 확인 ──────────────────────────────────────────────────────────────
step "7/7 서비스 상태 확인"
sleep 2  # Type=simple 은 exec 직후 돌아온다. 즉시 죽는 경우를 잡으려는 최소한의 안정화 대기다.
if ! systemctl is-active --quiet "$SERVICE"; then
  echo "현재 상태: $(systemctl is-active "$SERVICE" || true)" >&2
  echo "로그: sudo journalctl -u $SERVICE -n 50 --no-pager" >&2
  fail "$SERVICE 가 뜨지 않았다."
fi

printf '\n\033[32m배포 완료 — %s active (%s)\033[0m\n' "$SERVICE" "$(git rev-parse --short HEAD)"
