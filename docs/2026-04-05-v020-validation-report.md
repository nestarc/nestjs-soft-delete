# 0.2.0 검증 리포트

- 작성일: 2026-04-05
- 대상 버전: `@nestarc/soft-delete@0.2.0`
- 판정: 자동 검증은 통과했지만, NestJS 통합 경로에 치명적인 불일치가 있어 현재 상태로는 릴리스 보류를 권고함

## 1. 실행한 검증

### 자동 검증

| 항목 | 명령 | 결과 |
|---|---|---|
| Lint | `npm run lint` | 통과 |
| Unit Test | `npm test` | 통과 (`13` files, `141` tests) |
| Build | `npm run build` | 통과 |
| E2E | `DATABASE_URL=postgresql://test:test@localhost:5432/soft_delete_test npm run test:e2e` | 통과 (`1` file, `10` tests) |
| Pack 검증 | `npm pack --dry-run` | 통과 (`nestarc-soft-delete-0.2.0.tgz`, `18` files) |

### E2E 환경

- 로컬 Docker로 PostgreSQL 15 컨테이너를 기동해 검증했다.
- 테스트 후 컨테이너와 네트워크는 정리했다.
- 참고로 e2e는 샌드박스 내부에서 `esbuild` 프로세스 spawn 권한 문제(`EPERM`)가 있어, 동일 명령을 샌드박스 밖에서 재실행해 결과를 확인했다.

## 2. 주요 Findings

### [P1] `SoftDeleteModule`이 Prisma extension을 적용하지 않음

- README는 `SoftDeleteModule.forRoot()`만 등록하면 `this.prisma.user.delete()`가 soft-delete로 전환되고 `findMany()`가 자동 필터링된다고 설명한다.
- 하지만 실제 구현인 `src/soft-delete.module.ts:12-74`는 옵션 토큰, Prisma alias, 서비스, 인터셉터, 미들웨어만 등록할 뿐, `createPrismaSoftDeleteExtension()` 호출이나 `$extends()` 적용이 전혀 없다.
- 따라서 NestJS 사용자가 README의 Quick Start대로만 적용하면 실제 Prisma client는 확장되지 않고, `delete()`는 하드 삭제로 남고 조회 필터도 적용되지 않는다.
- 관련 근거:
  - `src/soft-delete.module.ts:12-74`
  - `README.md:69-133`

### [P1] `restore()`의 cascade 복구가 Nest 모듈 경로에서 동작할 수 없음

- `SoftDeleteService.restore()`는 cascade 복구를 위해 선택적으로 `CascadeHandler`를 주입받고 이를 호출한다.
- 하지만 `SoftDeleteModule`과 `TestSoftDeleteModule` 어디에서도 `CascadeHandler`를 provider로 등록하지 않는다.
- 결과적으로 Nest 모듈 기반 사용에서는 `cascade` 옵션을 주더라도 `restore()` 호출 시 하위 모델 복구가 실행되지 않는다.
- README는 cascade restore가 지원된다고 명시하고 있어 문서-구현 불일치가 발생한다.
- 관련 근거:
  - `src/services/soft-delete.service.ts:14-18`
  - `src/services/soft-delete.service.ts:62-71`
  - `src/soft-delete.module.ts:12-74`
  - `src/testing/test-soft-delete.module.ts:19-32`
  - `README.md:212-228`

### [P2] `RestoredEvent`에 actor 정보가 실리지 않음

- `RestoredEvent` 타입은 `actorId` 필드를 지원하고 README도 restore 이벤트 payload에 `actorId`가 포함된다고 문서화한다.
- 그러나 실제 `SoftDeleteService.restore()`는 `new RestoredEvent(model, where)`만 호출하며 `SoftDeleteContext.getActorId()`를 전달하지 않는다.
- `deletedByField`와 `actorExtractor`를 함께 사용하는 소비자는 soft-delete 이벤트에서는 행위자를 받을 수 있지만 restore 이벤트에서는 동일한 감사 정보를 잃게 된다.
- 관련 근거:
  - `src/events/soft-delete.events.ts:12-19`
  - `src/services/soft-delete.service.ts:74`
  - `README.md:271-287`

## 3. 추가 리스크

- `SoftDeleteService.restore()`는 cascade 시작 시 부모 PK를 `record.id`로 고정 사용한다. 반면 `CascadeHandler` 자체는 `findPrimaryKey()`로 모델별 PK를 찾도록 설계되어 있어, 비표준 PK 이름을 쓰는 모델에서는 restore cascade가 추가로 깨질 가능성이 높다.
- 관련 근거:
  - `src/services/soft-delete.service.ts:65-68`
  - `src/prisma/cascade-handler.ts:34-37`

## 4. 테스트 커버리지 관찰

- 현재 테스트는 단위 테스트와 Prisma extension 수준의 e2e는 잘 갖춰져 있다.
- 다만 `SoftDeleteModule.forRoot()`가 실제 Nest `PrismaService` 인스턴스를 확장하는지 검증하는 통합 테스트는 없다.
- `src/soft-delete.module.spec.ts`는 DynamicModule 메타데이터만 확인하고 있어, 이번 P1 이슈가 테스트를 통과한 것으로 보인다.

## 5. 권고 사항

1. `SoftDeleteModule` 등록 시 실제 Prisma client/provider에 extension을 적용하는 경로를 먼저 구현한다.
2. `CascadeHandler`를 모듈 provider로 연결하고 `restore()` 경로에 대한 통합 테스트를 추가한다.
3. `RestoredEvent`에 `actorId`를 실어 문서와 동작을 일치시킨다.
4. Nest 통합 Quick Start를 그대로 재현하는 e2e 또는 integration test를 별도로 추가한다.
