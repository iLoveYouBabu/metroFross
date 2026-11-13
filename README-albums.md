# 실물 앨범 타이핑 코스

확인 기준일: **2026-11-14 (한국 시간)**

`dist/data/album-course.json`은 정식 상업 발매된 프로미스나인 **실물 앨범 14종·고유 곡 67곡**을 발매일과 실제 트랙 번호 순서로 정리한 게임 전용 코스다. 정규 앨범, 미니 앨범/EP, 실물 싱글 앨범을 포함한다. 기존 전체 발매 자료인 `dist/data/discography.json`은 보존한다.

## 선택 기준

- CD가 실제 판매된 앨범을 포함한다. 공식 회사/스토어의 발매 공지와 상품 구성, 또는 정식 음반 판매처의 CD 상품 정보를 근거로 한다.
- 디지털 싱글, OST, 외부 프로젝트, 방송 경연 컴필레이션은 이번 코스에서 제외한다. 이 발매들이 가짜이거나 그룹 곡이 아니라는 뜻은 아니다. 전체 발매 자료에는 남겨 둔다.
- 앨범의 다른 커버·멤버판·CD/KiT/플랫폼판·LP 재발매를 별도 앨범이나 추가 고유 곡으로 세지 않는다.
- 같은 고유 곡은 **선택된 실물 앨범 안에서 처음 수록된 위치**에서 한 번 입력한다. 재수록·재녹음·언어별 버전·반주곡을 반복 입력하지 않는다.
- 디지털로 먼저 공개됐더라도 뒤에 선택된 실물 앨범에 수록된 곡은 남긴다. 디지털 선공개 음반을 코스에서 뺐다고 그 노래까지 사라지지 않게 한다.
- 해외 배송·재입고일을 최초 국내 발매일과 혼동하지 않는다. 국내 앨범은 원래 발매일을, 일본 오리지널 EP는 일본 최초 발매일을 적용한다.

## 유리구두와 버전 처리

2017-11-30의 디지털 선공개 싱글 `유리구두`는 이번 실물 코스에서 제외한다. 그러나 `To. Heart` CD의 실제 6번 트랙 **유리구두 (MAMA Ver.)**는 실물 코스 안의 첫 수록이므로 포함한다.

