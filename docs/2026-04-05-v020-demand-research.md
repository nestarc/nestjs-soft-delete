# @nestarc/soft-delete v0.2.0 수요 리서치

> 조사일: 2026-04-05

## 1. 시장 포지션

**@nestarc/soft-delete는 npm에 존재하는 유일한 NestJS 전용 soft-delete 패키지이다.**

NestJS core의 주간 다운로드가 800만 이상임에도 불구하고, 전용 soft-delete 모듈은 존재하지 않았다. 기존 솔루션은 모두 ORM 전용이거나 대형 CRUD 프레임워크의 하위 기능이다.

## 2. 경쟁 패키지 다운로드 현황

| 패키지 | 주간 다운로드 | 비고 |
|--------|-------------|------|
| `prisma-extension-soft-delete` | 26,699 | Prisma 전용, NestJS 통합 없음 |
| `prisma-soft-delete-middleware` | 13,667 | **deprecated** (extension으로 대체됨) |
| `@nestjsx/crud-typeorm` | 26,114 | soft-delete는 하위 기능 |
| `@nestjs-query/query-typeorm` | 6,110 | soft-delete는 하위 기능 |
| `soft-delete-plugin-mongoose` | 796 | Mongoose 전용, 소규모 |

### 핵심 인사이트

- `prisma-extension-soft-delete`가 26K 다운로드를 달성한 것은 Prisma 생태계만으로도 충분한 수요가 있음을 증명
- 해당 패키지는 NestJS 모듈 시스템, 데코레이터, DI 통합이 전혀 없음
- @nestarc/soft-delete는 이 패키지가 제공하는 기능을 모두 포함하면서 NestJS 네이티브 통합을 추가로 제공

## 3. ORM별 주요 불만사항

### TypeORM (미해결 이슈 10건 이상)

| 이슈 | 내용 | 연도 |
|------|------|------|
| #534 | 최초 soft-delete 기능 요청 (높은 참여도) | 2017 |
| #5877 | Cascade soft-delete가 relation에서 동작하지 않음 | 2020 |
| #6265 | `find` with relations가 soft-deleted 엔티티를 반환 | 2020 |
| #7549 | Unique index와 soft-delete 충돌 | 2021 |
| #8386 | `softDelete`가 `@BeforeRemove` 훅을 트리거하지 않음 | 2021 |
| #8960 | one-to-many relation의 soft-deleted 레코드를 restore 불가 | 2022 |
| #9473 | 포함된 relation이 soft-deleted일 때 엔티티 미반환 | 2022 |
| #10081 | soft-deleted relation을 조회할 수 없음 (withDeleted 미적용) | 2023 |
| #10272 | softDelete로 삭제된 relation이 join에서 로드되지 않음 | 2023 |
| #10389 | softDelete가 이미 삭제된 행을 재업데이트함 | 2023 |
| #11906 | QueryBuilder에서 `withDeleted()` 위치가 relation 필터링에 영향 | 2024 |
| #12251 | soft-remove 문서 부족 | 2025 |

### Prisma

1. **네이티브 soft-delete 미지원** — middleware(deprecated) 또는 client extension 필요
2. **중첩 relation 미지원** — extension 타입이 nested read/write를 지원하지 않음
3. **toOne 관계 에러** — soft-deleted 레코드를 toOne relation에서 필터링할 수 없음
4. **복합 필터 실패** — `some`, `every`, `none` 연산자가 soft-delete 필터링과 호환 불가
5. **스키마 변경 요구** — soft-deletable 모델의 toOne relation을 optional로 변경해야 함

### Sequelize (paranoid mode)

1. **Cascade soft-delete 미지원** — 부모 삭제 시 자식에 전파되지 않음
2. **FK 제약조건 미처리** — 부모 soft-delete 시 자식 FK가 그대로 유지됨
3. **이미 soft-deleted된 레코드의 hard-delete 시 훅 미트리거**
4. **Association 로딩 비일관성** — 때때로 soft-deleted 엔티티가 반환되거나 누락됨

## 4. 사용자 요구 기능 순위

GitHub 이슈, Stack Overflow 질문, 블로그 글 기반 종합:

| 순위 | 기능 | 수요 출처 |
|------|------|----------|
| 1 | **Cascade soft-delete** | TypeORM #5877, Sequelize 공통, 모든 ORM에서 미지원 |
| 2 | **Cascade restore** | TypeORM #8960, 관계형 복원 |
| 3 | **Relation-aware 쿼리** | TypeORM #6265/#9473/#10081/#10272, Prisma nested relation |
| 4 | **Unique 제약조건 처리** | TypeORM #7549, Stack Overflow 상위 질문 |
| 5 | **라이프사이클 이벤트** | TypeORM #8386, 모든 ORM에서 soft-delete 시 이벤트 미발생 |
| 6 | **자동 쿼리 필터링** | 수동 WHERE 절 없이 투명하게 필터링 |
| 7 | **감사 추적** | deletedBy, 삭제 시각 기록 |
| 8 | **벌크 작업** | 다수 레코드 일괄 soft-delete/restore |
| 9 | **스케줄 하드딜리트** | 오래된 soft-deleted 레코드 주기적 영구 삭제 |
| 10 | **테스트 유틸리티** | soft-delete 동작 검증용 헬퍼 |

