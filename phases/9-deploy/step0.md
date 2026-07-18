# Step 0: systemd-unit

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/ARCHITECTURE.md` — 특히 "웹 UI 데이터 흐름 (1-web-ui)" 절
- `/docs/ADR.md` — **ADR-007**(웹의 파이프라인 실행은 CLI detached spawn), ADR-014(SQLite)
- `web/src/lib/server/spawnConsult.ts` — **이 step의 설계 전체가 이 19줄에 의존한다.** 눈으로 확인하라
- `web/src/lib/server/runs.ts` — `getDbPath()`와 `getRepoRoot()`가 `process.cwd()`를 어떻게 쓰는지
- `/package.json`, `web/package.json` — 스크립트 이름과 워크스페이스 구조

## 배경

이 프로젝트는 지금까지 **로컬 도구**였다(ADR-006: "로컬 도구 전제이므로 배포 인프라는 고려하지 않는다"). 이 phase는 그 전제를 뒤집어 OCI Ubuntu 단일 VM에 올린다. 왜 단일 VM인가:

**웹이 파이프라인을 자식 프로세스로 spawn하고(ADR-007), 상태는 로컬 SQLite 파일에 있다(ADR-014).** 따라서 웹 프로세스와 CLI 프로세스는 **같은 파일시스템·같은 커널**에 있어야 한다. 수평 확장·서버리스·다중 컨테이너는 아키텍처상 불가능하다. 단일 VM은 타협이 아니라 이 설계의 필연이다.

### 이 step이 푸는 진짜 문제: systemd가 실행 중인 run을 죽인다

`spawnConsult.ts`는 `detached: true` + `.unref()`로 CLI를 띄운다. 그런데 **이것은 systemd cgroup을 탈출하지 못한다.** `detached`는 프로세스 그룹·세션을 분리할 뿐 cgroup 소속을 바꾸지 않는다.

systemd의 기본값은 `KillMode=control-group`이다 — 서비스를 stop/restart하면 **cgroup에 남은 모든 프로세스에 SIGTERM을 보낸다.** 즉 기본 설정으로 두면 **배포할 때마다 진행 중이던 consult run이 조용히 죽는다.** run 하나가 Gemini 호출로 실비를 태우고 최악 6분까지 도는 것을 감안하면(ADR-012, ADR-016) 이것은 사소한 문제가 아니다.

해법은 `KillMode=process`다 — 메인 프로세스(`next start`)에만 시그널을 보내고 자식은 살려둔다. 살아남은 CLI는 자기 일을 마치고 DB에 결과를 쓴다. `runs`·`steps` 테이블이 단일 진실 공급원이므로 웹이 재시작해도 폴링이 그대로 이어진다.

## 작업

### `deploy/anvil-web.service` (신규 — `deploy/` 디렉토리도 신규)

systemd 유닛 파일을 작성한다. 배포 경로는 `/opt/anvil`(레포 루트), 실행 사용자는 `anvil`을 가정한다.

필수 요소:

```ini
[Unit]
# network-online.target 이후에 뜬다

[Service]
Type=simple
User=anvil
WorkingDirectory=/opt/anvil
ExecStart=<npm으로 web 워크스페이스의 start 스크립트 실행>
EnvironmentFile=/opt/anvil/.env.production
KillMode=process        # ← 이 phase의 존재 이유. 주석으로 이유를 남겨라
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

**`ExecStart`에서 주의할 점:**

- 루트 `package.json`에는 `start` 스크립트가 **없다.** `web/package.json`에만 있다(`next start`). 따라서 워크스페이스를 지정해 실행해야 한다.
- npm은 절대 경로로 지정하라. systemd는 로그인 셸이 아니라 `PATH`가 빈약하고, nvm으로 깐 node는 `PATH`에 아예 없다.
- `npm run start -w web`으로 실행하면 스크립트의 cwd가 `web/`이 된다. 이것이 **`getDbPath()`·`getRepoRoot()`가 기대하는 cwd다**(둘 다 `process.cwd()/..`를 본다). cwd가 어긋나면 웹이 엉뚱한 DB를 열고 조용히 빈 목록을 보여준다.

