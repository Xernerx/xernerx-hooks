<!-- @format -->

# @xernerx/hooks

## 0.3.2

### Patch Changes

- <!-- @format -->
  
  Authenticate `Xernerx/docs` clone in `.github/workflows/push.yml`.

## 0.3.1

### Patch Changes

- <!-- @format -->
  
  Update `packageManager` to `pnpm@12.21.0` and standardize `/** @format */` header placement in `src/main.ts`.

## 0.3.0

### Minor Changes

- <!-- @format -->
  
  ## `UserEngagementState.shadowban` Support in `HooksClient` & `XernerxHooks`
  
  Added `shadowban: boolean` to `UserEngagementState` across `HooksClient` and `XernerxHooks` with REST fallback hydration from `GET /v1/bots/:id/users/:userId`.
  
  ### Added
  
  - **`UserEngagementState.shadowban` Property**: Added `shadowban: boolean` to `UserEngagementState` and `HooksClient.hasShadowban(userId)` / `getEngagement(userId)` with automatic REST fallback resolution.

## 0.2.1

### Patch Changes

- Extend `ExtensionBuilder` from `@xernerx/extension-builder` and refine TypeDoc `@param` JSDoc links.

## 0.2.0

### Minor Changes

- Initial release of `@xernerx/hooks` webhook receiver and engagement cache (`voted`, `reviewed`, `tipped`) with HMAC-SHA256 verification, `@xernerx/framework` extension (`XernerxHooks`), standalone `HooksClient`, and full TypeDoc/README documentation.

## 0.1.0

### Minor Changes

- Initial release of `@xernerx/hooks` webhook receiver and engagement cache.
