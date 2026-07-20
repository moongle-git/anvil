# 배포 런북

anvil 웹 UI를 단일 VM에 올려 공인 HTTPS로 서비스하기까지의 전 과정이다.
**이 문서가 배포 절차의 단일 진실 공급원이다.** `deploy/README.md`는 파일이 어디로 가는지만 알려주고,
각 설정 항목의 이유는 해당 파일의 주석이 설명한다. 절차를 다른 곳에 다시 쓰지 마라 — 두 곳에 적으면 반드시 갈라진다.

읽는 사람은 6개월 뒤의 나 자신이다. 커맨드는 전부 복사해서 붙여 넣을 수 있게 적었다.
`<...>` 꼴만 실제 값으로 바꾸면 된다. **실제 도메인·IP·비밀번호·API 키는 이 문서에 적지 마라. 커밋된다.**

이 문서에서 쓰는 플레이스홀더:

| 표기         | 뜻                                                                        |
| ------------ | ------------------------------------------------------------------------- |
| `<공인IP>`   | 인스턴스의 공인 IPv4 주소                                                 |
| `<호스트>`   | 서비스 호스트 이름. 도메인이 있으면 그 도메인, 없으면 `<공인IP>.sslip.io` |
| `<GIT_URL>`  | 이 레포의 clone URL                                                       |
| `<비밀번호>` | basic auth 평문 비밀번호 (20자 이상 랜덤)                                 |

---

## 1. 전제와 범위

### 단일 VM 전용이다 — 수평 확장할 수 없다

두 가지가 이 구조를 못박는다.

1. **파이프라인은 로컬 프로세스 spawn이다** (ADR-007). 웹은 `POST /api/runs`를 받으면 같은 머신에서
   `npm run consult -- --resume <runId>`를 detached 자식으로 띄운다. 인스턴스가 둘이면 A가 만든 run을
   B가 실행할 방법이 없다.
2. **상태 저장소가 로컬 SQLite 파일이다** (ADR-014). `data/anvil.db` 하나가 실행 상태·산출물의
   단일 진실 공급원이고, WAL 모드는 "쓰는 프로세스 1 + 읽는 프로세스 N"을 **같은 파일시스템 위에서만** 해결한다.

로드밸런서 뒤에 인스턴스를 여러 대 두면 목록이 노드마다 달라진다. 이 도구는 운영자 1명을 전제한다.

### 앱에는 인증이 없다 — 문지기는 Caddy다

PRD가 "사용자 인증·배포·멀티테넌시"를 명시적 비목표로 둔다. 접근 통제는 **엣지의 basic auth 한 겹**이고,
앱 코드는 배포를 위해 한 줄도 바뀌지 않았다. 이 선택의 근거와 한계는 `deploy/Caddyfile.example` 주석에 있다.

**basic auth의 한계를 숨기지 않는다.** 알고 선택한 것이다:

- **단일 공유 자격증명이다.** 누가 접속했는지 앱도 로그도 구분하지 못한다. 사람이 늘면 이 문서가 아니라 별도 phase가 답이다.
- **base64는 암호화가 아니다.** 자격증명이 매 요청 헤더에 실려 가고 디코딩은 누구나 한다.
  **TLS가 없으면 평문 비밀번호를 반복 전송하는 것과 같다** — 이 설정에서 HTTPS는 선택이 아니라 성립 조건이다.
- **표준적인 로그아웃이 없다.** 브라우저가 자격증명을 캐시한다. 끊으려면 비밀번호를 바꾸고 Caddy를 reload하는 것이 사실상 유일한 방법이다.
- **rate limit이 없다.** Caddy 표준 배포판에 rate limit 디렉티브가 없고, 그것 때문에 커스텀 빌드를 하지는 않는다.
  대응은 **길고 랜덤한 비밀번호**뿐이다.

막으려는 것은 이론이 아니라 청구서다. 인증 없이 공인 IP에 올리면 누구나 `POST /api/runs`로 운영자의
Gemini 키를 태울 수 있다.

### 권장 인스턴스

|          | 권장                            | 비고                                                |
| -------- | ------------------------------- | --------------------------------------------------- |
| 클라우드 | Oracle Cloud (OCI)              | Always Free 한도가 넉넉하다                         |
| 셰이프   | **Ampere A1 (arm64)**           | Always Free 4 OCPU / 24GB까지. 서버 빌드가 여유롭다 |
| OS       | Ubuntu 22.04 또는 24.04 (arm64) |                                                     |
| 디스크   | 기본 부트 볼륨(50GB)이면 충분   |                                                     |

> ⚠️ **AMD micro 셰이프(VM.Standard.E2.1.Micro, 1 OCPU / 1GB)는 쓰지 마라.**
> `next build`가 메모리 부족으로 죽는다(OOM killer가 조용히 프로세스를 잡아가서 원인이 안 보인다).
> 굳이 써야 한다면 최소 2GB 스왑을 먼저 붙여라 — 그래도 빌드가 매우 느리다.
> ```bash
> sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
> sudo mkswap /swapfile && sudo swapon /swapfile
> echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
> ```

### 이 배포가 하지 않는 것

- **Docker를 쓰지 않는다.** 서버에서 직접 빌드하고 systemd로 띄운다.
- **CI/CD가 없다.** 배포는 사람이 `scripts/deploy.sh`를 실행하는 것이다.
- **DB 마이그레이션 러너가 없다.** 이 프로젝트에 그런 것은 존재하지 않는다 (§4 참조). 만들지 마라.
- **롤백·헬스체크 폴링·무중단 배포가 없다.** 단일 사용자 내부 도구다. 다운타임 몇 초는 문제가 아니다.

