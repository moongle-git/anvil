# Step 1: caddy-edge

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/ARCHITECTURE.md` — "웹 UI 데이터 흐름 (1-web-ui)" 절의 API 목록
- `/docs/PRD.md` — **115행 비목표 목록**("사용자 인증·배포·멀티테넌시"). 이 step은 그 비목표를 **유지한 채** 배포를 가능하게 만드는 우회다
- `deploy/anvil-web.service` — 이전 step이 만들었다. 리스닝 포트와 배포 경로를 여기서 가져와라
- `web/src/app/api/` — 어떤 라우트가 존재하는지 (특히 `POST /api/runs`)

## 배경

앱에는 인증이 없다. PRD가 명시적 비목표로 두고 있다. 이 상태로 공인 IP에 올리면 **누구나 `POST /api/runs`를 호출해 운영자의 Gemini 키로 파이프라인을 돌릴 수 있다.** ADR-016이 계측했듯 run 하나는 실비가 나가며, 그중 65%가 `context-hunter` 하나에서 발생한다. 이것은 이론적 위험이 아니라 청구서다.

### 왜 앱 로그인이 아니라 리버스 프록시인가

이 결정의 근거는 step 4에서 ADR로 정식 기록한다. 요지만 옮기면:

1. **로그인은 이 위협을 더 잘 막지 못한다.** basic auth는 Caddy에서 끊어 Next가 실행조차 안 된다. 앱 로그인은 반대로 로그인 엔드포인트가 공개되어야 동작하므로 공격 표면이 늘어난다.
2. **CLI에는 세션이 없다.** `npm run consult`는 헤드리스로 도는 프로세스다. 인증을 앱에 넣으면 웹 경로에만 존재하고, DB에는 세션 없는 프로세스가 만든 run이 계속 쌓인다 — 단일 진실 공급원이 두 개의 접근 모델을 갖게 된다.
3. **DB에 사용자 개념이 없다.** `runs`/`steps`/`artifacts`/`usage` 어디에도 없다. 운영자 한 명 전제에서 `user_id`는 항상 같은 값인 컬럼이고, 스코프 검사는 항상 참인 조건이다.

**따라서 접근 통제는 앱 바깥 엣지에 둔다. 앱 코드 수정은 0줄이다.**

### basic auth의 한계를 문서에 정직하게 남겨라

- 단일 공유 자격증명이다. 앱은 누가 접속했는지 모른다.
- base64는 암호화가 아니다. **TLS가 없으면 매 요청이 사실상 평문 비번이다** — HTTPS는 선택이 아니라 성립 조건이다.
- 표준적인 로그아웃이 없다.
- 기본 rate limit이 없다.

이것들을 Caddyfile 주석에 적어라. 나중에 이 파일을 읽는 사람이 "왜 이렇게 허술하지"가 아니라 "이 한계를 알고 선택했구나"를 읽어야 한다.

## 작업

### `deploy/Caddyfile.example` (신규)

Caddy v2 설정 템플릿. 실제 파일은 서버의 `/etc/caddy/Caddyfile`에 놓이며 **레포에는 예시만 둔다**(실제 해시가 커밋되지 않도록).

구조:

```caddyfile
<도메인 또는 <공인IP>.sslip.io> {
    basic_auth {
        <사용자명> <bcrypt-해시-플레이스홀더>
    }
    reverse_proxy localhost:3000
}
```

담아야 할 것:

- **해시 생성 커맨드를 주석으로**: `caddy hash-password --plaintext '...'`
- **도메인이 없을 때의 폴백**: `<공인IP>.sslip.io`를 쓰면 sslip.io가 IP를 그대로 해석해주므로 **Let's Encrypt 정식 인증서를 받을 수 있다.** 도메인이 생기면 첫 줄만 교체하면 된다. 이 사실을 주석으로 명시하라 — "도메인이 없어서 배포를 못 한다"는 오해를 막는다.
- **디렉티브 이름 주의**: `basic_auth`는 Caddy **2.8 이상**의 이름이다. 그 이전은 `basicauth`다. 서버에 깔린 버전과 다르면 Caddy가 아예 뜨지 않는다. 주석으로 경고하라.
- **basic auth가 `/api/*`를 포함한 전 경로에 적용된다는 것**을 주석으로 확인하라. 이것이 이 step의 목적(`POST /api/runs` 차단)이다. 특정 경로만 열어두는 matcher를 추가하지 마라.

### `deploy/README.md` (신규, 짧게)

`deploy/` 디렉토리에 무엇이 있고 각 파일이 서버 어디로 가는지 3~5줄로 적는다. 상세 절차는 step 3의 `docs/DEPLOY.md`가 소유하므로 **여기서 런북을 쓰지 마라**(두 개의 진실이 된다). 런북을 가리키기만 한다.

## 불변식

- **basic auth를 특정 경로에만 걸지 마라.** 이유: `POST /api/runs`가 뚫리면 이 step은 아무것도 막지 못한 것이다.
- **실제 bcrypt 해시나 실제 도메인을 커밋하지 마라.** 플레이스홀더만 둔다.
- **HTTP(80)로 서비스하는 설정을 예시로 넣지 마라.** 이유: TLS 없는 basic auth는 비번을 평문으로 흘린다. Caddy는 기본적으로 HTTPS로 리다이렉트하므로 그 기본값을 끄지 마라.
- **앱 코드를 수정하지 마라.** 이 방식의 핵심 이점이 "수정 0줄"이다.

## Acceptance Criteria

```bash
npm run build
npm test
test -f deploy/Caddyfile.example
test -f deploy/README.md
grep -q 'reverse_proxy' deploy/Caddyfile.example
grep -qE 'basic_?auth' deploy/Caddyfile.example
grep -q 'sslip.io' deploy/Caddyfile.example
grep -q 'hash-password' deploy/Caddyfile.example
```

로컬에 `caddy` 바이너리가 있다면 `caddy validate --config deploy/Caddyfile.example --adapter caddyfile`도 돌려라. **없으면 AC에서 빼되, 없어서 건너뛴 것을 summary에 적어라** — 있는 척하지 마라.

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트:
   - 앱 소스(`src/`, `web/src/`)를 한 줄도 수정하지 않았는가?
   - PRD 비목표(인증)를 뒤집지 않았는가? — 앱에 로그인을 만들지 않았어야 한다
   - `deploy/README.md`가 런북을 중복해서 쓰지 않았는가?
3. `phases/9-deploy/index.json`의 step 1을 업데이트한다. summary에 **확정된 basic auth 사용자명 규약·리스닝 포트·도메인 폴백 방식**을 적어라 — step 3의 런북이 이 값을 그대로 쓴다.

## 금지사항

- **앱에 로그인·세션·미들웨어를 만들지 마라.** 이유: PRD 비목표이며, 이 phase의 설계 전제(앱 수정 0줄)를 무너뜨린다. 멀티유저가 필요해지면 별도 phase다.
- **`runs`·`steps`·`artifacts`·`usage`에 `user_id` 같은 컬럼을 추가하지 마라.** 이유: 운영자 한 명 전제에서 순수한 의례다. ADR-014를 건드리는 일이다.
- **rate limit 플러그인을 넣겠다고 Caddy를 커스텀 빌드하지 마라.** 이유: 표준 배포판으로 끝내는 것이 이 step의 범위다. 긴 랜덤 비번으로 충분하다.
- **기존 테스트를 깨뜨리지 마라.**
