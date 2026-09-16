#!/bin/sh
# 컨테이너가 뜰 때 딱 한 가지를 확인한다: **운영 티 시트가 시드 데이터로 시작하지
# 않게 하는 것.**
#
# `tee_sheet_store._ensure_loaded()` 는 데이터 파일이 없으면 `seed_bookings()` 를
# 써서 파일을 만든다. 로컬 개발에서는 편하지만 운영에서는 사고다 - 프로 샵 격자에
# 존재하지 않는 손님 예약이 잔뜩 찍힌 채로 문을 열게 된다. 그래서 파일이 없을 때만
# 빈 목록으로 만들어 둔다. 저장소가 시드를 굽기 전에 우리가 먼저 굽는 셈이다.
# (TEE_SHEET_BACKEND=supabase 에서는 이 파일을 읽지 않는다. json 으로 되돌릴 때를
# 위한 안전장치로 남겨 둔다.)
#
# 이미 있으면 손대지 않는다. 볼륨이 살아 있는 한 재시작·재배포는 아무 일도 하지
# 않는다 (idempotent).
#
# 상점 재고(retail)와 시뮬레이터 베이(simulator)는 일부러 그냥 둔다. 저 둘의
# 시드는 가짜 거래가 아니라 **상품 목록과 실제 베이 목록**이라 운영에서도 맞는
# 출발점이다.
set -e

if [ -n "$TEE_SHEET_DATA_FILE" ] && [ ! -f "$TEE_SHEET_DATA_FILE" ]; then
  mkdir -p "$(dirname "$TEE_SHEET_DATA_FILE")"
  printf '[]' > "$TEE_SHEET_DATA_FILE"
  echo "entrypoint: seeded an EMPTY tee sheet at $TEE_SHEET_DATA_FILE"
fi

exec "$@"
