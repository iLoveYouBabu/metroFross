# Supabase 랭킹 연결

기존 꼬박게임 프로젝트 `https://lzhphyellvrprptndpfc.supabase.co`를 사용합니다. 이 게임은 `fromis_*` 테이블·함수와 `fromis-ranking-auth-v1:` 브라우저 저장 공간만 사용합니다. 꼬박게임 테이블·함수·기록은 변경하지 않습니다.

## 사용자가 한 번 실행할 작업

1. Supabase Dashboard에서 위 프로젝트를 선택합니다.
2. **SQL Editor → New query**에서 이 폴더의 `schema.sql` 전체를 붙여 넣고 **Run**을 누릅니다. SQL은 트랜잭션 안에서 전용 객체를 만들며, 같은 코스 버전으로 다시 실행해도 기록을 지우지 않습니다.
3. **Authentication → Sign In / Providers → Anonymous Sign-Ins**가 꺼져 있다면 활성화합니다. 이 SQL 자체는 Auth 설정을 변경하지 않습니다. 익명 사용자도 `authenticated` 역할을 사용하므로, 같은 프로젝트의 기존 인증 사용자 정책이 적절한지도 확인합니다.
4. 게임을 새로고침하고 닉네임을 저장합니다. 전체 14앨범 코스를 완주하면 랭킹에 등록됩니다. 앨범을 일부만 선택한 연습 기록은 온라인 순위에 보내지 않습니다.

현재 환경에는 Supabase 관리자 연결·CLI가 없어 SQL과 Auth 설정을 대신 실행하지 않았습니다. 공개 랭킹 RPC의 실제 읽기 요청으로 프로젝트 접근은 확인했으며, SQL 실행 전에는 `backend-not-ready`로 처리됩니다. 준비 중을 실제 빈 순위로 표시하지 않습니다.

## 키와 사용자 구분

`dist/data/ranking-config.json`에는 기존 꼬박게임 프런트에서 사용하던 **공개 publishable 키**만 들어갑니다. `sb_secret_`·`service_role` 키는 허용하지 않습니다. 새 publishable 키는 `apikey` 헤더로 보내고, 사용자 로그인 뒤에는 사용자의 access JWT를 `Authorization`에 보냅니다.

닉네임은 2~16자 표시 이름이며 중복될 수 있습니다. 개인 기록은 닉네임 문자열이 아닌 Supabase 익명 사용자 UUID로 묶입니다. 이메일 가입이 필요 없지만 브라우저 저장 데이터를 지우거나 다른 기기를 쓰면 같은 익명 사용자로 복구할 수 없습니다. 해당 기록은 전체 순위에는 남습니다.

## 순위 규칙

- 전체 앨범을 발매순으로 모두 선택한 코스만 서버에서 시작 티켓을 발급합니다. 배열 누락·추가·순서 변경은 서버와 프런트 모두 거부합니다.
- 등록 코스는 `fromis-full-v1-34b55b7a16952c88`, 14앨범·67곡입니다. 해시는 앨범 ID 순서와 곡 ID·표시 제목·앨범 ID·트랙 번호·허용 별칭을 고정한 JSON의 SHA-256입니다. 곡·표기·허용 입력 규칙을 변경하면 새 버전을 등록해야 합니다.
- 주간은 **최근 7일**, 전체는 해당 코스 버전의 모든 기록입니다. PC/모바일을 나누고, 각 사용자별 가장 빠른 한 기록만 표시합니다. 동률이면 정확도·기록 시각·ID 순서로 결정합니다.
- 랭킹 시간은 게임과 같은 **일시정지를 제외한 활성 시간**입니다. 서버 시작/완주 벽시계보다 큰 값, 4시간 초과, 최소 입력량 654타 기준 3,000타/분을 넘는 값, 잘못된 완료 개수·입력 카운터를 거부합니다. 시작 티켓은 24시간 뒤 만료됩니다.
- 동일 티켓을 다시 제출해도 기존 한 기록을 돌려줄 뿐 새 기록을 추가하거나 값을 바꾸지 않습니다.
- 이 검사는 전체 코스·인증 소유자·범위·중복에 대한 기본 검증입니다. 실제 키 입력을 서버에서 재생·검증하지 않으므로 완전한 부정행위 방지는 아닙니다.

## 프런트 API

`createRankingClient(config)`는 외부 SDK 없이 Supabase REST를 사용합니다. 요청은 10초 후 중단합니다.

- `configured`, `courseVersion`, `device`, `isAuthenticated()`
- `setNickname(nickname)` → `{ nickname }`
- `leaderboard({ period: 'week' | 'all', device: 'pc' | 'mobile', limit: 10 })` → `{ rank, nickname, elapsed_ms, cpm, accuracy, finished_at, is_me }[]`; 공개 읽기이므로 새 익명 사용자를 만들지 않습니다.
- `personal({ device })` → `{ nickname, best, weekBest, completedRuns, recent }`; 세션이 없으면 `identity-required` 오류입니다.
- `startRun({ albumIds, fullCourse, device })` → `{ eligible: true, run_id, started_at, course_version, track_count, device }`
- `finishRun({ runId, fullCourse, completedTrackCount, elapsedMs, correctStrokes, attemptedStrokes })` → `{ eligible: true, duplicate, record }`

일부 앨범 코스는 시작·제출 모두 네트워크 호출 없이 `{ eligible: false, reason: 'practice' }`를 반환합니다. SQL 미실행은 `backend-not-ready`, 익명 로그인 미활성화는 `auth-not-enabled`, 통신 실패는 `network`로 구분합니다.

## 검증

클라이언트 테스트는 부분 코스 차단, 실제 빈 순위와 준비 상태 구분, 익명 인증·갱신, 활성 시간 전달, 서버 티켓 사용, 닉네임, 공개 키 제한, 코스 해시 일치를 검사합니다. SQL은 이 환경에서 실제 Postgres에 실행하지 못했으므로 사용자의 SQL 실행 후 한 번 더 연결·저장 동작을 확인해야 합니다.

공식 근거: [익명 로그인](https://supabase.com/docs/guides/auth/auth-anonymous), [API 키](https://supabase.com/docs/guides/getting-started/api-keys), [RLS와 함수 권한](https://supabase.com/docs/guides/database/postgres/row-level-security), [공식 Auth REST 호출 구현](https://github.com/supabase/auth-js/blob/master/src/GoTrueClient.ts).