- 새 코스 ID: `to-heart-06`
- 화면의 대표 제목: `유리구두`
- 실제 판본: `versionTitle: "유리구두 (MAMA Ver.)"`
- 검증된 판본 표기를 `aliases`에 보존한다.
- 원래 디지털 발매 ID는 `originalTrackId: "glass-shoes-01"`로 연결한다.
- [YES24 최초 CD 상품](https://m.yes24.com/goods/detail/58072601)의 디스크 목록과 [공식 디스코그래피](https://www.fromis9.jp/discography)에서 6번 판본을 직접 확인했다.

`From.9` CD의 4·5번 `두근두근(DKDK) (From.9 Ver.)`, `22세기 소녀 (From.9 Ver.)`는 앞선 `To. Day`에서 이미 입력한 고유 곡의 재녹음이므로 반복하지 않는다. 일본 EP도 기존 두 곡의 일본어판과 반주를 제외하고 새 오리지널곡 `Sky Runner` 3번만 포함한다.

## 실물 발매와 수록 수

| 최초 발매일 | 앨범 | 코스 수록 | 실물 포함 근거 |
| --- | --- | ---: | --- |
| 2018-01-24 | To. Heart | 6 | [YES24 CD 상품](https://m.yes24.com/goods/detail/58072601): CD·앨범 사양과 6곡 디스크 목록 |
| 2018-06-05 | To. Day | 6 | [YES24 CD 상품](https://m.yes24.com/Goods/Detail/61248947): D-1 / D-Day 판본의 CD |
| 2018-10-10 | From.9 | 3 | [YES24 CD 상품](https://global.yes24.com/Goods/64744913): CD와 최초 발매일. 실제 CD 5곡 중 재녹음 2곡 제외 |
| 2019-06-04 | FUN FACTORY | 3 | [Ktown4u 상품](https://www.ktown4u.com/iteminfo?goods_no=38300): 구성품 CD. 상품의 해외 입고일과 최초 발매일을 구분 |
| 2020-09-16 | My Little Society | 5 | [Weverse 공식 상품](https://shop.weverse.io/en/shop/USD/artists/35/sales/5084): CD 제공 명시 |
| 2021-05-17 | 9 WAY TICKET | 3 | [Ktown4u 상품](https://kr.ktown4u.com/iteminfo?goods_no=55823): 발매일과 포토북·CD-R 명시 |
| 2021-09-01 | Talk & Talk | 1 | [Weverse 공식 판매 공지](https://shop.weverse.io/zh-tw/shop/USD/artists/35/notices/1074): 1 CD·포토북 명시 |
| 2022-01-17 | Midnight Guest | 5 | [공식 일본 사이트](https://fromis9.jp/midnightguest): 정규판/Jewel Case 판본 CD-R과 수록 내용 명시 |
| 2022-06-27 | from our Memento Box | 5 | [Weverse 공식 상품](https://shop.weverse.io/en/shop/USD/artists/35/sales/8585): 발매일·CD 제공 명시 |
| 2023-06-05 | Unlock My World | 10 | [Weverse 공식 상품](https://shop.weverse.io/en/shop/USD/artists/2/sales/15237): 1st Album·발매일·CD 제공 명시 |
| 2024-08-12 | Supersonic | 3 | [Weverse 공식 상품](https://shop.weverse.io/en/shop/KRW/artists/35/sales/27541): 3rd Single Album·발매일·CD 제공 명시 |
| 2025-06-25 | From Our 20's | 6 | [Ktown4u Photobook 상품](https://www.ktown4u.com/iteminfo?eve_no=43486830&goods_no=140494&grp_no=43486831): 발매일·CD-R·Dreamus 제조 정보 |
| 2026-04-01 | LIKE YOU BETTER (Japanese ver.) | 1 | [Universal Music Japan 공식 상품](https://www.universal-music.co.jp/fromis9/products/umck-7310/): CD+Photobook·발매일·3번 신곡 Sky Runner |
| 2026-07-21 | Glow ME | 10 | [MAKESTAR 정식 판매 공지](https://www.makestar.com/product/19126): Photobook 판본의 발매·배송·음반 차트 반영 안내 |
| **합계** | **14종** | **67** | |

각 앨범의 `physicalEvidence`에 판매처, URL, 실제 확인한 상품 정보를 남겼다. `sources`에는 기존 공식 트랙·발매 자료와 실물 발매 근거를 함께 보존했다. 로컬 재킷은 기존 `assets/covers/{albumId}.jpg`를 재사용하며 원본 출처는 `assets-manifest.json`에 있다.

## 제외한 발매

- 디지털 싱글 3종: `유리구두`, `from`, `하얀 그리움`.
- OST 4종: `크레이지 러브 OST Part.2`, `Love Me Back (작전명 순정 X 프로미스나인)`, `트라이 OST Part.2`, `월간남친 Part 2`.
- 외부 프로젝트 2종: `싸이월드 BGM 2021`, `달빛바다`.
- 방송 경연 2종: 2019년·2021년 `불후의 명곡` 발매.
- 관련 굿즈·시즌 그리팅·MD 키트의 존재만으로 음반에 포함하지 않는다. `하얀 그리움`은 [공식 MV](https://www.youtube.com/watch?v=5ZB9JLfIw_Q)에서도 Special Digital Single로 안내된다.
- 앨범 자체를 제외한 내역과 CD/일본 EP의 중복 버전·반주를 제외한 내역은 JSON의 `excluded`에 각각 이유와 출처를 기록했다.

## 초동 차트와의 관계

이 파일은 **어떤 실물 앨범과 곡을 입력하는가**를 정의한다. 앨범이 실물로 발매됐다는 사실만으로 한터 초동 판매량까지 확인됐다고 판단하지 않는다.

- 판매량은 별도 검증된 초동 차트 자료를 앨범 ID로 연결한다.
- 한터 초동, 한터 달력 주간, 써클 출하량, 오리콘 주간 판매량은 서로 다른 지표다.
- 일본 EP의 실물 발매와 신곡은 확인됐으므로 코스 메타데이터에 포함한다. 한터 초동이 확인되지 않으면 판매량을 추정하거나 오리콘 수치로 대신하지 않는다.
- 원곡 수록 수나 앨범 완성도가 판매량의 크기를 뜻하지 않는다. 같은 앨범의 여러 판본을 게임 진행 단계로 반복하지 않는다.