---

## 2. 서버 준비

### 2.1 인스턴스 생성과 접속

OCI 콘솔에서 Ampere A1 인스턴스를 만들고 SSH 공개키를 등록한다. 생성 후:

```bash
ssh ubuntu@<공인IP>
```

기본 패키지를 갱신한다.

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y git curl ca-certificates sqlite3
```

### 2.2 방화벽 — 두 겹이다 ⚠️

**이 단계가 이 문서에서 사람을 가장 오래 붙잡는 곳이다.**
OCI는 방화벽이 **두 겹**이고, 둘 다 열어야 한다. 하나만 열면 증상이 똑같다 — 브라우저가 그냥 멈춘다.

#### (a) VCN Security List — 클라우드 쪽

콘솔에서 **Networking → Virtual Cloud Networks → (VCN) → Security Lists → Default Security List**로 들어가
Ingress Rules에 두 줄을 추가한다.

| Source CIDR | IP Protocol | Destination Port Range |
| ----------- | ----------- | ---------------------- |
| `0.0.0.0/0` | TCP         | `80`                   |
| `0.0.0.0/0` | TCP         | `443`                  |

**3000번은 열지 마라.** `next start`는 모든 인터페이스에 바인딩하므로, 3000이 외부에 열리면
누구나 Caddy를 우회해 basic auth 없이 앱에 직접 접속할 수 있다. 즉 이 배포의 유일한 문지기가 무력화된다.

#### (b) 인스턴스 iptables — 서버 안쪽

**콘솔에서 포트를 열어도 접속이 안 된다.** OCI의 Ubuntu 이미지는 22번 외를 차단하는 iptables 규칙을
**기본 탑재**하기 때문이다. 이것을 모르고 콘솔만 몇 번씩 다시 확인하는 것이 이 단계의 단골이다.

먼저 현재 규칙을 줄 번호와 함께 본다.

```bash
sudo iptables -L INPUT --line-numbers -n
```

출력 끝에 이런 줄이 보인다 — **이것이 범인이다.**

```
6    REJECT     all  --  0.0.0.0/0   0.0.0.0/0   reject-with icmp-host-prohibited
```

새 규칙은 **그 REJECT 줄보다 앞에** 들어가야 한다. 위 예시처럼 REJECT가 6번이면:

```bash
sudo iptables -I INPUT 6 -p tcp --dport 80 -m conntrack --ctstate NEW -j ACCEPT
sudo iptables -I INPUT 7 -p tcp --dport 443 -m conntrack --ctstate NEW -j ACCEPT
```

> REJECT 줄 번호는 이미지마다 다르다. **위에서 확인한 실제 번호를 써라.** 뒤에 붙이면(`-A`)
> REJECT가 먼저 걸려 아무 효과가 없는데, 규칙 목록에는 멀쩡히 보이므로 눈으로는 잡히지 않는다.

넣은 뒤 순서를 다시 확인한다. 80/443 ACCEPT가 REJECT **위**에 있어야 한다.

```bash
sudo iptables -L INPUT --line-numbers -n
```

**재부팅 후에도 남도록 저장한다.** 이걸 빼먹으면 다음 재부팅에 규칙이 통째로 사라지고,
그때는 "어제까지 됐는데"로 시작하는 훨씬 나쁜 디버깅이 된다.

```bash
sudo apt-get install -y iptables-persistent   # 설치 중 현재 규칙 저장 여부를 묻는다 → Yes
sudo netfilter-persistent save
```

이미 설치되어 있었다면 `sudo netfilter-persistent save` 한 줄이면 된다.

### 2.3 Node 24 설치 (NodeSource) ⚠️

이 프로젝트는 `node:sqlite`의 `DatabaseSync`를 쓴다(ADR-014). **Ubuntu apt 기본 저장소의 node로는 동작하지 않는다** —
버전이 낮아 `node:sqlite` 모듈이 아예 없다.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

확인한다. **두 줄 다 확인해야 한다** — 버전과 경로가 모두 유닛 파일의 전제다.

```bash
node -v        # v24.x 이상이어야 한다
which node     # /usr/bin/node
which npm      # /usr/bin/npm
```

> **nvm으로 설치하지 않기를 권한다.** systemd는 로그인 셸이 아니라 `~/.nvm/...`을 `PATH`에서 찾지 못한다.
> `deploy/anvil-web.service`가 `ExecStart=/usr/bin/npm ...`으로 **절대 경로**를 쓰고
> `Environment=PATH=...`를 명시하는 이유가 이것이다. 굳이 nvm을 쓴다면 유닛 파일의 `ExecStart`와 `PATH`를
> nvm의 실제 bin 경로로 함께 고쳐야 하고, node 버전을 올릴 때마다 다시 고쳐야 한다.

`node:sqlite`가 실제로 열리는지 여기서 한 번 확인해두면 나중에 원인 찾을 일이 준다.

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync(':memory:'); console.log('ok')"
```

### 2.4 Caddy 설치

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

**버전을 확인해서 적어둬라.** §6에서 디렉티브 이름을 고르는 데 쓴다.

```bash
caddy version    # v2.8 이상이면 basic_auth, 그 미만이면 basicauth
```

### 2.5 `anvil` 시스템 사용자 생성

서비스도 배포도 이 사용자로 돈다.

```bash
sudo useradd --system --create-home --home-dir /var/lib/anvil --shell /bin/bash anvil
```

두 가지가 의도된 선택이다.

