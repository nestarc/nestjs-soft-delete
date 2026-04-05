# @nestarc/soft-delete — Design Spec

Date: 2026-04-05
Status: Draft

## Goal

NestJS + Prisma + PostgreSQL 환경을 위한 소프트 삭제 모듈. Prisma extension으로 `delete`/`deleteMany` 호출을 자동 인터셉트하여 물리 삭제 대신 `deletedAt` 타임스탬프를 기록하고, 모든 조회 쿼리에서 삭제된 레코드를 자동 필터링한다. `@nestarc/tenancy`와 연동하면 테넌트별 "휴지통" 기능이 자연스럽게 구현되며, `@nestarc/audit-log`와 연동하면 삭제/복원 이력이 자동 추적된다.

## Market Gap

Prisma에 소프트 삭제 내장 기능이 **없다** — Prisma GitHub에서 가장 오래된 feature request 중 하나이며([prisma/prisma#3398](https://github.com/prisma/prisma/issues/3398)), 모든 프로젝트가 미들웨어를 직접 구현한다.

npm 현황:
| 접근 방식 | 패키지 | 문제점 |
|----------|--------|--------|
| Prisma middleware | `prisma-soft-delete-middleware` | deprecated Prisma middleware API 기반, 확장 모델 미지원 |
| Prisma extension | `prisma-extension-soft-delete` | NestJS 미통합, 모듈 시스템 없음, DI 불가 |
| TypeORM decorator | `@nestjs/typeorm` `@DeleteDateColumn` | TypeORM 전용, Prisma 사용 불가 |
| NestJS + Prisma 통합 | **없음** | 모듈 등록, 데코레이터, DI, 테스트 유틸 제공하는 패키지 부재 |

핵심 pain points:
1. 매 프로젝트마다 soft-delete 미들웨어/확장을 직접 구현
2. `findMany`, `findFirst`, `count` 등 모든 조회에 `where: { deletedAt: null }` 수동 추가
3. cascade soft-delete 미지원 (부모 삭제 시 자식도 soft-delete)
4. 복원(restore) API 없음
5. "삭제된 레코드 포함" 조회가 번거로움
6. 멀티테넌트 환경에서 테넌트별 soft-delete 격리 미지원

## Design Decisions

| 결정 | 선택 | 이유 |
|------|------|------|
| ORM | Prisma 전용 | tenancy, audit-log과 동일 전략. 생태계 일관성 |
| 메커니즘 | Prisma `$extends` | deprecated middleware 대신 공식 extension API 사용 |
| 삭제 필드 | `deletedAt: DateTime?` | boolean보다 "언제 삭제되었는지" 정보 제공. 업계 표준 |
| 삭제 주체 | `deletedBy: String?` (선택) | 감사 추적. audit-log와 연동 시 자동 주입 |
| 모델 지정 | 명시적 화이트리스트 (`softDeleteModels`) | 모든 모델에 자동 적용하면 의도치 않은 부작용 발생. opt-in이 안전 |
| 필터 기본값 | 삭제된 레코드 기본 제외 | 대부분 비즈니스 로직에서 삭제된 데이터 불필요. 명시적으로 포함 가능 |
| tenancy 연동 | optional peer dep | 미설치 시 정상 동작. graceful degradation |
| audit-log 연동 | optional peer dep | 설치 시 삭제/복원 이벤트 자동 로깅 |
| NestJS 연동 | DynamicModule | forRoot/forRootAsync 패턴. 데코레이터 제공 |

## Prisma Schema Requirement

soft-delete를 적용할 모델에는 다음 필드가 필수:

```prisma
model User {
  id        String    @id @default(uuid())
  email     String    @unique
  name      String
  // ... 기존 필드들

  // soft-delete 필수 필드
  deletedAt DateTime? @map("deleted_at")

  // soft-delete 선택 필드 (감사용)
  deletedBy String?   @map("deleted_by")

  @@map("users")
}
```

모듈 초기화 시 `softDeleteModels`에 지정된 모델에 `deletedAt` 필드가 없으면 startup 경고를 출력한다.

## Module API

### Registration

```typescript
@Module({
  imports: [
    SoftDeleteModule.forRoot({
      // soft-delete 적용 모델 (화이트리스트)
      softDeleteModels: ['User', 'Document', 'Comment'],

      // 삭제 필드명 (기본값: 'deletedAt')
      deletedAtField: 'deletedAt',

      // 삭제 주체 필드명 (선택, 기본값: null — 비활성)
      deletedByField: 'deletedBy',

      // 삭제 주체 추출기 (deletedByField 활성 시 필요)
      actorExtractor: (req: Request) => req.user?.id ?? null,

      // cascade soft-delete 관계 정의 (선택)
      cascade: {
        User: ['Document', 'Comment'],  // User 삭제 시 Document, Comment도 soft-delete
      },
    }),
  ],
})
export class AppModule {}
```

`forRootAsync`도 지원:

```typescript
SoftDeleteModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    softDeleteModels: config.get('SOFT_DELETE_MODELS').split(','),
    deletedAtField: 'deletedAt',
  }),
  inject: [ConfigService],
})
```

### Prisma Extension

```typescript
import { createPrismaSoftDeleteExtension } from '@nestarc/soft-delete';

const prisma = new PrismaClient().$extends(
  createPrismaSoftDeleteExtension({
    softDeleteModels: ['User', 'Document', 'Comment'],
    deletedAtField: 'deletedAt',
  })
);
```

NestJS 모듈 없이 Prisma extension만 독립 사용 가능.

### SoftDeleteService

```typescript
@Injectable()
class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly softDelete: SoftDeleteService,
  ) {}

  // 일반 삭제 → 자동으로 soft-delete 변환
  async deleteUser(id: string) {
    // Prisma extension이 delete를 인터셉트하여
    // UPDATE users SET deleted_at = NOW() WHERE id = $1 로 변환
    return this.prisma.user.delete({ where: { id } });
  }

  // 복원
  async restoreUser(id: string) {
    return this.softDelete.restore('User', { id });
    // → UPDATE users SET deleted_at = NULL, deleted_by = NULL WHERE id = $1
  }

  // 영구 삭제
  async permanentlyDeleteUser(id: string) {
    return this.softDelete.forceDelete('User', { id });
    // → DELETE FROM users WHERE id = $1
  }

  // 삭제된 레코드 포함 조회
  async findAllIncludingDeleted() {
    return this.softDelete.withDeleted(() =>
      this.prisma.user.findMany()
    );
  }

  // 삭제된 레코드만 조회 (휴지통)
  async getTrash() {
    return this.softDelete.onlyDeleted(() =>
      this.prisma.user.findMany()
    );
  }
}
```

### Decorators

```typescript
// 이 엔드포인트에서 실행되는 Prisma 쿼리는 삭제된 레코드를 포함
@WithDeleted()
@Get('users/all')
findAllIncludingDeleted() {
  return this.prisma.user.findMany(); // deletedAt 필터 자동 해제
}

// 삭제된 레코드만 반환 (관리자 휴지통 뷰)
@OnlyDeleted()
@Get('users/trash')
getTrash() {
  return this.prisma.user.findMany(); // WHERE deleted_at IS NOT NULL
}

// 이 모델/엔드포인트는 soft-delete 대상에서 제외
@SkipSoftDelete()
@Delete('sessions/:id')
hardDeleteSession(@Param('id') id: string) {
  return this.prisma.session.delete({ where: { id } }); // 물리 삭제
}
```

## Prisma Extension Behavior

### Write Operations

| Prisma Operation | 변환 결과 | 비고 |
|-----------------|----------|------|
| `model.delete({ where })` | `model.update({ where, data: { deletedAt: new Date() } })` | soft-delete 모델만 |
| `model.deleteMany({ where })` | `model.updateMany({ where, data: { deletedAt: new Date() } })` | soft-delete 모델만 |
| `model.create(...)` | 변환 없음 (pass-through) | |
| `model.update(...)` | 변환 없음 (pass-through) | |
| `model.upsert(...)` | 변환 없음 (pass-through) | |

### Read Operations (자동 필터)

| Prisma Operation | 자동 주입 필터 | 비고 |
|-----------------|--------------|------|
| `model.findMany({ where })` | `where: { ...where, deletedAt: null }` | |
| `model.findFirst({ where })` | `where: { ...where, deletedAt: null }` | |
| `model.findUnique({ where })` | `where: { ...where, deletedAt: null }` | |
| `model.findFirstOrThrow(...)` | `where: { ...where, deletedAt: null }` | |
| `model.findUniqueOrThrow(...)` | `where: { ...where, deletedAt: null }` | |
| `model.count({ where })` | `where: { ...where, deletedAt: null }` | |
| `model.aggregate({ where })` | `where: { ...where, deletedAt: null }` | |
| `model.groupBy({ where })` | `where: { ...where, deletedAt: null }` | |

### Filter Bypass

`withDeleted` 또는 `onlyDeleted` 컨텍스트 내에서는 자동 필터가 변경된다:

```
withDeleted  → deletedAt 필터 주입하지 않음 (모든 레코드)
onlyDeleted  → where: { deletedAt: { not: null } } 주입 (삭제된 레코드만)
```

이 상태는 AsyncLocalStorage로 관리하여 요청 스코프 내에서 일관성 유지.

## Cascade Soft-Delete

### 설정

```typescript
SoftDeleteModule.forRoot({
  softDeleteModels: ['User', 'Post', 'Comment'],
  cascade: {
    User: ['Post'],       // User soft-delete → Post도 soft-delete
    Post: ['Comment'],    // Post soft-delete → Comment도 soft-delete
    // 결과: User 삭제 시 User → Post → Comment 순으로 cascade
  },
})
```

### 동작

1. `User.delete({ where: { id: 'u1' } })` 호출
2. Extension이 `User` soft-delete 실행: `UPDATE users SET deleted_at = NOW() WHERE id = 'u1'`
3. Cascade 설정 확인 → `User: ['Post']`
4. 관련 `Post` soft-delete: `UPDATE posts SET deleted_at = NOW() WHERE author_id = 'u1' AND deleted_at IS NULL`
5. `Post: ['Comment']` 재귀 확인
6. 관련 `Comment` soft-delete: `UPDATE comments SET deleted_at = NOW() WHERE post_id IN (...) AND deleted_at IS NULL`

### Cascade Restore

`restore()` 호출 시에도 cascade가 적용된다:
- `restore('User', { id: 'u1' })` → User + Post + Comment 모두 복원
- 단, **동일 삭제 시점**의 레코드만 복원 (이전에 별도로 삭제된 레코드는 복원하지 않음)
- 구현: `deletedAt`이 부모의 `deletedAt`과 동일한(±1초 허용) 레코드만 cascade 복원

### Cascade 관계 탐지

v0.1.0에서는 cascade 관계를 수동으로 설정한다. Prisma 스키마에서 relation 필드를 자동 탐지하는 것은 v0.2.0에서 고려.

cascade 실행 시 관계 FK 필드는 다음 규칙으로 추론:
1. 자식 모델에서 부모 모델에 대한 `@relation` 필드를 Prisma DMMF에서 탐색
2. 발견된 FK 필드로 `WHERE fk_field = parentId` 조건 생성
3. 관계를 찾지 못하면 startup 시 `CascadeRelationNotFoundError` throw

## Architecture

### File Structure

```
src/
├── soft-delete.module.ts                # DynamicModule (forRoot/forRootAsync)
├── soft-delete.constants.ts             # 인젝션 토큰, 메타데이터 키
├── interfaces/
│   ├── soft-delete-options.interface.ts  # SoftDeleteModuleOptions
│   └── soft-delete-context.interface.ts  # SoftDeleteFilterMode
├── services/
│   ├── soft-delete.service.ts           # 공개 API: restore(), forceDelete(), withDeleted(), onlyDeleted()
│   └── soft-delete-context.ts           # AsyncLocalStorage — filter mode 관리
├── prisma/
│   ├── soft-delete-extension.ts         # Prisma $extends — delete 인터셉트 + 쿼리 필터
│   └── cascade-handler.ts              # Cascade soft-delete/restore 로직
├── middleware/
│   └── soft-delete-actor.middleware.ts  # 요청에서 deletedBy actor 추출 (선택)
├── decorators/
│   ├── with-deleted.decorator.ts        # @WithDeleted()
│   ├── only-deleted.decorator.ts        # @OnlyDeleted()
│   └── skip-soft-delete.decorator.ts    # @SkipSoftDelete()
├── interceptors/
│   └── soft-delete-filter.interceptor.ts # 데코레이터 기반 filter mode 설정
├── errors/
│   ├── soft-delete-field-missing.error.ts     # deletedAt 필드 미존재
│   └── cascade-relation-not-found.error.ts    # cascade 관계 FK 탐지 실패
├── testing/
│   ├── test-soft-delete.module.ts       # 테스트용 경량 모듈
│   └── expect-soft-deleted.ts           # 테스트 헬퍼
└── index.ts                             # 배럴 export
```

### Data Flow — Soft Delete

```
Controller: prisma.user.delete({ where: { id } })
  → Prisma Extension (delete 인터셉트)
    → softDeleteModels 확인 (미포함이면 물리 삭제 pass-through)
    → SkipSoftDelete 컨텍스트 확인 (활성이면 물리 삭제 pass-through)
    → UPDATE model SET deletedAt = NOW(), deletedBy = actor WHERE id = $1
    → cascade 설정 확인
      → 자식 모델 CASCADE soft-delete (재귀)
    → [audit-log 연동 시] 삭제 이벤트 자동 기록
```

### Data Flow — Query Filter

```
Controller: prisma.user.findMany({ where: { role: 'admin' } })
  → Prisma Extension (read 인터셉트)
    → softDeleteModels 확인 (미포함이면 pass-through)
    → SoftDeleteContext에서 현재 filter mode 확인
      → 'default': where에 { deletedAt: null } 추가
      → 'withDeleted': 필터 없이 pass-through
      → 'onlyDeleted': where에 { deletedAt: { not: null } } 추가
    → 원본 쿼리 실행 (필터 적용됨)
```

### Data Flow — Restore

```
SoftDeleteService.restore('User', { id })
  → withDeleted 컨텍스트 내에서 실행
    → findFirst({ where: { id } }) — 삭제된 레코드 조회
    → 레코드 미존재 시 throw RecordNotFoundError
    → UPDATE model SET deletedAt = NULL, deletedBy = NULL WHERE id = $1
    → cascade 설정 확인
      → 자식 모델 CASCADE restore (재귀, 동일 삭제 시점만)
    → [audit-log 연동 시] 복원 이벤트 자동 기록
```

## @nestarc/tenancy Integration

```typescript
// soft-delete-extension.ts 내부
private getTenantId(): string | null {
  try {
    const { TenancyContext } = require('@nestarc/tenancy');
    return new TenancyContext().getTenantId();
  } catch {
    return null; // @nestarc/tenancy 미설치
  }
}
```

tenancy가 설치되어 있으면:
- Cascade soft-delete 시 RLS가 자동 적용되어 **현재 테넌트의 레코드만** cascade 대상
- `onlyDeleted()` 조회 시 현재 테넌트의 삭제된 레코드만 반환 (테넌트별 휴지통)
- 별도 설정 불필요 — RLS 정책이 모든 쿼리에 자동 적용

## @nestarc/audit-log Integration

```typescript
// soft-delete-extension.ts 내부
private async emitAuditEvent(action: string, model: string, recordId: string): Promise<void> {
  try {
    const { AuditService } = require('@nestarc/audit-log');
    // ModuleRef를 통해 AuditService 인스턴스 획득
    const auditService = this.moduleRef?.get(AuditService, { strict: false });
    if (auditService) {
      await auditService.log({
        action: `${model.toLowerCase()}.${action}`,  // e.g., 'user.soft_deleted', 'user.restored'
        targetType: model,
        targetId: recordId,
        metadata: { softDelete: true },
      });
    }
  } catch {
    // @nestarc/audit-log 미설치 — 무시
  }
}
```

audit-log가 설치되어 있으면:
- `soft_deleted` 이벤트 자동 기록
- `restored` 이벤트 자동 기록
- `force_deleted` 이벤트 자동 기록
- 별도 설정 불필요

## SoftDeleteContext (AsyncLocalStorage)

tenancy의 `TenancyContext` 패턴을 따른다:

```typescript
type SoftDeleteFilterMode = 'default' | 'withDeleted' | 'onlyDeleted';

interface SoftDeleteStore {
  filterMode: SoftDeleteFilterMode;
  skipSoftDelete: boolean;  // forceDelete, SkipSoftDelete 데코레이터용
}

class SoftDeleteContext {
  private static storage = new AsyncLocalStorage<SoftDeleteStore>();

  static run<T>(store: SoftDeleteStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  static getFilterMode(): SoftDeleteFilterMode {
    return this.storage.getStore()?.filterMode ?? 'default';
  }

  static isSkipped(): boolean {
    return this.storage.getStore()?.skipSoftDelete ?? false;
  }
}
```

## Unique Constraint Handling

soft-delete된 레코드가 unique 제약 조건에 영향을 미치는 문제:

**문제**: `email` 필드에 unique가 있을 때, 사용자 삭제 후 같은 email로 재가입 불가.

**해결 방안** (v0.1.0):

```sql
-- Prisma schema에서 conditional unique index 사용
@@unique([email, deletedAt], name: "unique_email_active")
```

또는 PostgreSQL partial index:

```sql
CREATE UNIQUE INDEX unique_email_active ON users (email) WHERE deleted_at IS NULL;
```

v0.1.0에서는 문서로 가이드하고, v0.2.0에서 Prisma 스키마 생성 CLI 지원 고려.

## Performance Considerations

- `softDeleteModels` 화이트리스트로 적용 대상 제한 → 미적용 모델 오버헤드 0
- 조회 필터 주입은 단순 `where` 조건 추가 → 오버헤드 무시 가능
- `deletedAt` 필드에 인덱스 권장: `CREATE INDEX idx_model_deleted_at ON model (deleted_at) WHERE deleted_at IS NOT NULL`
  - Partial index로 삭제된 레코드만 인덱싱하여 공간 효율적
- Cascade soft-delete는 관계 수만큼 추가 쿼리 발생 → 깊은 cascade 체인은 성능 영향
  - v0.1.0: 최대 3단계 cascade 제한 (설정 가능)
  - v0.2.0: batch cascade 최적화 고려

## Security

- **물리 삭제 보호**: soft-delete 모델에 대해 `delete`가 `update`로 변환되므로 실수로 물리 삭제 불가
- **영구 삭제 명시성**: `forceDelete()`는 의도적인 호출이 필요. 실수 방지.
- **테넌트 격리**: tenancy RLS 적용 시 다른 테넌트의 soft-deleted 레코드 접근 불가
- **SQL injection**: Prisma `$executeRaw` tagged template 사용 (tenancy와 동일 패턴)
- **GDPR 고려**: 데이터 삭제 요청 시 `forceDelete()` 사용. soft-delete는 데이터 보존.

## Testing Utilities

### TestSoftDeleteModule

```typescript
const module = await Test.createTestingModule({
  imports: [TestSoftDeleteModule.register({ softDeleteModels: ['User'] })],
  providers: [UserService],
}).compile();
```

### expectSoftDeleted Helper

```typescript
import { expectSoftDeleted } from '@nestarc/soft-delete/testing';

// 레코드가 soft-delete 상태인지 검증
await expectSoftDeleted(prisma.user, { id: 'user-1' });
// → findFirst with withDeleted, assert deletedAt is not null

// 레코드가 복원되었는지 검증
await expectNotSoftDeleted(prisma.user, { id: 'user-1' });
// → findFirst, assert deletedAt is null

// cascade soft-delete 검증
await expectCascadeSoftDeleted(prisma, 'User', { id: 'user-1' }, ['Post', 'Comment']);
// → User + Post + Comment 모두 soft-deleted 상태 확인
```

## Out of Scope (v0.1.0)

- Scheduled purge (N일 후 자동 영구 삭제) → v0.2.0
- Prisma 스키마 자동 생성 CLI (`npx nestarc-soft-delete init`) → v0.2.0
- Cascade 관계 자동 탐지 (수동 설정 대신 Prisma DMMF 기반) → v0.2.0
- GraphQL resolver 통합 → v0.3.0
- 관리자 UI (휴지통 뷰어) → out of scope
- MongoDB/MySQL 지원 → out of scope (PostgreSQL 전용)

## Package Metadata

```json
{
  "name": "@nestarc/soft-delete",
  "version": "0.1.0",
  "description": "Prisma soft-delete extension for NestJS with automatic query filtering, cascade support, and restore API",
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "@prisma/client": "^5.0.0 || ^6.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0",
    "rxjs": "^7.0.0"
  },
  "peerDependenciesMeta": {
    "@nestarc/tenancy": { "optional": true },
    "@nestarc/audit-log": { "optional": true }
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/index.d.ts",
      "default": "./dist/testing/index.js"
    }
  }
}
```

## Exported API (index.ts)

```typescript
// Core Module
export { SoftDeleteModule } from './soft-delete.module';
export { SoftDeleteModuleOptions, SoftDeleteModuleAsyncOptions } from './interfaces/soft-delete-options.interface';

// Services
export { SoftDeleteService } from './services/soft-delete.service';
export { SoftDeleteContext, SoftDeleteFilterMode } from './services/soft-delete-context';

// Prisma Extension
export { createPrismaSoftDeleteExtension } from './prisma/soft-delete-extension';
export type { SoftDeleteExtensionOptions } from './prisma/soft-delete-extension';

// Decorators
export { WithDeleted } from './decorators/with-deleted.decorator';
export { OnlyDeleted } from './decorators/only-deleted.decorator';
export { SkipSoftDelete } from './decorators/skip-soft-delete.decorator';

// Errors
export { SoftDeleteFieldMissingError } from './errors/soft-delete-field-missing.error';
export { CascadeRelationNotFoundError } from './errors/cascade-relation-not-found.error';

// Constants
export { SOFT_DELETE_MODULE_OPTIONS } from './soft-delete.constants';
```

## Success Criteria

- `npm run build` 통과
- 유닛 테스트: 90%+ 커버리지
- E2E 테스트: 실제 PostgreSQL에서 soft-delete, restore, cascade, 쿼리 필터 검증
- `@nestarc/tenancy` 미설치 상태에서도 정상 동작
- `@nestarc/audit-log` 미설치 상태에서도 정상 동작
- README: Quick Start 5분 이내 완료 가능
- Prisma extension 독립 사용 가능 (NestJS 없이)