### `deploy/.env.production.example` (신규)

systemd `EnvironmentFile`이 읽을 환경변수 템플릿. 실제 값이 아닌 플레이스홀더만 넣는다.

담을 항목:
- `GEMINI_API_KEY`(필수), `YOUTUBE_API_KEY`·`NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`(선택 — 없으면 해당 소스를 건너뛴다)
- `ANVIL_DB_PATH=/opt/anvil/data/anvil.db` — **cwd 추론에 기대지 말고 명시하라**
- `ANVIL_REPO_ROOT=/opt/anvil` — spawn cwd
- `NODE_ENV=production`, `PORT=3000`

**systemd `EnvironmentFile`은 dotenv가 아니다.** `export` 접두사를 쓰면 안 되고, 따옴표 처리 규칙도 다르며, `#` 주석은 줄 맨 앞에서만 유효하다. 파일 상단 주석으로 이 차이를 경고하라 — 값에 `$`나 공백이 든 API 키에서 실제로 물린다.

## 불변식 — 어기면 이 phase가 무너진다

- **`KillMode=process`를 빼지 마라.** 이유: 기본값이면 배포마다 진행 중인 run이 죽는다. 이 한 줄이 step 0의 존재 이유다.
- **`User=root`로 돌리지 마라.** 이유: 이 앱은 사용자 입력을 LLM 프롬프트로 넘기고 자식 프로세스를 spawn한다. root 권한을 줄 이유가 없다.
- **실제 API 키를 `.example` 파일에 넣지 마라.** 이유: `.env`는 `.gitignore`에 있지만 `deploy/*.example`은 커밋된다.
- **`WorkingDirectory`와 `ExecStart`의 cwd 관계를 임의로 바꾸지 마라.** 이유: `runs.ts`의 경로 추론이 cwd에 의존한다. 바꾸려면 `ANVIL_DB_PATH`·`ANVIL_REPO_ROOT`가 반드시 명시되어야 한다.

## Acceptance Criteria

```bash
npm run build
npm test
test -f deploy/anvil-web.service
test -f deploy/.env.production.example
grep -q '^KillMode=process' deploy/anvil-web.service
grep -q 'ANVIL_DB_PATH' deploy/.env.production.example
grep -q 'ANVIL_REPO_ROOT' deploy/.env.production.example
! grep -qE '^export ' deploy/.env.production.example
```

**AC가 약하다는 것을 인지하라.** 개발 머신은 macOS라 `systemd-analyze verify`를 실행할 수 없다. 위 검증은 "핵심 규칙이 파일에 박혔는가"까지만 본다. 실제 유닛 동작 검증은 step 3의 런북을 따라 서버에서 사람이 한다. 이 한계를 없는 척하지 마라.

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트:
   - 앱 소스(`src/`, `web/src/`)를 **한 줄도 수정하지 않았는가?** 이 step은 배포 설정만이다
   - CLAUDE.md CRITICAL 규칙 위반이 없는가?
3. `phases/9-deploy/index.json`의 step 0을 업데이트한다. summary에 **확정된 배포 경로·서비스명·실행 사용자·ExecStart 문자열**을 적어라 — step 2의 배포 스크립트와 step 3의 런북이 이 값들을 글자 그대로 써야 한다.

## 금지사항

- **앱 코드를 수정하지 마라.** 이유: 이번 배포의 설계 전제가 "앱 코드 수정 0"이다. spawn 방식이나 경로 추론을 고쳐야 할 것 같으면 그것은 이 step이 아니라 별도 논의 대상이다.
- **Docker 관련 파일을 만들지 마라.** 이유: spawn + SQLite 파일 공유 구조에서 컨테이너는 이점 대부분이 상쇄된다. 채택하지 않기로 결정된 방식이다.
- **인증·로그인 기능을 구현하지 마라.** 이유: 접근 통제는 step 1에서 Caddy가 앱 바깥에서 처리한다. PRD가 인증을 비목표로 유지한다.
- **기존 테스트를 깨뜨리지 마라.**
