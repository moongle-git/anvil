# Step 2: deploy-script

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` — ADR-007(CLI spawn), ADR-014(SQLite·WAL)
- `deploy/anvil-web.service` — step 0이 만들었다. **서비스명·배포 경로·실행 사용자를 여기서 읽어와 스크립트에 반영하라**
- `/package.json` — `build` 스크립트가 루트 `tsc` + `web` 빌드를 모두 도는 것을 확인하라
- `web/next.config.ts` — `externalDir`·`extensionAlias`로 **루트 `src/`를 빌드 대상에 포함**한다는 사실을 확인하라
- `scripts/` — 기존 스크립트(`migrateRuns.ts`)의 위치와 관례

## 배경

배포는 `git pull → npm ci → npm run build → systemctl restart` 네 단계다. 스크립트로 만드는 이유는 자동화보다 **매번 같은 순서로 도는 것을 보장하기 위해서**다.

### 반드시 devDependencies를 설치해야 한다 (조용한 실패 지점)

`npm run consult`는 `tsx`로 TypeScript 소스를 직접 실행한다. **`tsx`는 devDependency다.** 그리고 `npm run build`는 `tsc`와 `next build`를 쓰는데 이들도 전부 devDependency다.

만약 `npm ci --omit=dev`로 설치하면:
- 빌드 자체가 실패하고(이건 시끄럽게 실패하니 그나마 낫다),
- 설령 빌드된 산출물을 들고 왔더라도 **`spawnConsult`가 `stdio: "ignore"`로 자식을 띄우기 때문에 CLI 실행 실패가 아무 로그도 남기지 않는다.** 웹은 runId를 정상 응답하고, run은 영원히 `pending`에 머문다. 원인을 찾기 극도로 어려운 종류의 실패다.

**따라서 이 스크립트는 devDependencies를 포함해 설치한다.** `--omit=dev`, `--production`, `NODE_ENV=production npm ci`를 쓰지 마라 (마지막 것은 npm이 devDeps를 자동으로 건너뛴다).

### 실행 중인 run을 밟지 마라

step 0의 `KillMode=process` 덕분에 재시작해도 진행 중인 CLI는 죽지 않는다. 그러나 **빌드는 그 프로세스가 읽고 있는 파일을 갈아엎는다.** `tsx`는 소스를 실행 중에 읽으므로, 배포 중인 run은 예측 불가능한 상태가 된다.

그래서 배포 전에 실행 중인 consult 프로세스를 확인하고, 있으면 **중단한다**(`--force`로 건너뛸 수 있게). 확인은 DB 상태 파생 규칙을 재구현하지 말고 프로세스 목록으로 하라 — `pgrep -f`로 consult CLI 패턴을 찾는다. 이유: run 상태 파생은 PRD가 소유한 규칙이고(15분 stall 임계 등) 셸에서 재구현하면 두 개의 진실이 된다.

## 작업

### `scripts/deploy.sh` (신규)

서버에서 실행하는 배포 스크립트.

```bash
#!/usr/bin/env bash
set -euo pipefail
```

수행 순서:

1. **선행 확인** — 배포 경로가 맞는지, git 워킹트리가 깨끗한지(더러우면 중단; 서버에서 직접 수정한 것을 조용히 날리지 않는다)
2. **실행 중 run 확인** — `pgrep`으로 consult 프로세스 탐지. 있으면 개수와 함께 경고 후 exit. `--force` 플래그로 우회 가능
3. `git pull --ff-only` — merge commit을 서버에서 만들지 않는다
4. `npm ci` — **devDeps 포함.** 위 배경 참조
5. `npm run build`
6. `sudo systemctl restart <서비스명>` — step 0이 정한 이름
7. **사후 확인** — `systemctl is-active`로 서비스가 실제로 떴는지 확인하고, 실패면 non-zero로 종료

요구 사항:

- **멱등이어야 한다.** 변경이 없을 때 두 번 돌려도 같은 결과여야 한다.
- **각 단계를 출력하라.** 사람이 보면서 실행하는 스크립트다. 어디서 멈췄는지 알아야 한다.
- **실패하면 즉시 non-zero로 죽어라** (`set -e`). 빌드가 깨졌는데 restart까지 가면 서비스가 내려간다.
- `--force`, `--help` 정도의 최소 플래그만. 옵션 파서를 만들지 마라.

### DB는 건드리지 않는다

이 스크립트는 **마이그레이션을 실행하지 않는다.** `openDb`의 DDL이 전부 `IF NOT EXISTS`이고 스키마 시딩이 멱등이라(ARCHITECTURE "DB 스키마"), 앱이 켜지면서 알아서 정리된다. **마이그레이션 러너는 이 프로젝트에 없다** — 만들지 마라.

백업도 이 스크립트의 책임이 아니다. WAL 모드 SQLite는 `-wal`/`-shm`이 함께 있어야 정합하므로 단순 `cp`가 안전하지 않다. 백업이 필요하면 런북(step 3)에서 `sqlite3 .backup` 또는 `VACUUM INTO`로 다룬다.

## 불변식

- **`npm ci`에서 devDependencies를 빼지 마라.** 이유: `tsx`가 사라지면 spawn이 `stdio: "ignore"` 뒤에서 조용히 실패한다. run이 영원히 pending에 멈추고 로그가 없다.
- **`git pull`에 `--ff-only`를 쓰라.** 이유: 서버에서 merge commit이 생기면 다음 배포가 충돌한다.
- **run 상태 파생 로직을 셸로 재구현하지 마라.** 이유: PRD가 소유한 규칙이다. 프로세스 존재 확인으로 충분하다.
- **`rm -rf`로 무언가를 지우지 마라.** 특히 `data/`. 이유: 그 안에 유일한 DB가 있다.

## Acceptance Criteria

```bash
npm run build
npm test
test -x scripts/deploy.sh || test -f scripts/deploy.sh
bash -n scripts/deploy.sh
grep -q 'set -euo pipefail' scripts/deploy.sh
grep -q 'ff-only' scripts/deploy.sh
! grep -qE 'omit=dev|--production' scripts/deploy.sh
! grep -q 'rm -rf' scripts/deploy.sh
```

`shellcheck`이 설치되어 있으면 `shellcheck scripts/deploy.sh`도 돌려라. 없으면 건너뛰고 **건너뛴 사실을 summary에 적어라.**

파일에 실행 권한을 부여하라 (`chmod +x scripts/deploy.sh`) — git이 mode 변경을 추적한다.

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트:
   - 앱 소스(`src/`, `web/src/`)를 한 줄도 수정하지 않았는가?
   - 스크립트가 서비스명·경로를 step 0의 유닛 파일과 **일치**시켰는가? (불일치하면 배포가 엉뚱한 서비스를 재시작한다)
   - 마이그레이션 러너를 만들지 않았는가?
3. `phases/9-deploy/index.json`의 step 2를 업데이트한다. summary에 **스크립트 경로·지원 플래그·전제하는 sudo 권한**을 적어라 — step 3의 런북이 sudoers 설정을 안내해야 한다.

## 금지사항

- **CI/CD(GitHub Actions) 워크플로를 만들지 마라.** 이유: 서버에서 빌드하기로 결정했다. SSH 키·시크릿·러너 아키텍처 매칭은 이 phase의 범위가 아니다.
- **앱 코드를 수정하지 마라.**
- **`.env`나 실제 시크릿을 스크립트에 넣지 마라.** 이유: 커밋된다. 환경변수는 systemd `EnvironmentFile`이 소유한다.
- **롤백·블루그린·헬스체크 폴링 같은 것을 넣지 마라.** 이유: 단일 사용자 내부 도구다. 다운타임 몇 초가 문제되지 않는다. 복잡도만 는다.
- **기존 테스트를 깨뜨리지 마라.**