- **홈 디렉토리를 `/opt/anvil`이 아니라 `/var/lib/anvil`에 둔다.** 홈을 레포 루트로 잡으면 npm이
  캐시를 `/opt/anvil/.npm`에 만드는데, 그 경로는 `.gitignore`에 없다. 그러면 `scripts/deploy.sh`의
  **워킹트리 청결 검사가 매 배포마다 걸린다.** 홈을 밖에 두면 이 문제가 아예 생기지 않는다.
- **셸을 `/bin/bash`로 명시한다.** 생략하면 배포판·생성 명령에 따라 `/bin/sh`나 `/usr/sbin/nologin`이 잡히는데,
  `nologin`이 걸리면 아래에서 계속 쓰는 `sudo -iu anvil`이 동작하지 않는다. 확인: `getent passwd anvil`.

---

## 3. 애플리케이션 배치

### 3.1 clone

`/opt/anvil`을 먼저 만들고 소유권을 넘긴 뒤, **`anvil` 사용자로** clone한다.
(비어 있는 디렉토리에는 clone할 수 있다. root로 clone하고 나중에 chown하면 `.git` 내부 소유권이 어긋나기 쉽다.)

```bash
sudo mkdir -p /opt/anvil
sudo chown anvil:anvil /opt/anvil
sudo -iu anvil git clone <GIT_URL> /opt/anvil
```

확인:

```bash
ls -ld /opt/anvil            # drwxr-xr-x ... anvil anvil
sudo -iu anvil git -C /opt/anvil status    # 워킹트리가 깨끗해야 한다
```

### 3.2 `.env.production` 배치

템플릿을 복사해 실제 키를 채운다. **이 파일에는 API 키가 들어간다.**

```bash
sudo cp /opt/anvil/deploy/.env.production.example /opt/anvil/.env.production
sudo $EDITOR /opt/anvil/.env.production
```

채울 값:

| 키                                        | 값                         | 필수                                          |
| ----------------------------------------- | -------------------------- | --------------------------------------------- |
| `GEMINI_API_KEY`                          | Gemini API 키              | **필수**                                      |
| `YOUTUBE_API_KEY`                         | YouTube Data API v3 키     | 선택                                          |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 검색 API            | 선택 (둘 다 있어야 켜진다)                    |
| `ANVIL_DB_PATH`                           | `/opt/anvil/data/anvil.db` | 템플릿 기본값 그대로                          |
| `ANVIL_REPO_ROOT`                         | `/opt/anvil`               | 템플릿 기본값 그대로                          |
| `NODE_ENV`                                | `production`               | 그대로                                        |
| `PORT`                                    | `3000`                     | 그대로 (§6의 `reverse_proxy`와 일치해야 한다) |

선택 키가 없으면 그 자료조사 소스만 건너뛰고 나머지로 진행한다(fail-soft, ADR-012).
**빈 값으로 두면 된다 — 줄을 지울 필요는 없다.**

> ⚠️ **이 파일은 dotenv가 아니라 systemd의 `EnvironmentFile=`이 읽는다. 문법이 다르다.**
> `export` 접두사 금지, `#` 주석은 줄 맨 앞에서만, `$`는 확장되지 않는다.
> 전체 규칙은 파일 상단 주석에 있다 — **채우기 전에 읽어라.** 여기서 틀리면 앱은 뜨는데
> "API 키가 없다"고만 말한다.

권한을 잠근다.

```bash
sudo chown anvil:anvil /opt/anvil/.env.production
sudo chmod 600 /opt/anvil/.env.production
ls -l /opt/anvil/.env.production    # -rw------- ... anvil anvil
```

이 파일은 레포 루트 안에 있지만 `.gitignore`에 등재되어 있어 커밋되지 않고,
`scripts/deploy.sh`의 청결 검사에도 걸리지 않는다.

### 3.3 첫 빌드는 손으로 밟는다

**첫 배포에 `scripts/deploy.sh`를 쓰지 마라.** 그 스크립트는 서비스가 이미 설치된 상태를 전제한다
(6단계가 `systemctl restart`라 유닛이 없으면 실패한다). 그리고 무엇보다, 처음에는 **어디서 깨지는지 직접 봐야 한다.**

```bash
sudo -iu anvil
cd /opt/anvil
npm ci --include=dev
npm run build
exit
```

> **`--include=dev`를 빼지 마라.** `tsx`가 devDependency이고, `npm run consult`는 그것으로 TypeScript 소스를
> 직접 실행한다. tsx가 없으면 웹은 멀쩡히 뜨는데 **run만 조용히 실패한다**(§9 참조).
> 셸에 `NODE_ENV=production`이 새어 들어와 있으면 npm이 devDeps를 말없이 건너뛰므로, 이 플래그가 그것을 무력화한다.

빌드는 arm64 4 OCPU 기준 수 분 걸린다. `web/.next/`가 생기면 성공이다.

---

## 4. DB 초기화

### 별도의 마이그레이션 절차가 없다

**여기서 할 일은 디렉토리 권한을 맞추는 것뿐이다.** 스키마를 만드는 명령은 없다.

`src/lib/db.ts`의 `openDb`가 커넥션을 열 때마다 DDL을 실행하는데, 그 DDL이 **전부 `CREATE TABLE IF NOT EXISTS`**이고
`schema_version` 시딩도 멱등이다(행이 있으면 UPDATE, 없으면 INSERT). 그래서 앱이 처음 켜지는 순간
빈 파일에 스키마가 생기고, 이미 있는 DB는 그대로 열린다. **이 프로젝트에 마이그레이션 러너는 존재하지 않으며, 만들지 마라**(ADR-014).

