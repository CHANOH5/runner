import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/** PK: UUID v7 (시간 정렬). PostgreSQL 16에는 uuidv7()이 없어 애플리케이션에서 만든다. */
export const pk = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => timestamptz('created_at').notNull().defaultNow();

export const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/*
 * 공간 컬럼(geography)은 Drizzle 스키마에 두지 않는다.
 * 컬럼은 raw SQL 마이그레이션(0002_postgis_columns.sql)으로 만들고, 읽기·쓰기도 sql`...`로 한다.
 *   races.venue_point geography(Point, 4326)
 */