## 5. v0.1.0이 이미 해결한 것

| 기능 | 상태 |
|------|------|
| Cascade soft-delete | **해결** (DMMF 기반 재귀 처리) |
| Cascade restore | **해결** (timestamp 매칭 ±1초) |
| 자동 쿼리 필터링 | **해결** (Prisma extension + interceptor) |
| 감사 추적 (deletedBy) | **해결** (actorExtractor middleware) |
| 벌크 작업 (deleteMany) | **해결** (extension이 deleteMany 인터셉트) |
| 테스트 유틸리티 | **해결** (TestSoftDeleteModule, expectSoftDeleted) |
| NestJS 데코레이터 | **해결** (@WithDeleted, @OnlyDeleted, @SkipSoftDelete) |

## 6. 기존 솔루션의 구조적 공백

| 공백 | 상세 |
|------|------|
| NestJS 전용 패키지 부재 | 전용 패키지 0개. 모든 솔루션이 ORM 전용 또는 대형 프레임워크 하위 기능 |
| ORM 비종속 솔루션 부재 | 모든 솔루션이 하나의 ORM에 강결합. ORM 전환 시 전체 재작성 필요 |
| Cascade 작업 보편적 실패 | TypeORM, Prisma, Sequelize 모두 cascade soft-delete 미지원 |
| 데코레이터 기반 접근법 부재 | NestJS는 데코레이터 중심인데 soft-delete 데코레이터를 제공하는 패키지 없음 |
| 복원 엔드포인트 미제공 | REST/GraphQL 복원 엔드포인트를 자동 생성하는 프레임워크 없음 |
| Relation 처리가 최대 미해결 문제 | 모든 ORM에서 relation 내 soft-deleted 레코드 관리가 비일관적 |
| Unique 제약조건 미해결 | soft-deleted 행의 unique index 점유 문제를 깔끔하게 해결하는 솔루션 없음 |
| 이벤트 시스템 부재 | soft-delete/restore 시 NestJS 호환 이벤트를 발행하는 패키지 없음 |

## 7. v0.2.0 후보 기능 분석

### Tier 1 — 높은 수요 + 차별화 가능

| 기능 | 수요 근거 | 난이도 | v0.1.0 대비 가치 |
|------|----------|--------|----------------|
| **이벤트 시스템** (NestJS EventEmitter) | TypeORM #8386 등. 감사 로그, 검색 인덱스 동기화, 알림 등 downstream 처리의 핵심 | 중 | 생태계 통합 차별화 |
| **스케줄 하드딜리트 (Purge)** | 운영 환경 필수. 오래된 soft-deleted 레코드 주기적 영구 삭제 | 중 | 운영 성숙도 |
| **README/문서 보강** | 현재 README 최소한. API 레퍼런스, 사용 예제, 마이그레이션 가이드 | 저 | 채택률 직접 영향 |

### Tier 2 — 높은 수요 + 부분적 해결 가능

| 기능 | 수요 근거 | 난이도 | 비고 |
|------|----------|--------|------|
| **Unique 제약조건 가이드** | TypeORM #7549, SO 상위 질문 | 중 | Prisma 스키마 레벨 전략 가이드 + 헬퍼 |
| **Relation-aware 쿼리 개선** | Prisma/TypeORM 최대 불만 | 고 | Prisma extension 타입 제한으로 완전 해결 어려움 |

### Tier 3 — 미래 로드맵

| 기능 | 비고 |
|------|------|
| ORM 비종속 추상화 | TypeORM/Sequelize 어댑터 (v0.3.0+) |
| 자동 REST/GraphQL 복원 엔드포인트 | @nestjs/swagger 통합 (v0.3.0+) |
| Admin UI 통합 | 휴지통 UI 컴포넌트 (v0.4.0+) |

## 8. 추천 v0.2.0 스코프

**이벤트 시스템 + Purge + 문서 보강**

- 이벤트: `SoftDeletedEvent`, `RestoredEvent`, `PurgedEvent` — NestJS EventEmitter2 통합
- Purge: `SoftDeleteService.purge(model, { olderThan })` + 선택적 @nestjs/schedule Cron
- 문서: 포괄적 README, API 레퍼런스, Quick Start, 마이그레이션 가이드
- Unique 제약조건: 문서 내 Prisma 스키마 전략 가이드로 포함
