# deploy/

배포에 필요한 설정 **템플릿**만 모아둔 곳이다. 전부 예시이며, 실제 값(API 키·bcrypt 해시·도메인)은
서버에만 존재하고 커밋되지 않는다. 앱 코드는 배포를 위해 한 줄도 바뀌지 않는다.

| 파일 | 서버 위치 |
|---|---|
| `anvil-web.service` | `/etc/systemd/system/anvil-web.service` — 웹 UI(next start)를 띄우는 systemd 유닛 |
| `.env.production.example` | `/opt/anvil/.env.production` — API 키·DB 경로·포트 (유닛의 `EnvironmentFile`) |
| `Caddyfile.example` | `/etc/caddy/Caddyfile` — HTTPS 종단 + basic auth 리버스 프록시 (앱에 인증이 없어서 엣지에서 막는다) |

**설치·배포 절차는 [`docs/DEPLOY.md`](../docs/DEPLOY.md)가 소유한다.** 여기에 런북을 다시 쓰지 마라 —
두 곳에 적으면 반드시 갈라진다. 각 파일의 개별 설정 항목은 해당 파일의 주석이 설명한다.
