# Step 3: runbook

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/ARCHITECTURE.md`(전체), `/docs/PRD.md`
- `/docs/ADR.md` — ADR-007, ADR-012(수집 최악 6분), ADR-014(SQLite·WAL·PRAGMA), ADR-016(비용)
- **이전 step들의 산출물 전부** — 런북은 이들을 서버에 어떻게 배치하는지 설명하는 문서다:
  - `deploy/anvil-web.service`
  - `deploy/.env.production.example`
  - `deploy/Caddyfile.example`
  - `deploy/README.md`
  - `scripts/deploy.sh`
- `src/lib/db.ts` — `openDb`의 PRAGMA 설정과 `IF NOT EXISTS` DDL. **DB 초기화가 왜 별도 절차를 필요로 하지 않는지**를 눈으로 확인하라
- `web/src/lib/server/runs.ts` — `getDbPath()`·`getRepoRoot()`

## 배경

이 step은 **사람이 서버 앞에서 따라 실행할 문서**를 만든다. 앞선 step들이 만든 파일 조각을 실제로 동작하는 배포로 조립하는 유일한 지점이다.

이 문서의 독자는 6개월 뒤의 작성자 본인이다. **"알아서 하면 되는" 부분을 생략하지 마라** — 그 생략이 6개월 뒤에 두 시간을 잡아먹는다.

### 반드시 들어가야 할 함정 세 가지

이것들은 실제로 사람을 오래 붙잡는 것들이다. 문서에서 눈에 띄게 다뤄라.

**1. OCI는 방화벽이 두 겹이다.** VCN Security List에서 80/443 ingress를 열어도 **인스턴스 내부의 iptables가 여전히 막는다.** OCI의 Ubuntu 이미지는 22번 외를 차단하는 규칙을 기본 탑재한다. 콘솔에서 포트를 열어놓고 접속이 안 돼 한참 헤매는 것이 이 단계의 단골이다. 두 곳 모두 열어야 하며, iptables 규칙은 재부팅 후에도 남도록 저장해야 한다(`netfilter-persistent save`).

**2. Node 버전.** 이 프로젝트는 `node:sqlite`의 `DatabaseSync`를 쓴다(ADR-014). Ubuntu apt 기본 저장소의 node로는 동작하지 않는다. **NodeSource 저장소나 nvm으로 Node 24를 설치**해야 한다. 또한 systemd는 로그인 셸이 아니라 nvm이 깐 node를 `PATH`에서 찾지 못한다 — 유닛 파일이 절대 경로를 쓰는 이유다(step 0).

**3. spawn 실패는 조용하다.** `spawnConsult`는 `stdio: "ignore"`로 자식을 띄운다. CLI 실행이 실패해도 **로그가 한 줄도 남지 않고**, 웹은 runId를 정상 응답하며, run은 영원히 `pending`에 머문다. 트러블슈팅 절에서 이것을 진단하는 법을 반드시 다뤄라: 서버에서 `anvil` 사용자로 `npm run consult -- --resume <runId>`를 **직접** 실행해 실제 에러를 눈으로 보는 것이 유일하게 확실한 방법이다.

## 작업

### `docs/DEPLOY.md` (신규)

다음 순서로 구성한다. 각 절은 복사해 붙여넣을 수 있는 커맨드를 포함해야 한다.

1. **전제와 범위**
   - 단일 VM에만 배포 가능한 이유(spawn + 로컬 SQLite). 수평 확장 불가를 명시
   - 접근 통제는 Caddy basic auth이며 앱에는 인증이 없다는 것
   - 권장 인스턴스: OCI Ampere A1(arm64). Always Free 한도(4 OCPU/24GB)면 서버 빌드가 넉넉하다. **AMD micro(1GB)는 `next build`에 부족하다**는 점을 경고

2. **서버 준비**
   - 인스턴스 생성, ssh 접속
   - VCN Security List ingress 80/443
   - **인스턴스 iptables 개방 + 영구 저장** ← 위 함정 1
   - Node 24 설치(NodeSource), `node -v`로 확인
   - git, caddy 설치
   - `anvil` 시스템 사용자 생성

3. **애플리케이션 배치**
   - `/opt/anvil`로 clone, 소유권을 `anvil`에게
   - `deploy/.env.production.example` → `/opt/anvil/.env.production` 복사 후 실제 키 입력, **`chmod 600` + 소유자 `anvil`**
   - `npm ci` → `npm run build` (첫 배포는 스크립트 없이 수동으로 밟아보게 하라 — 어디서 깨지는지 봐야 한다)

4. **DB 초기화**
   - **별도 마이그레이션이 필요 없다**는 것을 명시. `openDb`의 DDL이 전부 `IF NOT EXISTS`이고 시딩이 멱등이라 앱이 켜지면 스키마가 생긴다
   - `data/` **디렉토리 자체의 쓰기 권한**이 `anvil`에게 있어야 한다. WAL 모드는 `-wal`/`-shm` 파일을 같은 디렉토리에 만들기 때문에, 파일 권한만 맞고 디렉토리 권한이 없으면 **읽기까지 실패한다**
   - 기본값은 **빈 DB로 새로 시작**이다. 로컬 기록 이관은 선택 절로 분리하고, WAL 때문에 단순 `cp`가 위험하므로 `sqlite3 <db> ".backup <out>"` 또는 `VACUUM INTO`로 정합 스냅샷을 뜬 뒤 옮기라고 안내하라

5. **systemd 등록**
   - 유닛 파일 배치 → `daemon-reload` → `enable --now`
   - `scripts/deploy.sh`가 `systemctl restart`를 부르므로 `anvil` 사용자에게 **그 커맨드 한정 NOPASSWD sudoers** 항목을 주는 법
   - `KillMode=process`가 무엇을 지키는지 한 문단 — 배포 중에도 진행 중인 run이 살아남는다

6. **Caddy 설정**
   - `caddy hash-password`로 해시 생성
   - `Caddyfile.example` → `/etc/caddy/Caddyfile`, 도메인/해시 채우기
   - 도메인이 없으면 `<공인IP>.sslip.io`
   - `caddy validate` → `systemctl reload caddy`
   - 인증서 발급 확인 (로그에서)

7. **검증**
   - `curl -I https://<호스트>/` → **401**이 나와야 정상 (막히고 있다는 증거)
   - `curl -I -u <user>:<pw> https://<호스트>/` → 200
   - 브라우저로 접속 → 아이디어 입력 → run 생성 → **진행 상태가 pending에서 실제로 넘어가는지 확인** (여기서 안 넘어가면 함정 3)
   - `journalctl -u <서비스명> -f`로 로그 보는 법