> `npm run migrate:runs`는 **로컬의 구 `runs/{run-id}/` 디렉토리를 DB로 옮기는 일회성 스크립트**다.
> 서버 배포 절차의 일부가 아니다. 새 서버에서 실행할 이유가 없다.

### 디렉토리 쓰기 권한 ⚠️

`openDb`는 부모 디렉토리를 자동으로 만들지만(`mkdirSync recursive`), **그 부모를 만들 권한이 있을 때만** 그렇다.
그리고 WAL 모드는 `anvil.db-wal`·`anvil.db-shm` 파일을 **같은 디렉토리에** 만든다 —
즉 **파일 권한만 맞고 디렉토리 쓰기 권한이 없으면 읽기까지 실패한다.** SQLite는 이때 `SQLITE_CANTOPEN`이나
`readonly database`를 던지는데, "읽기만 하는데 왜 readonly 에러냐"로 한참 헤매게 된다.

```bash
sudo -u anvil mkdir -p /opt/anvil/data
ls -ld /opt/anvil/data      # drwxr-xr-x ... anvil anvil
```

`/opt/anvil/data/`는 `.gitignore`에 있어 배포 스크립트의 청결 검사에 잡히지 않는다.

### 기본값은 빈 DB로 새로 시작이다

아무것도 하지 않으면 첫 실행에 빈 DB가 생기고, 웹은 빈 목록을 보여준다. **그것이 정상이다.**

### (선택) 로컬 기록을 서버로 옮기기

로컬에서 돌린 run 이력을 가져가고 싶을 때만 한다.

> ⚠️ **`cp anvil.db`로 옮기지 마라.** WAL 모드에서는 최근 쓰기가 아직 `-wal` 파일에만 있을 수 있어,
> 본체 파일만 복사하면 **조용히 과거 시점의 DB**가 된다. `-wal`/`-shm`을 같이 복사하는 것도 답이 아니다
> (세 파일의 시점이 서로 어긋난다). 정합 스냅샷을 뜨는 명령이 따로 있다.

로컬(맥)에서:

```bash
sqlite3 data/anvil.db ".backup /tmp/anvil-snapshot.db"
# 또는 (같은 효과 + 조각모음)
sqlite3 data/anvil.db "VACUUM INTO '/tmp/anvil-snapshot.db'"

scp /tmp/anvil-snapshot.db ubuntu@<공인IP>:/tmp/
```

서버에서 — **반드시 서비스를 멈추고** 교체한다.

```bash
sudo systemctl stop anvil-web
sudo install -o anvil -g anvil -m 644 /tmp/anvil-snapshot.db /opt/anvil/data/anvil.db
sudo rm -f /opt/anvil/data/anvil.db-wal /opt/anvil/data/anvil.db-shm
sudo systemctl start anvil-web
```

(`-wal`/`-shm`을 지우는 이유: 새로 넣은 본체 파일과 짝이 맞지 않는 옛 저널이 남으면 SQLite가 열기를 거부한다.
스냅샷은 이미 모든 쓰기가 반영된 완결된 파일이라 저널이 필요 없다.)

---

## 5. systemd 등록

### 5.1 유닛 설치

```bash
sudo cp /opt/anvil/deploy/anvil-web.service /etc/systemd/system/anvil-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now anvil-web
```

문법을 미리 검증하고 싶으면:

```bash
sudo systemd-analyze verify /etc/systemd/system/anvil-web.service
```

상태를 확인한다.

```bash
systemctl status anvil-web
curl -I http://localhost:3000/    # 200 (아직 Caddy를 거치지 않은 직접 접속)
```

`active (running)`이 아니면 §9로 간다.

### 5.2 배포용 sudoers — 딱 한 줄만

`scripts/deploy.sh`가 sudo를 쓰는 지점은 **정확히 하나다**: `systemctl restart anvil-web`.
나머지 6단계는 전부 `anvil` 사용자 권한으로 돈다. 그러니 그 한 줄만 허용한다.

```bash
echo 'anvil ALL=(root) NOPASSWD: /usr/bin/systemctl restart anvil-web' \
  | sudo tee /etc/sudoers.d/anvil-deploy
sudo chmod 440 /etc/sudoers.d/anvil-deploy
sudo visudo -cf /etc/sudoers.d/anvil-deploy     # "parsed OK"
```

확인 — 아래 목록에 그 커맨드 하나만 보여야 한다.

```bash
sudo -l -U anvil
```

> `systemctl`의 절대 경로가 `/usr/bin/systemctl`인지 확인하라(`command -v systemctl`).
> 최신 Ubuntu는 usrmerge라 `/bin/systemctl`도 같은 파일이지만, sudoers는 **문자열로** 매칭하므로
> 경로가 다르면 규칙이 걸리지 않고 배포 6단계에서 비밀번호를 묻는다.

### 5.3 `KillMode=process`가 지키는 것

유닛 파일에 `KillMode=process` 한 줄이 있다. **이 phase가 존재하는 이유이므로 지우지 마라.**

systemd 기본값은 `KillMode=control-group`이다 — stop/restart 시 그 서비스의 cgroup에 남아 있는
**모든 프로세스**에 SIGTERM을 보낸다. 그런데 `spawnConsult`의 `detached: true` + `unref()`는
프로세스 그룹과 세션만 분리할 뿐 **cgroup 소속은 바꾸지 못한다.** 즉 기본값으로 두면
**배포할 때마다 진행 중이던 consult run이 조용히 죽는다.** run 하나는 Gemini 실비를 태우며
최악 6분까지 도는 작업이다(ADR-012, ADR-016).

