# 대시보드 Docker 배포

이 구성은 대시보드만 Docker에 넣습니다. 오케스트레이터, Claude Agent SDK, Codex CLI,
git 작업 디렉터리는 기존처럼 호스트 터미널에서 실행합니다.

## 보안 모델

- Docker 포트는 기본적으로 호스트의 `127.0.0.1:3737`에만 바인딩됩니다.
- 대시보드는 `DASHBOARD_AUTH_REQUIRED=true`일 때 Basic Auth를 요구합니다.
- 외부에서 접속하려면 SSH 터널, VPN, Cloudflare Access 같은 별도 사설 접근 경로를 붙이는
  구성이 안전합니다. 서버 방화벽에서 `3737`을 인터넷에 직접 열지 마세요.

## 1. 호스트에서 오케스트레이터 실행

호스트 터미널에서 Claude/Codex 로그인이 된 상태로 오케스트레이터만 실행합니다.

```bash
npm run orchestrator
```

오케스트레이터가 컨테이너에서 접근 가능해야 합니다. 기본 compose 설정은 컨테이너에서
`http://host.docker.internal:4000`으로 호스트 오케스트레이터를 호출합니다.

순수 Linux Docker에서 대시보드가 오케스트레이터에 연결하지 못하면, 오케스트레이터를
인터넷 공개 IP가 아니라 Docker bridge gateway 주소에만 바인딩하세요.

```bash
ip -4 addr show docker0
ORCH_HOST="172.17.0.1" npm run orchestrator
export ORCH_INTERNAL_URL="http://172.17.0.1:4000"
```

`172.17.0.1`은 흔한 기본값입니다. 실제 서버의 `docker0` 주소와 다르면 그 값을 쓰세요.

## 2. 대시보드 인증값 설정

```bash
export DASHBOARD_USERNAME="me"
export DASHBOARD_PASSWORD="change-this-long-password"
```

기존 `.env`의 `DATABASE_URL`이 `file:./prisma/dev.db`라면 그대로 사용할 수 있습니다.
다른 SQLite 경로를 쓴다면 compose 실행 전에 같은 값을 export 하세요.

## 3. 대시보드 컨테이너 실행

```bash
docker compose -f docker-compose.dashboard.yml up --build -d
```

브라우저에서는 호스트에서만 아래 주소로 접속합니다.

```text
http://127.0.0.1:3737
```

원격 서버에서 쓰는 경우 로컬 PC에서 SSH 터널을 엽니다.

```bash
ssh -L 3737:127.0.0.1:3737 user@server
```

그 다음 로컬 브라우저에서 `http://127.0.0.1:3737`로 접속합니다.

## 운영 메모

- 컨테이너에는 Claude API 키나 Claude/Codex 로그인 정보를 넣지 않습니다.
- 대시보드가 DB를 직접 읽으므로 `./prisma` 디렉터리를 컨테이너의 `/app/prisma`에 마운트합니다.
- 대시보드가 run 시작/승인을 호출할 때만 호스트 오케스트레이터로 프록시합니다.
- 인터넷에 공개해야 한다면 Basic Auth만 믿지 말고 Cloudflare Access, Tailscale, WireGuard,
  nginx allowlist 같은 외부 접근 제어를 앞단에 두세요.
