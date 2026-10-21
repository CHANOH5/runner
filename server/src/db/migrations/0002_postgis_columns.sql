-- 공간 컬럼 (raw SQL). Drizzle 스키마(src/db/schema)에는 두지 않는다.
-- 대회장 위치: 관리자 웹에서 NCP Geocoding으로 채우고 수동 수정 가능 (D-008). WGS84.
ALTER TABLE "races" ADD COLUMN "venue_point" geography(Point, 4326);