`KillMode=process`는 systemd가 아는 **메인 프로세스에만** 시그널을 보내고 나머지는 살려둔다.
살아남은 CLI는 자기 일을 마치고 DB에 결과를 쓰며, `runs`·`steps` 테이블이 단일 진실 공급원이므로(ADR-014)
웹이 재시작해도 브라우저의 폴링이 그대로 이어진다. **배포 중에도 진행 중인 run이 살아남는다.**

(`scripts/deploy.sh`의 2단계 `pgrep` 게이트는 이것과 다른 것을 막는다 — 재시작이 아니라 **빌드**가
실행 중인 run의 소스를 갈아엎는 것. 두 겹이 각각 다른 사고를 막는다.)

#### 그 대가: 고아 `next-server`

`KillMode=process`는 consult만 살려주지 않는다. **웹 서버 자신도 살려버린다.**

`ExecStart`가 `/usr/bin/npm run start -w web`이라 systemd가 아는 메인 프로세스는 **`npm` 래퍼**다.
`:3000`을 실제로 bind하는 `next-server`는 그 자식이므로 시그널을 받지 않는다. 재시작하면
npm만 사라지고 next-server는 고아로 남아 포트를 계속 쥔다. 새 인스턴스는 `EADDRINUSE`로 죽고
`Restart=on-failure`가 5초마다 무한 재시도한다.

**이 실패는 조용하다.** 고아가 옛 코드로 정상 응답하므로 사이트는 멀쩡히 뜬다. 증상은
"배포했는데 새 기능이 없다" 하나뿐이다. 게다가 디스크의 `.next`는 새 빌드로 갈린 뒤라
옛 BUILD_ID의 청크가 404가 되고, 브라우저 캐시가 걷히는 순간 페이지가 통째로 깨진다
(`This page couldn't load`). 실제로 재시작 카운터가 417까지 올라간 적이 있다.

`scripts/deploy.sh` 6단계가 재시작 **직전에** `:3000` 점유 프로세스를 정리해서 이것을 막는다.
`stop`/`start`로 나누지 않고 `restart`를 유지하는 이유는 sudoers다 — 배포 사용자에게 허용된
sudo는 §5.2의 한 줄뿐이고, next-server와 배포 사용자가 둘 다 `anvil`이라 `kill`에는 sudo가 필요 없다.
8단계는 `is-active` 대신 **실제 HTTP 응답**을 기다린다. 크래시 루프 중인 유닛은 재시작 사이에
`activating`을 지나므로 `is-active`만으로는 죽어가는 서비스가 검사를 통과한다.

---

## 6. Caddy 설정

### 6.1 비밀번호 생성과 해싱

비밀번호를 만든다. rate limit이 없으므로 **길이가 유일한 방어선**이다(20자 이상).

```bash
openssl rand -base64 24
```

그 값을 해싱한다. 출력 한 줄(`$2a$14$...`)을 복사한다.

```bash
caddy hash-password --plaintext '<비밀번호>'
```

> 평문 비밀번호는 **비밀번호 관리자에 지금 저장하라.** 해시에서 되돌릴 수 없다.
> 셸 히스토리에 남는 것이 마음에 걸리면 `caddy hash-password`를 인자 없이 실행하면 대화형으로 입력받는다.

### 6.2 Caddyfile 배치

```bash
sudo cp /opt/anvil/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo $EDITOR /etc/caddy/Caddyfile
```

세 곳을 고친다.

1. **사이트 주소** (파일의 `<도메인 또는 <공인IP>.sslip.io>` 줄) → `<호스트>`
2. **비밀번호 해시** (`<caddy hash-password 출력을 여기에>`) → §6.1의 출력.
   사용자명은 `anvil`로 고정한다(운영자 1명 전제라 사람 이름을 쓰지 않는다).
   해시의 `$`는 Caddyfile에서 특별한 문자가 아니므로 **이스케이프하지 말고 그대로** 붙여 넣는다.
3. **디렉티브 이름** — `caddy version`이 **2.8 이상이면 `basic_auth`(그대로 두면 된다), 그 미만이면 `basicauth`**
   (언더스코어 없음)로 고친다. ⚠️ 틀리면 설정 파싱이 실패해 **Caddy가 아예 뜨지 않는다.**
   접근이 막히는 게 아니라 사이트 전체가 내려간다.

> **도메인이 없어도 배포할 수 있다.** `<공인IP>.sslip.io`를 쓰면 된다 — sslip.io는 `<IP>.sslip.io` 형태의
> 이름을 그 IP로 해석해주는 공개 DNS다. **실재하는 이름이라 Let's Encrypt의 HTTP-01 챌린지가 통과하고
> 정식 인증서가 발급된다.** self-signed도 내부 CA도 아니다.
> 예: 공인 IP가 `203.0.113.10`이면 사이트 주소는 `203.0.113.10.sslip.io`.
> 나중에 도메인이 생기면 **첫 줄만 교체하고 reload**하면 된다. 그 외에는 아무것도 바뀌지 않는다.
>
> **IP를 그대로(리터럴로) 적지 마라.** Let's Encrypt는 IP에 인증서를 발급하지 않으므로 Caddy가
> HTTP로만 서비스하게 되고, 그 순간 §1의 "평문 비밀번호" 문제가 현실이 된다.

이름이 실제로 이 서버를 가리키는지 먼저 확인한다.

```bash
dig +short <호스트>      # <공인IP>가 나와야 한다
```

### 6.3 검증과 reload

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

> ⚠️ **레포의 `deploy/Caddyfile.example`은 그 자체로는 validate를 통과하지 않는다.** 플레이스홀더가
> 그대로 들어 있기 때문이다. 검증 대상은 항상 값을 채운 `/etc/caddy/Caddyfile`이다.

