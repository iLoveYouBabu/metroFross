# Supabase 닉네임 랭킹 연결

기존 꼬박게임 프로젝트 https://lzhphyellvrprptndpfc.supabase.co 를 사용합니다. 이번 버전은 **닉네임 기준** 랭킹이며 Supabase Auth·익명 로그인·사용자 JWT 세션을 사용하지 않습니다.

## 사용자가 실행할 작업

1. 기존 프로젝트의 **SQL Editor → New query**에서 이 폴더의 schema.sql 전체를 붙여 넣고 **Run**을 누릅니다.
2. 게임을 새로고침하고 사용할 닉네임을 저장합니다. **Authentication 설정을 켜거나 바꿀 필요가 없습니다.**
3. 전체 14앨범 코스를 완주하면 주간·전체 랭킹과 해당 닉네임 개인 기록에 반영됩니다. 일부 앨범 선택은 연습이며 온라인 기록 제출을 하지 않습니다.

이전에 Auth 기반 v1 SQL을 실행했어도 새 파일 전체를 다시 실행하면 됩니다. 새 fromis_nickname_profiles / fromis_nickname_runs / fromis_nickname_* RPC와 새 코스 버전을 추가합니다. **이전 fromis_profiles / fromis_runs / Auth RPC와 기록, 모든 kkobak_* 객체는 삭제하거나 바꾸지 않습니다.** 기존 Auth 기반 객체는 새 게임에서 사용하지 않으며 이전 버전 기록과 새 닉네임 기록은 섞이지 않습니다. 같은 파일 재실행은 기록을 지우지 않습니다.

## 닉네임의 의미

- 공백 정리·Unicode NFC 정규화 뒤 같은 닉네임이면 **누구나 같은 기록으로 조회·등록**합니다. 로그인이나 닉네임 소유권 검사는 없습니다.
- 닉네임을 바꾸면 다른 이름의 별도 기록을 보게 됩니다. 예전 이름의 기록은 남습니다. PC와 모바일은 같은 이름을 입력해도 기기 분류별로 나눠 표시합니다.
- 개인 기록도 비공개 계정 기록이 아니라 **그 닉네임의 공개 기록**입니다. 이름을 아는 다른 사람도 조회할 수 있습니다.
- 닉네임 길이는 2~16자이며 화면에는 일반 텍스트로 표시합니다.

## 공개 키와 완주 티켓

dist/data/ranking-config.json에는 꼬박게임에서 이미 쓰던 공개 publishable 키만 연결합니다. sb_secret_ 또는 service_role 키는 프런트에서 허용하지 않습니다. API 키는 apikey 헤더로 전송하고 새 사용자 생성·로그인·JWT 저장 요청은 하지 않습니다.

서버의 시작 RPC는 해당 판의 run_id와 run_token을 반환합니다. 완주 제출에는 둘 다 필요합니다. run_token은 해당 판의 메모리에 보관하고 로그·공유 카드·개인 기록·공개 랭킹에 노출하지 않습니다. 공개 조회 RPC는 이 토큰을 반환하지 않습니다. 테이블은 RLS와 권한 회수로 직접 접근을 막고 전용 RPC만 허용합니다.

## 순위 규칙

- 전체 앨범을 발매순으로 모두 선택한 코스만 시작 티켓을 발급합니다. 배열 누락·추가·순서 변경은 프런트와 서버 양쪽에서 거부합니다.
- 새 코스 버전은 **fromis-full-nickname-v1-34b55b7a16952c88**, 14앨범·67곡입니다. catalogHash는 앨범 ID 순서와 곡 ID·표시 제목·앨범 ID·트랙 번호·허용 별칭을 고정한 JSON의 SHA-256입니다. 입력 규칙 변경 시 새 버전을 등록해야 합니다.
- 주간은 최근 7일, 전체는 새 코스 버전의 모든 기록입니다. PC/모바일을 분리하고, **같은 닉네임의 가장 빠른 한 기록**만 표시합니다. 동률이면 정확도·완주 시각·ID 순서입니다.
- 랭킹은 기존 게임과 같은 **일시정지 제외 활성 시간**입니다. 서버 시작/완주 벽시계보다 큰 값, 4시간 초과, 최소 입력량 654타 기준 3,000타/분을 넘는 값, 잘못된 완료 개수·입력 카운터를 거부합니다. 티켓은 24시간 뒤 만료됩니다.
- 같은 티켓을 다시 제출해도 기존 기록만 반환하며 값을 덮어쓰거나 순위를 중복 추가하지 않습니다.
- 닉네임을 누구나 사용할 수 있는 방식이며 실제 키 입력을 서버에서 재생·검증하지 않습니다. 토큰·코스·범위 검사는 최소 보호이며 완전한 부정행위 방지는 아닙니다.

## 프런트 API

createRankingClient(config)는 외부 SDK 없이 REST를 사용하고 요청은 10초 후 중단합니다.

- configured / courseVersion / device / getNickname()
- useNickname(value): 로컬 닉네임만 변경하며 **네트워크를 호출하지 않습니다.**
- setNickname(value): useNickname 뒤 fromis_nickname_set RPC를 호출하여 { nickname } 반환
- leaderboard({ period: 'week' | 'all', device: 'pc' | 'mobile', limit: 10, nickname }): { rank, nickname, elapsed_ms, cpm, accuracy, finished_at, is_me }[]
- personal({ device, nickname }): { nickname, best, weekBest, completedRuns, recent }. nickname을 생략하면 현재 선택 이름 사용
- startRun({ albumIds, fullCourse, device, nickname }): { eligible: true, run_id, run_token, started_at, course_version, track_count, device }
- finishRun({ runId, runToken, fullCourse, completedTrackCount, elapsedMs, correctStrokes, attemptedStrokes }): { eligible: true, duplicate, record }

일부 앨범 코스는 시작·제출 모두 네트워크 호출 없이 { eligible: false, reason: 'practice' } 반환합니다. SQL 미실행은 backend-not-ready, 통신 실패는 network, 닉네임 미입력은 nickname-required로 구분합니다. 준비 중을 실제 빈 순위로 표시하지 않습니다.

## 검증 범위

클라이언트 테스트는 부분 코스 차단, 준비 상태와 빈 순위 구분, Auth 요청·JWT 스토리지 접근 없음, 닉네임 개인 조회, 발급 티켓 전달, 활성 시간, 공개 키 제한, 코스 해시 일치를 확인합니다. SQL은 실제 Postgres에서 실행하지 못했으므로 사용자 SQL 실행 후 공개 API 조회와 시험 완주 저장을 한 번 더 확인해야 합니다.

공식 근거: [공개 API 키](https://supabase.com/docs/guides/getting-started/api-keys), [RLS와 함수 권한](https://supabase.com/docs/guides/database/postgres/row-level-security).