8. **재배포**
   - `scripts/deploy.sh` 사용법과 `--force` 의미

9. **트러블슈팅** — 최소한 다음을 다뤄라
   - run이 pending에서 안 넘어감 → spawn 조용한 실패. `anvil` 사용자로 CLI 직접 실행해 에러 확인. devDeps 누락(`tsx` 없음)이 가장 흔한 원인
   - 웹 목록이 비어 있음 → `ANVIL_DB_PATH` 불일치. 웹과 CLI가 서로 다른 DB 파일을 보고 있는 경우
   - `SQLITE_CANTOPEN`/`readonly` → `data/` 디렉토리 권한 (WAL)
   - 브라우저 접속 자체가 안 됨 → 함정 1(두 겹 방화벽)
   - Caddy가 뜨지 않음 → `basic_auth` vs `basicauth` 버전 차이
   - 인증서 발급 실패 → 80번 포트가 막혀 ACME 챌린지 실패

## 불변식

- **`docs/DEPLOY.md`가 배포 절차의 단일 진실 공급원이다.** `deploy/README.md`에 절차를 중복해서 쓰지 마라.
- **basic auth의 한계를 숨기지 마라.** 단일 공유 자격증명, 로그아웃 없음, TLS 없으면 무의미. 문서에 적어라.
- **커맨드는 복사 가능해야 한다.** "적절히 설정한다" 같은 서술로 때우지 마라.
- **이전 step이 확정한 경로·서비스명·포트를 그대로 써라.** 새로 지어내면 문서와 파일이 어긋난다.

## Acceptance Criteria

```bash
npm run build
npm test
test -f docs/DEPLOY.md
grep -q 'iptables' docs/DEPLOY.md
grep -q 'sslip.io' docs/DEPLOY.md
grep -q 'hash-password' docs/DEPLOY.md
grep -qi 'journalctl' docs/DEPLOY.md
grep -q 'KillMode=process' docs/DEPLOY.md
```

추가로 **문서에 등장하는 경로·서비스명이 `deploy/`의 실제 파일과 일치하는지 눈으로 대조하라.** 이건 grep으로 자동화되지 않는다. 불일치가 이 phase에서 가장 실패하기 쉬운 지점이다.

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트:
   - 앱 소스를 한 줄도 수정하지 않았는가?
   - 문서의 경로·서비스명·포트가 step 0~2 산출물과 **글자 그대로 일치**하는가?
   - 마이그레이션 러너를 만들라고 안내하지 않았는가? (이 프로젝트에는 없다)
3. `phases/9-deploy/index.json`의 step 3을 업데이트한다. summary에 **문서가 확정한 서버 경로·사용자·인스턴스 권장 사양**을 적어라.

## 금지사항

- **실제 도메인·IP·비밀번호·API 키를 문서에 적지 마라.** 이유: 커밋된다. 플레이스홀더만 쓴다.
- **앱 코드를 수정하지 마라.**
- **실제 서버에 SSH로 접속해 배포를 실행하지 마라.** 이유: 이 step의 산출물은 문서다. 첫 배포는 사람이 보는 앞에서 대화형으로 진행하기로 결정되어 있다. 서버 접속 정보가 필요하다고 판단되면 그것은 이 step의 범위를 벗어난 것이다
- **Docker·CI/CD·멀티유저 인증을 문서에서 권하지 마라.** 이유: 전부 명시적으로 기각된 방식이다.
- **기존 테스트를 깨뜨리지 마라.**