로그 디렉토리를 확인한다(Caddy 패키지가 보통 만들어 두지만, 없으면 시작이 실패한다).

```bash
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo systemctl reload caddy
```

### 6.4 인증서 발급 확인

발급은 자동이고 보통 수 초에서 수십 초 걸린다. 로그를 본다.

```bash
sudo journalctl -u caddy -f
```

`certificate obtained successfully` 비슷한 줄이 나오면 성공이다. 실패하면 §9의 마지막 항목으로 간다.
`obtain_cert`나 `challenge failed`가 반복되면 그대로 두지 말고 원인을 고쳐라 —
HTTP로 내려서 넘어가면 basic auth가 무의미해진다.

---

## 7. 검증

### 7.1 문이 실제로 잠겼는가

**401이 나오는 것이 정상이다.** 이것이 접근 통제가 작동한다는 유일한 증거다.

```bash
curl -I https://<호스트>/
# HTTP/2 401
# www-authenticate: Basic realm="restricted"
```

200이 나오면 basic auth가 걸리지 않은 것이다 — 즉시 `/etc/caddy/Caddyfile`을 다시 보라.

자격증명을 주면 통과한다.

```bash
curl -I -u anvil:'<비밀번호>' https://<호스트>/
# HTTP/2 200
```

HTTP가 HTTPS로 리다이렉트되는지도 본다.

```bash
curl -I http://<호스트>/
# HTTP/1.1 308 Permanent Redirect → Location: https://...
```

3000번이 밖에서 안 열리는지 **다른 머신에서** 확인한다(로컬에서 하면 항상 열려 보인다).

```bash
curl -m 5 -I http://<공인IP>:3000/    # 타임아웃/거부되어야 정상
```

### 7.2 파이프라인이 실제로 도는가 ⚠️

**여기가 진짜 검증이다.** 웹이 뜨는 것과 run이 도는 것은 별개다.

1. 브라우저로 `https://<호스트>/` 접속 → 사용자명 `anvil` + 비밀번호 입력
2. 아이디어를 입력하고 "컨설팅 시작"
3. `/runs/{id}`로 이동한다. **여기서 몇 초 안에 인터뷰 질문이 떠야 한다.**

웹에서 만든 run은 `interviewer` step이 켜져 있어, CLI가 정상 실행되면 질문을 만들고
"답변 대기" 상태가 된다. **질문이 뜨면 spawn이 성공한 것이다.**

> ⚠️ **진행 상태가 `pending`에서 넘어가지 않고 그대로 멈춰 있으면 §9의 첫 항목으로 가라.**
> 이때 화면에는 아무 에러도 뜨지 않고 로그에도 아무것도 남지 않는다. 그것이 이 실패의 특징이다.

답변을 제출하면 자료조사부터 파이프라인이 돈다. 완주까지 수 분 걸린다(ADR-012).

### 7.3 로그 보는 법

```bash
sudo journalctl -u anvil-web -f              # 웹 서버 실시간
sudo journalctl -u anvil-web -n 100 --no-pager   # 최근 100줄
sudo journalctl -u anvil-web --since '10 min ago'
sudo journalctl -u caddy -f                  # 엣지 (401 반복 = 누가 문을 두드리는 중)
```

Caddy 접근 로그는 파일로도 남는다: `/var/log/caddy/anvil.log` (JSON).

> **`journalctl -u anvil-web`에 파이프라인 로그는 없다.** `spawnConsult`가 `stdio: "ignore"`로
> 자식을 띄우기 때문이다(ADR-007). 여기 보이는 것은 Next 서버의 로그뿐이다.

---

## 8. 재배포

두 번째부터는 스크립트를 쓴다.

```bash
sudo -iu anvil
cd /opt/anvil && ./scripts/deploy.sh
```

7단계를 매번 같은 순서로 돌린다: 선행 확인 → 실행 중인 run 확인 → `git pull --ff-only` →
`npm ci --include=dev` → `npm run build` → `sudo systemctl restart anvil-web` → `is-active` 확인.
자동화가 목적이 아니라 **순서 보장**이 목적이다. 출력을 보면서 실행하는 스크립트다.

스크립트가 멈추는 곳은 셋이다.

| 중단 사유                       | 뜻                                            | 대응                     |
| ------------------------------- | --------------------------------------------- | ------------------------ |
| 배포 경로가 `/opt/anvil`이 아님 | 빌드한 트리와 유닛이 서비스하는 트리가 갈린다 | 경로를 확인하라          |
| 워킹트리가 깨끗하지 않음        | 서버에서 직접 고친 것이 있다                  | 커밋하거나 되돌려라      |
| 진행 중인 consult 프로세스 발견 | 지금 빌드하면 그 run이 읽는 소스가 교체된다   | **끝날 때까지 기다려라** |

### `--force`의 의미

```bash
./scripts/deploy.sh --force
```

**선행 확인 두 가지(배포 경로 일치·실행 중인 run 탐지)를 건너뛴다.** 그뿐이다.

- **워킹트리 청결 검사는 `--force`로도 건너뛰지 않는다.** 서버에서 직접 고친 것을 조용히 날리지 않기 위해서다.
- 실행 중인 run을 무시하고 진행하면 그 run은 **결과를 예측할 수 없다**(tsx가 소스를 실행 중에 읽는다).
  Gemini 비용은 이미 나간 상태다. 급한 핫픽스가 아니면 쓰지 마라.

---

## 9. 트러블슈팅

### 배포했는데 새 기능이 화면에 없다

먼저 코드가 서버에 도착했는지부터 가른다. 여기서 갈리면 원인 절반이 잘려나간다.

