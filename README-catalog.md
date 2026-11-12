# 곡 카탈로그 근거

확인 기준일: **2026-11-12 (한국 시간)**

게임은 기억력 퀴즈가 아니라 현재 보이는 곡 제목을 그대로 입력하는 타이핑 게임이다. 카탈로그는 **프로미스나인 / fromis_9 그룹 명의의 정식 발매 고유 곡 77곡, 최초 수록 발매 25개**를 발매일과 실제 트랙 번호 순서로 구성한다.

## 포함 기준

- 국내외 정규·미니·싱글의 원곡과 그룹 명의 OST, 프로젝트 리메이크, 정식 음원으로 나온 방송 경연곡을 포함한다.
- 그룹 앨범 안의 유닛곡도 포함한다. 참가 인원수가 아니라 정식 음원의 아티스트 명의를 기준으로 한다.
- 일본 데뷔 EP의 새 오리지널곡 **Sky Runner**를 포함한다. 실제 수록 번호는 3번이다.
- **별**은 실제 가창이 일부 멤버여도 음원 서비스의 공식 아티스트가 프로미스나인이므로 포함한다.
- **다함께 차차차**, **난 사랑을 아직 몰라**는 정식 발매된 그룹 명의 경연 음원이다. 현재 권리사의 요청으로 서비스가 중단된 상태지만 발매 이력은 확인되므로 포함한다.
- 짧은 인트로 **나에게로 오는 길 (Intro.)**도 앨범의 고유 트랙이므로 포함한다.
- 데이터는 곡 제목과 앨범 메타데이터만 포함한다. 가사·음원·미리듣기는 포함하지 않는다.

## 제외 기준과 경계 사례

- 동일 곡은 최초 발매 한 번만 입력한다. `To. Heart` 6번 **유리구두 (MAMA Ver.)**, `From.9` 4·5번 **두근두근(DKDK) (From.9 ver.)**, **22세기 소녀 (From.9 ver.)**는 재녹음/버전 중복으로 제외한다.
- 모든 **Inst. / instrumental**, 리믹스, 기존곡의 일본어·영어 등 언어별 버전은 별도 곡으로 세지 않는다. 따라서 일본 EP에서는 **LIKE YOU BETTER (Japanese ver.)**, **Love=Disaster (Japanese ver.)** 및 반주곡을 제외한다.
- OST 종합 앨범에 다시 실린 **Stay Alive**, **Touchdown** 등은 최초 Part 발매만 유지한다.
- `월간남친 Part 2` 전체 18곡 가운데 프로미스나인 명의 **Swipe It Out**만 포함한다. 다른 가수의 노래와 BGM을 그룹 곡으로 취급하지 않는다.
- 개별 멤버 명의 솔로, 듀오, 외부 가수 피처링은 이번 그룹 코스에서 제외한다. 예: **지금부터 시작해**(박지원·이나경), **봄처럼 다가와**(송하영·이나경), **Fall in Love**, **Cloud**, **What are we** 등. 추후 별도 멤버 코스가 필요하면 분리된 데이터로 확장할 수 있다.
- 정식 음원으로 발매되지 않은 콘서트·방송·유튜브 커버와 데뷔 이전 `아이돌학교` 출연자 명의 음원은 제외한다.
- 발표 예정 소식만 있고 기준일 현재 정식 발매되지 않은 곡은 넣지 않는다.

## 표기와 순서 결정

- 대표 제목은 국내 공식 음원 서비스 Bugs의 곡 제목 표기를 우선한다. 한국어 제목 뒤의 번역명은 임의로 덧붙이지 않는다. Bugs가 원제로 등록한 **Feel Good (SECRET CODE)**, **두근두근(DKDK)**, **나에게로 오는 길 (Intro.)** 등의 괄호·부제는 그대로 보존한다.
- `aliases`에는 공식 해외 표기 또는 플랫폼 간 대소문자·띄어쓰기 차이를 기록한다. 예: 유리구두 / Glass Shoes, 눈맞춤 / Eye Contact. 표시와 기본 타이핑 대상은 `title`이다.
- 발매일 오름차순으로 앨범을 정렬하고 각 앨범의 실제 트랙 번호를 유지한다. 선택된 곡만 남아도 번호를 다시 매기지 않는다. 예: **다함께 차차차 = 2**, **Sky Runner = 3**.
- 공식 일본 구 사이트는 `9 WAY TICKET`을 2021-05-18로 적고 있으나 국내 공식 음원 카탈로그의 최초 발매일 **2021-05-17**을 적용했다. 다른 시차 표기도 최초 국내 발매일을 따른다.
- **트라이 OST Part.2**의 최초 발매일은 국내 Bugs 기준 **2025-08-01**이다.
- 커버는 공식 음원 플랫폼의 앨범 이미지를 내려받아 `dist/assets/covers/{albumId}.jpg`에 둔다. `cover`는 로컬 경로, `coverUrl`은 원본 출처 URL이다. 이미지의 권리는 해당 권리자에게 있다.

## 발매별 수록 수와 출처