```bash
cd /opt/anvil && git rev-parse --short HEAD    # 기대하는 커밋인가
```

커밋이 맞는데도 기능이 없다면 **옛 `next-server`가 살아남아 `:3000`을 쥐고 옛 코드로 응답하고
있는 것이다** (§5.3 "그 대가"). 서비스는 그 뒤에서 크래시 루프를 돌고 있다.

```bash
systemctl is-active anvil-web                       # activating 이면 루프 중이다
systemctl show anvil-web -p NRestarts --value       # 수백이면 확정이다
ss -lptn 'sport = :3000'                            # 포트를 쥔 PID
```

`journalctl -u anvil-web`에 `EADDRINUSE`와 `Found left-over process ... in control group`이
함께 보이면 같은 원인이다. 해소는 포트를 비우고 재시작:

```bash
kill <PID>          # 안 죽으면 kill -9. next-server 이므로 sudo 불필요
sudo systemctl restart anvil-web
curl -sI localhost:3000/ | head -1                  # 200 이어야 한다
```

`scripts/deploy.sh`가 6단계에서 이것을 자동으로 처리하므로, 스크립트로 배포했다면 재발하지
않아야 한다. 그런데도 났다면 6단계 출력을 확인하라 — `ss`가 없거나 포트를 쥔 것이 다른
사용자 소유면 PID를 못 뽑는다.

> **화면에 `This page couldn't load`가 뜬다면** 같은 원인의 다음 단계다. 옛 서버가 참조하는
> `/_next/static` 청크가 새 빌드로 갈리면서 사라져 404가 난 것이다. 브라우저 캐시를 지우면
> 증상이 "기능이 없다"에서 "페이지가 안 뜬다"로 **악화되는데, 이는 정상이다** — 캐시가 가리고
> 있던 진짜 상태가 드러난 것이므로 위 절차를 그대로 따르면 된다.

### run이 `pending`에서 넘어가지 않는다 (에러도 로그도 없다)

**가장 흔하고, 가장 안 보이는 실패다.**

`spawnConsult`는 `stdio: "ignore"`로 자식을 띄운다(ADR-007). 그래서 CLI 실행이 실패해도
**로그가 한 줄도 남지 않고**, 웹은 runId를 정상 응답하며, run은 영원히 `pending`에 머문다.
journalctl을 아무리 봐도 나오지 않는다.

**진단은 하나뿐이다 — 서버에서 그 커맨드를 직접, 손으로 실행해 에러를 눈으로 보는 것이다.**

```bash
sudo -iu anvil
cd /opt/anvil
npm run consult -- --resume <runId>
```

이제 실제 에러가 화면에 뜬다. 흔한 원인 순서대로:

| 증상                                   | 원인                                                                | 고치는 법                     |
| -------------------------------------- | ------------------------------------------------------------------- | ----------------------------- |
| `tsx: not found` / `command not found` | **devDeps 누락** — 가장 흔하다                                      | `npm ci --include=dev`        |
| `GEMINI_API_KEY` 관련 에러             | `.env.production` 미배치 또는 `export ` 접두사 등 systemd 문법 위반 | §3.2                          |
| `npm: not found` (웹 로그에도 안 남음) | 유닛의 `Environment=PATH=` 가 실제 npm 경로를 포함하지 않음         | `which npm` 확인 후 유닛 수정 |
| `SQLITE_CANTOPEN`                      | `data/` 디렉토리 권한                                               | 아래 항목                     |
| 해당 runId를 못 찾음                   | 웹과 CLI가 서로 다른 DB를 본다                                      | 아래 항목                     |

직접 실행이 **성공한다면** 문제는 spawn 환경이다 — 즉 `ANVIL_REPO_ROOT`(spawn cwd)나
유닛의 `PATH`를 의심하라. `sudo -iu anvil`의 환경과 systemd가 주는 환경은 다르다.
systemd가 실제로 무엇을 넘기는지 보려면:

```bash
sudo systemctl show anvil-web -p Environment
```

### 웹 목록이 비어 있다 / CLI로 만든 run이 안 보인다

**웹과 CLI가 서로 다른 DB 파일을 보고 있다.** 두 경로의 기본값이 다르기 때문이다 —
CLI는 `<cwd>/data/anvil.db`, 웹은 `<cwd>/../data/anvil.db`(웹의 cwd는 `web/`이다).
그래서 `.env.production`이 `ANVIL_DB_PATH`를 **명시**한다.

```bash
# 웹 프로세스가 실제로 뭘 보는지
sudo systemctl show anvil-web -p Environment | tr ' ' '\n' | grep ANVIL

# 파일이 실제로 어디 있는지 (-wal/-shm이 함께 보이면 그게 살아 있는 DB다)
sudo ls -l /opt/anvil/data/

# 안에 뭐가 들었는지
sudo -u anvil sqlite3 /opt/anvil/data/anvil.db 'SELECT run_id, idea FROM runs ORDER BY created_at DESC LIMIT 5;'
```

`.env.production`의 `ANVIL_DB_PATH=/opt/anvil/data/anvil.db`를 확인하고, 고쳤으면
`sudo systemctl restart anvil-web`으로 반영한다(EnvironmentFile은 재시작해야 다시 읽힌다).

엉뚱한 곳에 DB가 생겼다면(`/opt/anvil/web/data/anvil.db` 등) 그것이 증거다.

### `SQLITE_CANTOPEN` 또는 `attempt to write a readonly database`

**`data/` 디렉토리 자체의 쓰기 권한 문제다.** WAL 모드는 `-wal`/`-shm` 파일을 같은 디렉토리에 만들기 때문에,
DB 파일 권한만 맞고 디렉토리 권한이 없으면 **읽기까지 실패한다.** "읽기만 하는데 왜 readonly냐"가 이 에러의 정체다.

```bash
ls -ld /opt/anvil/data              # anvil이 소유하고 쓰기 권한이 있어야 한다
ls -l  /opt/anvil/data/             # anvil.db, anvil.db-wal, anvil.db-shm

sudo chown -R anvil:anvil /opt/anvil/data
sudo chmod 755 /opt/anvil/data
sudo systemctl restart anvil-web
```

(`sudo sqlite3`로 DB를 열었다가 root 소유의 `-wal` 파일을 남기는 것도 흔한 원인이다.
위 `chown -R`이 그것도 함께 고친다.)

### 브라우저 접속 자체가 안 된다 (타임아웃)

**방화벽 두 겹 중 한 겹만 열었을 가능성이 가장 높다** (§2.2). 증상이 똑같아서 구분이 안 된다.

서버 안에서는 되는데 밖에서 안 된다면 방화벽이 범인이다.

```bash
# 서버 안에서 — 여기서 응답이 오면 앱과 Caddy는 정상이다
curl -I http://localhost:3000/
curl -I -k https://localhost/ -H 'Host: <호스트>'

# iptables에 80/443 ACCEPT가 REJECT '위'에 있는지
sudo iptables -L INPUT --line-numbers -n

# 실제로 리스닝 중인지
sudo ss -lntp | grep -E ':80|:443|:3000'
```

그 다음 OCI 콘솔의 VCN Security List ingress를 확인한다. **둘 다 확인해야 한다** — 하나만 보고
"열려 있는데?"로 끝내는 것이 이 함정의 전형이다.

### Caddy가 아예 뜨지 않는다

```bash
sudo systemctl status caddy
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

`unrecognized directive: basic_auth` (또는 `basicauth`)가 보이면 **버전과 디렉티브 이름이 어긋난 것이다.**
`caddy version`이 **2.8 이상이면 `basic_auth`, 그 미만이면 `basicauth`**(언더스코어 없음)다.
접근이 막히는 게 아니라 사이트 전체가 내려가므로 증상이 커 보이지만 원인은 이 한 글자일 때가 많다.

`/var/log/caddy`가 없어서 못 뜨는 경우도 있다 — §6.3의 `mkdir`을 확인하라.

### 인증서 발급이 실패한다

```bash
sudo journalctl -u caddy -f | grep -iE 'acme|challenge|obtain|error'
```

체크 순서:

1. **80번 포트가 열려 있는가.** HTTP-01 챌린지는 **80번을 쓴다.** 443만 열고 80을 막으면 발급이 실패한다 (§2.2).
2. **이름이 이 서버를 가리키는가.** `dig +short <호스트>` → `<공인IP>`.
   sslip.io를 쓴다면 IP 부분에 오타가 없는지 본다.
3. **IP 리터럴을 쓰지 않았는가.** Let's Encrypt는 IP에 인증서를 발급하지 않는다. `<공인IP>.sslip.io`를 써라.
4. **Let's Encrypt rate limit에 걸렸는가.** 같은 이름으로 반복 실패하면 걸린다. 이때만 임시로
   staging CA로 원인을 좁힌다(`deploy/Caddyfile.example`의 주석 참조). **운영에서는 반드시 지워라 —
   staging 인증서는 브라우저가 신뢰하지 않는다.**

**발급이 안 된다고 HTTP로 내리지 마라.** `http://` 접두사나 `auto_https off`를 켜는 순간
basic auth 자격증명이 평문으로 흐른다(§1).

---

## 부록: 확정 값 한눈에

문서·유닛·스크립트·Caddyfile이 전부 같은 값을 쓴다. **하나를 바꾸면 나머지도 함께 바꿔야 한다.**

| 항목                | 값                                          | 정의된 곳                                                               |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| 레포 루트           | `/opt/anvil`                                | 유닛 `WorkingDirectory`, `deploy.sh` `EXPECTED_ROOT`, `ANVIL_REPO_ROOT` |
| 실행 사용자/그룹    | `anvil:anvil`                               | 유닛 `User=`/`Group=`                                                   |
| 사용자 홈           | `/var/lib/anvil`                            | (레포 밖 — npm 캐시가 워킹트리를 더럽히지 않게)                         |
| 서비스명            | `anvil-web`                                 | 유닛 파일명, `deploy.sh` `SERVICE`, sudoers                             |
| 유닛 파일           | `/etc/systemd/system/anvil-web.service`     | ← `deploy/anvil-web.service`                                            |
| 환경 파일           | `/opt/anvil/.env.production` (0600, anvil)  | ← `deploy/.env.production.example`                                      |
| DB                  | `/opt/anvil/data/anvil.db`                  | `ANVIL_DB_PATH`                                                         |
| 앱 리스닝 포트      | `localhost:3000`                            | `.env.production`의 `PORT`, Caddy `reverse_proxy`                       |
| 외부 개방 포트      | `80`, `443` **만**                          | VCN + iptables                                                          |
| Caddy 설정          | `/etc/caddy/Caddyfile`                      | ← `deploy/Caddyfile.example`                                            |
| basic auth 사용자명 | `anvil`                                     | Caddyfile                                                               |
| 배포 명령           | `cd /opt/anvil && ./scripts/deploy.sh`      | `scripts/deploy.sh`                                                     |
| sudo 허용 범위      | `/usr/bin/systemctl restart anvil-web` 하나 | `/etc/sudoers.d/anvil-deploy`                                           |