| 최초 발매일 | 발매 | 게임 수록 | 원본 |
| --- | --- | ---: | --- |
| 2017-11-30 | 유리구두 | 1 | [Bugs](https://music.bugs.co.kr/album/689232) |
| 2018-01-24 | To. Heart | 5 | [Bugs](https://music.bugs.co.kr/album/20143775) |
| 2018-06-05 | To. Day | 6 | [Bugs](https://music.bugs.co.kr/album/20171348) |
| 2018-10-10 | From.9 | 3 | [Bugs](https://music.bugs.co.kr/album/20198815) |
| 2019-03-23 | 불후의 명곡 - 전설을 노래하다 (인생의 희노애락을 노래하다 작사가 김병걸) | 1 | [Bugs](https://music.bugs.co.kr/album/20240150) |
| 2019-06-04 | FUN FACTORY | 3 | [Bugs](https://music.bugs.co.kr/album/20258300) |
| 2020-09-16 | My Little Society | 5 | [Bugs](https://music.bugs.co.kr/album/20349698) |
| 2021-05-17 | 9 WAY TICKET | 3 | [Bugs](https://music.bugs.co.kr/album/20397338) |
| 2021-09-01 | Talk & Talk | 1 | [Bugs](https://music.bugs.co.kr/album/4064450) |
| 2021-09-08 | 싸이월드 BGM 2021 | 1 | [Bugs](https://music.bugs.co.kr/album/20419820) |
| 2021-11-20 | 불후의 명곡 - 아티스트 백두산 유현상 편 | 1 | [Bugs](https://music.bugs.co.kr/album/4067793) |
| 2022-01-17 | Midnight Guest | 5 | [Bugs](https://music.bugs.co.kr/album/4070232) |
| 2022-03-15 | 크레이지 러브 OST Part.2 | 1 | [Bugs](https://music.bugs.co.kr/album/20455872) |
| 2022-06-27 | from our Memento Box | 5 | [Bugs](https://music.bugs.co.kr/album/4077170) |
| 2022-07-24 | 달빛바다 | 1 | [Bugs](https://music.bugs.co.kr/album/4078026) |
| 2023-06-05 | Unlock My World | 10 | [Bugs](https://music.bugs.co.kr/album/4087396) |
| 2023-10-11 | Love Me Back (작전명 순정 X 프로미스나인) | 1 | [Bugs](https://music.bugs.co.kr/album/4091871) |
| 2024-08-12 | Supersonic | 3 | [Bugs](https://music.bugs.co.kr/album/4105386) |
| 2024-12-23 | from | 1 | [Bugs](https://music.bugs.co.kr/album/4112113) |
| 2025-06-25 | From Our 20's | 6 | [Bugs](https://music.bugs.co.kr/album/20735911) |
| 2025-08-01 | 트라이 OST Part.2 | 1 | [Bugs](https://music.bugs.co.kr/album/4124391) |
| 2025-12-02 | 하얀 그리움 | 1 | [Bugs](https://music.bugs.co.kr/album/20774246) |
| 2026-03-17 | 월간남친 Part 2 (Soundtrack from the Netflix Series) | 1 | [Bugs](https://music.bugs.co.kr/album/4143170) |
| 2026-04-01 | LIKE YOU BETTER (Japanese ver.) | 1 | [Bugs](https://music.bugs.co.kr/album/4144419) |
| 2026-07-21 | Glow ME | 10 | [Bugs](https://music.bugs.co.kr/album/20827312) |

## 주요 1차 자료

- [Bugs 공식 아티스트 발매 앨범 목록](https://music.bugs.co.kr/artist/20047596/albums): 전체 발매 목록, 최신 2026년 발매 여부, 국내 발매일과 공식 아티스트 명의 확인.
- [fromis_9 공식 일본 구 사이트 디스코그래피](https://www.fromis9.jp/discography): 2017–2023 앨범 트랙 순서 및 공식 해외 곡명 교차 확인. 최신 카탈로그의 유일한 자료로 쓰지 않는다.
- [Universal Music Japan 공식 일본 EP 상품 페이지](https://www.universal-music.co.jp/fromis9/products/umck-7310/): 2026-04-01 발매, 총 6트랙 중 Sky Runner가 3번 신곡임을 확인.
- [Genie 2019년 불후의 명곡 발매 페이지](https://www.genie.co.kr/detail/albumInfo?axnm=81176379): 다함께 차차차가 2번 트랙임을 확인.
- [Bugs 2021년 불후의 명곡 발매 페이지](https://music.bugs.co.kr/album/4067793): 난 사랑을 아직 몰라 1번, 2021-11-20 발매와 현재 권리 제한 확인.
- [Apple Music From Our 20's](https://music.apple.com/kr/album/from-our-20s-ep/1821787094), [하얀 그리움](https://music.apple.com/kr/album/white-memories-single/1856551390), [월간남친 OST Part 2](https://music.apple.com/kr/album/boyfriend-on-demand-part-2-soundtrack-from-the/1884557901), [Glow ME](https://music.apple.com/kr/album/glow-me/6791520495): 2025–2026 발매일 교차 확인.

각 발매의 개별 출처는 `dist/data/discography.json`의 `albums[].sources`에도 기록했다. 기준일 이후 새 발매는 검증한 공식 출처와 함께 이 파일에 추가한다.

