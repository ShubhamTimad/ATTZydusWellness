# Takeda-ATT API Documentation

> Generated from the live OpenAPI spec (`/openapi.json`) on 2026-06-10.
> FastAPI application · 149 endpoints · 150 schemas

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Common Errors](#common-errors)
- [App API Endpoints](#app-api-endpoints)
  - [Approvals](#tag-approvals)
  - [Audit](#tag-audit)
  - [Auth](#tag-auth)
  - [Dashboard](#tag-dashboard)
  - [Reports](#tag-reports)
  - [Tasks](#tag-tasks)
- [Admin API Endpoints](#admin-api-endpoints)
  - [Approval Workflows](#admin-approval-workflows)
  - [Asset Masters](#admin-asset-masters)
  - [Assets](#admin-assets)
  - [Dashboard](#admin-dashboard)
  - [Email Templates](#admin-email-templates)
  - [Features](#admin-features)
  - [Org Units](#admin-org-units)
  - [Permissions](#admin-permissions)
  - [Physical Orders](#admin-physical-orders)
  - [Roles](#admin-roles)
  - [Settings](#admin-settings)
  - [Users](#admin-users)
  - [Workflow Mappings](#admin-workflow-mappings)
- [Data Schemas](#data-schemas)
- [Appendix A: Permission Requirements](#appendix-a-permission-requirements)
- [Appendix B: Special Endpoint Notes](#appendix-b-special-endpoint-notes)
- [Appendix C: Regenerating This Document](#appendix-c-regenerating-this-document)
- [Appendix D: Mobile application permissions](#appendix-d-mobile-application-permissions)

## Overview

| Surface | Base path | Purpose |
|---------|-----------|---------|
| **App API** | `/` | Authentication, approvals, tasks, reports, dashboard, audit |
| **Admin API** | `/admin` | Users, roles, permissions, assets, orders, settings, workflows |

**Live documentation** (server running): [`/docs`](/docs) · [`/redoc`](/redoc) · [`/openapi.json`](/openapi.json)

## Authentication

```http
Authorization: Bearer <access_token>
```

| Step | Endpoint | Description |
|------|----------|-------------|
| 1 | `POST /login` | Authenticate with email, phone, or username + password. Mobile APK must send `client_type: "mobile"` and requires `mobile.access`. |
| 2 | `POST /auth/mfa/verify` | Complete MFA challenge (if required). Pass the same `client_type` as login. |
| 3 | `POST /refresh` | Exchange refresh token for new token pair |
| 4 | `GET /me` | Read profile and permission codes |

Public endpoints (no Bearer token): `/auth/policy`, `/auth/session-policy`, `/login`, `/refresh`, `/forgot-password`, `/reset-password`, `/auth/mfa/*`.

Session idle: expired sessions return `401` with `{"detail":"session_idle"}`. Configure via `GET /auth/session-policy`.

RBAC: endpoints list required permission codes in their descriptions. Codes use dot notation (`users.view`). When `ENFORCE_SUPERUSER_ON_ADMIN=true`, all `/admin/*` routes require superuser.

## Common Errors

| Status | When |
|--------|------|
| `400` | Invalid input, business rule failure, bad MFA/OTP |
| `401` | Missing/invalid token, session idle, bad refresh token |
| `403` | Permission denied, inactive account, password expired |
| `404` | Resource not found |
| `409` | Duplicate or conflicting state |
| `415` | Unsupported media type |
| `422` | Pydantic validation failure |
| `502` | SMTP failure (email test) |
| `503` | Email delivery failure (forgot password) |

## App API Endpoints

### Approvals {#tag-approvals}

#### `GET /approvals/my-tasks` {#get-approvals-my-tasks}

**Summary:** My Tasks

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`MyApprovalTaskItem`](#schema-myapprovaltaskitem) (application/json) |

---

#### `GET /approvals/requests/{request_id}` {#get-approvals-requests-request-id}

**Summary:** Get Request

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `request_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ApprovalRequestPublic`](#schema-approvalrequestpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /approvals/requests/{request_id}/resubmit` {#post-approvals-requests-request-id-resubmit}

**Summary:** Resubmit Rejected

Submitter re-opens a rejected/in-rework user-creation approval and restarts at step 1.

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `request_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ResubmitRejectedResponse`](#schema-resubmitrejectedresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /approvals/requests/{request_id}/status` {#get-approvals-requests-request-id-status}

**Summary:** Get Request Status

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `request_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ApprovalRequestStatusDetailPublic`](#schema-approvalrequeststatusdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /approvals/tasks/{task_id}/action` {#post-approvals-tasks-task-id-action}

**Summary:** Act On Task

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | integer | Yes | — |


**Request body** (`application/json`): [`ApprovalTaskActionRequest`](#schema-approvaltaskactionrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ApprovalRequestPublic`](#schema-approvalrequestpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /approvals/tasks/{task_id}/comment` {#post-approvals-tasks-task-id-comment}

**Summary:** Add Task Comment

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | integer | Yes | — |


**Request body** (`application/json`): [`ApprovalTaskCommentRequest`](#schema-approvaltaskcommentrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | `object (map)` (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Audit {#tag-audit}

#### `GET /audit/entity/{entity_type}/{entity_id}` {#get-audit-entity-entity-type-entity-id}

**Summary:** Entity Timeline

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `entity_type` | string | Yes | — |
| `entity_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | `array of object (map)` (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Auth {#tag-auth}

#### `POST /auth/mfa/setup/init` {#post-auth-mfa-setup-init}

**Summary:** Mfa Setup Init

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`MfaSetupInitBody`](#schema-mfasetupinitbody)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | `object (map)` (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /auth/mfa/setup/verify` {#post-auth-mfa-setup-verify}

**Summary:** Mfa Setup Verify

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`MfaSetupVerifyBody`](#schema-mfasetupverifybody)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | `object (map)` (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /auth/mfa/verify` {#post-auth-mfa-verify}

**Summary:** Verify Mfa Otp

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`MfaVerifyRequest`](#schema-mfaverifyrequest)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `challenge_token` | string | Yes | From login MFA challenge response |
| `otp` | string | Yes | 6–12 character TOTP code |
| `client_type` | enum (`web`, `mobile`) | No | default `web`. Must match `client_type` sent to `POST /login`. |

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`TokenPair`](#schema-tokenpair) (application/json) |
| `403` | Mobile not allowed | `mobile_access_denied` when `client_type` is `mobile` and user lacks `mobile.access` |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /auth/policy` {#get-auth-policy}

**Summary:** Public Auth Policy

Public, unauthenticated policy snapshot for login UI (do not leak user/company data).

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AuthPolicyPublic`](#schema-authpolicypublic) (application/json) |

---

#### `GET /auth/session-policy` {#get-auth-session-policy}

**Summary:** Public Session Policy

Idle timeout for client auto sign-out (minutes, org-wide).

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`SessionIdleSettingsPublic`](#schema-sessionidlesettingspublic) (application/json) |

---

#### `POST /forgot-password` {#post-forgot-password}

**Summary:** Forgot Password

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`ForgotPasswordRequest`](#schema-forgotpasswordrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ForgotPasswordResponse`](#schema-forgotpasswordresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /login` {#post-login}

**Summary:** Login

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`):

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `email` | string | null | No | — |
| `username` | string | null | No | — |
| `phone` | string | null | No | — |
| `password` | string | Yes | min length `1`; max length `128` |
| `captcha_token` | string | null | No | — |
| `client_type` | enum (`web`, `mobile`) | No | default `web`. Use `mobile` for the APK; user must have `mobile.access` (superusers bypass). |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | `any` (application/json) |
| `403` | Mobile not allowed | `{"error":"mobile_access_denied","detail":"..."}` when `client_type` is `mobile` and user lacks `mobile.access` |

---

#### `GET /me` {#get-me}

**Summary:** Me

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`UserMe`](#schema-userme) (application/json) |

---

#### `POST /refresh` {#post-refresh}

**Summary:** Refresh Tokens

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`RefreshRequest`](#schema-refreshrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`TokenPair`](#schema-tokenpair) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /reset-password` {#post-reset-password}

**Summary:** Reset Password

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`ResetPasswordRequest`](#schema-resetpasswordrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ResetPasswordResponse`](#schema-resetpasswordresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Dashboard {#tag-dashboard}

#### `GET /dashboard/summary` {#get-dashboard-summary}

**Summary:** Get Dashboard Summary

Org-wide dashboard summary. Same modules for every authenticated user:
physical verification orders, asset register, and financial-year tagging.

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | `object (map)` (application/json) |

---

### Reports {#tag-reports}

#### `GET /reports/catalog` {#get-reports-catalog}

**Summary:** Get Report Catalog

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ReportCatalogPublic`](#schema-reportcatalogpublic) (application/json) |

---

#### `GET /reports/generate` {#get-reports-generate}

**Summary:** Generate Report

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `report` | string | Yes | (min length `1`) |
| `format` | string | No | (pattern `^(?i)(xlsx|pdf)$`; default `"xlsx"`) |
| `plant_id` | integer | null | No | — |
| `category_id` | integer | null | No | — |
| `cost_center` | string | null | No | — |
| `functional_location` | string | null | No | — |
| `actual_location` | string | null | No | — |
| `status` | string | null | No | Order status filter (`physical_orders_summary` report) |
| `fy_status` | string | null | No | `verified`, `pending`, or `all` (`financial_year_verification` report) |
| `fy_start_year` | integer | null | No | Calendar year the FY starts in (e.g. `2025` for FY 2025–26). Used by `financial_year_verification`; omit for running FY. |


**Report-specific filters:**

| Report key | Filters |
|------------|---------|
| `financial_year_verification` | `fy_start_year`, `plant_id`, `fy_status` |
| `physical_orders_summary` | `plant_id`, `status` |
| `asset_register` | `plant_id`, `category_id`, `cost_center`, `functional_location`, `actual_location` |

The catalog (`GET /reports/catalog`) lists available `fy_start_year` options under the financial year verification report filter (`kind: financial_year`).

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | Binary file (`xlsx` or `pdf`) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Tasks {#tag-tasks}

#### `POST /tasks` {#post-tasks}

**Summary:** Create Task

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`TaskCreateRequest`](#schema-taskcreaterequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`TaskDetailPublic`](#schema-taskdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /tasks/my-tasks` {#get-tasks-my-tasks}

**Summary:** My Tasks

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `status` | string | null | No | — |
| `priority` | string | null | No | — |
| `task_type` | string | null | No | — |
| `due_before` | string (date-time) | null | No | — |
| `limit` | integer | No | (min `1`; max `200`; default `100`) |
| `inbox` | string | No | ``active`` = work that needs your attention. ``done`` = finished (approved, rejected, completed, closed). (pattern `^(active|done)$`; default `"active"`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`TaskInboxItem`](#schema-taskinboxitem) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /tasks/{task_id}` {#get-tasks-task-id}

**Summary:** Get Task

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`TaskDetailPublic`](#schema-taskdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /tasks/{task_id}/asset` {#get-tasks-task-id-asset}

**Summary:** Get Task Asset Detail

Full asset master record for approvers (does not require ``asset.view``).

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AssetDetailPublic`](#schema-assetdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /tasks/{task_id}/assign` {#post-tasks-task-id-assign}

**Summary:** Assign Task

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | integer | Yes | — |


**Request body** (`application/json`): [`TaskAssignRequest`](#schema-taskassignrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`TaskDetailPublic`](#schema-taskdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /tasks/{task_id}/close` {#post-tasks-task-id-close}

**Summary:** Close Task

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`TaskDetailPublic`](#schema-taskdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /tasks/{task_id}/comments` {#post-tasks-task-id-comments}

**Summary:** Add Comment

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | integer | Yes | — |


**Request body** (`application/json`): [`TaskCommentCreateRequest`](#schema-taskcommentcreaterequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | `object (map)` (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /tasks/{task_id}/complete` {#post-tasks-task-id-complete}

**Summary:** Complete Task

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`TaskDetailPublic`](#schema-taskdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /tasks/{task_id}/start` {#post-tasks-task-id-start}

**Summary:** Start Task

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`TaskDetailPublic`](#schema-taskdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

## Admin API Endpoints

Base path: `/admin`

### Approval Workflows {#admin-approval-workflows}

#### `GET /admin/approval-workflows` {#get-admin-approval-workflows}

**Summary:** List Workflows

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`ApprovalWorkflowDetail`](#schema-approvalworkflowdetail) (application/json) |

---

#### `POST /admin/approval-workflows` {#post-admin-approval-workflows}

**Summary:** Create Workflow

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`ApprovalWorkflowCreate`](#schema-approvalworkflowcreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`ApprovalWorkflowDetail`](#schema-approvalworkflowdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/approval-workflows/{workflow_id}` {#get-admin-approval-workflows-workflow-id}

**Summary:** Get Workflow

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ApprovalWorkflowDetail`](#schema-approvalworkflowdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/approval-workflows/{workflow_id}` {#patch-admin-approval-workflows-workflow-id}

**Summary:** Update Workflow

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow_id` | integer | Yes | — |


**Request body** (`application/json`): [`ApprovalWorkflowUpdate`](#schema-approvalworkflowupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ApprovalWorkflowDetail`](#schema-approvalworkflowdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/approval-workflows/{workflow_id}/activate` {#patch-admin-approval-workflows-workflow-id-activate}

**Summary:** Activate Workflow

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ApprovalWorkflowDetail`](#schema-approvalworkflowdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/approval-workflows/{workflow_id}/deactivate` {#patch-admin-approval-workflows-workflow-id-deactivate}

**Summary:** Deactivate Workflow

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ApprovalWorkflowDetail`](#schema-approvalworkflowdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/approval-workflows/{workflow_id}/steps` {#post-admin-approval-workflows-workflow-id-steps}

**Summary:** Add Step

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow_id` | integer | Yes | — |


**Request body** (`application/json`): [`ApprovalStepCreate`](#schema-approvalstepcreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | `object (map)` (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/approval-workflows/{workflow_id}/steps/{step_id}` {#patch-admin-approval-workflows-workflow-id-steps-step-id}

**Summary:** Update Step

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow_id` | integer | Yes | — |
| `step_id` | integer | Yes | — |


**Request body** (`application/json`): [`ApprovalStepUpdate`](#schema-approvalstepupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | `object (map)` (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `DELETE /admin/approval-workflows/{workflow_id}/steps/{step_id}` {#delete-admin-approval-workflows-workflow-id-steps-step-id}

**Summary:** Delete Step

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow_id` | integer | Yes | — |
| `step_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `204` | Successful Response | No content body |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Asset Masters {#admin-asset-masters}

#### `GET /admin/asset-masters/actual-locations` {#get-admin-asset-masters-actual-locations}

**Summary:** List Actual Locations

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `functional_location_id` | integer | null | No | — |
| `plant_id` | integer | null | No | — |
| `active_only` | boolean | No | (default `true`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`FunctionalChildPublic`](#schema-functionalchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/asset-masters/actual-locations` {#post-admin-asset-masters-actual-locations}

**Summary:** Create Actual Location

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`FunctionalChildCreate`](#schema-functionalchildcreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`FunctionalChildPublic`](#schema-functionalchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/asset-masters/actual-locations/{row_id}` {#patch-admin-asset-masters-actual-locations-row-id}

**Summary:** Update Actual Location

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `row_id` | integer | Yes | — |


**Request body** (`application/json`): [`PlantChildUpdate`](#schema-plantchildupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`FunctionalChildPublic`](#schema-functionalchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/asset-masters/categories` {#get-admin-asset-masters-categories}

**Summary:** List Categories

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `active_only` | boolean | No | (default `true`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`CategoryPublic`](#schema-categorypublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/asset-masters/categories` {#post-admin-asset-masters-categories}

**Summary:** Create Category

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`CategoryCreate`](#schema-categorycreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`CategoryPublic`](#schema-categorypublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/asset-masters/categories/{category_id}` {#patch-admin-asset-masters-categories-category-id}

**Summary:** Update Category

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `category_id` | integer | Yes | — |


**Request body** (`application/json`): [`CategoryUpdate`](#schema-categoryupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`CategoryPublic`](#schema-categorypublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/asset-masters/cost-centers` {#get-admin-asset-masters-cost-centers}

**Summary:** List Cost Centers

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `plant_id` | integer | null | No | — |
| `active_only` | boolean | No | (default `true`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`PlantChildPublic`](#schema-plantchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/asset-masters/cost-centers` {#post-admin-asset-masters-cost-centers}

**Summary:** Create Cost Center

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`PlantChildCreate`](#schema-plantchildcreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`PlantChildPublic`](#schema-plantchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/asset-masters/cost-centers/{row_id}` {#patch-admin-asset-masters-cost-centers-row-id}

**Summary:** Update Cost Center

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `row_id` | integer | Yes | — |


**Request body** (`application/json`): [`PlantChildUpdate`](#schema-plantchildupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PlantChildPublic`](#schema-plantchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/asset-masters/functional-locations` {#get-admin-asset-masters-functional-locations}

**Summary:** List Functional Locations

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `plant_id` | integer | null | No | — |
| `active_only` | boolean | No | (default `true`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`PlantChildPublic`](#schema-plantchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/asset-masters/functional-locations` {#post-admin-asset-masters-functional-locations}

**Summary:** Create Functional Location

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`PlantChildCreate`](#schema-plantchildcreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`PlantChildPublic`](#schema-plantchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/asset-masters/functional-locations/{row_id}` {#patch-admin-asset-masters-functional-locations-row-id}

**Summary:** Update Functional Location

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `row_id` | integer | Yes | — |


**Request body** (`application/json`): [`PlantChildUpdate`](#schema-plantchildupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PlantChildPublic`](#schema-plantchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/asset-masters/profit-centers` {#get-admin-asset-masters-profit-centers}

**Summary:** List Profit Centers

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `cost_center_id` | integer | null | No | — |
| `plant_id` | integer | null | No | — |
| `active_only` | boolean | No | (default `true`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`CostCenterChildPublic`](#schema-costcenterchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/asset-masters/profit-centers` {#post-admin-asset-masters-profit-centers}

**Summary:** Create Profit Center

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`CostCenterChildCreate`](#schema-costcenterchildcreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`CostCenterChildPublic`](#schema-costcenterchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/asset-masters/profit-centers/{row_id}` {#patch-admin-asset-masters-profit-centers-row-id}

**Summary:** Update Profit Center

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `row_id` | integer | Yes | — |


**Request body** (`application/json`): [`PlantChildUpdate`](#schema-plantchildupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`CostCenterChildPublic`](#schema-costcenterchildpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/asset-masters/tag-colors` {#get-admin-asset-masters-tag-colors}

**Summary:** List Tag Colors

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `active_only` | boolean | No | (default `true`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`TagColorPublic`](#schema-tagcolorpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/asset-masters/tag-colors` {#post-admin-asset-masters-tag-colors}

**Summary:** Create Tag Color

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`TagColorCreate`](#schema-tagcolorcreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`TagColorPublic`](#schema-tagcolorpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/asset-masters/tag-colors/{row_id}` {#patch-admin-asset-masters-tag-colors-row-id}

**Summary:** Update Tag Color

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `row_id` | integer | Yes | — |


**Request body** (`application/json`): [`TagColorUpdate`](#schema-tagcolorupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`TagColorPublic`](#schema-tagcolorpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Assets {#admin-assets}

#### `GET /admin/assets` {#get-admin-assets}

**Summary:** List Assets

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `page` | integer | No | (min `1`; default `1`) |
| `page_size` | integer | No | (min `1`; max `100`; default `25`) |
| `search` | string | null | No | — |
| `plant_id` | integer | null | No | — |
| `category_id` | integer | null | No | — |
| `lifecycle_status` | string | null | No | — |
| `approval_status` | string | null | No | — |
| `rfid_status` | string | null | No | Filter by RFID tag: tagged | not_tagged |
| `fy_verification` | string | null | No | Filter RFID-tagged active assets by financial year verification: verified | pending | all |
| `fy_start_year` | integer | null | No | Calendar year the financial year starts in; omit for the running financial year. |
| `fy_scan_from` | string (date) | null | No | Include RFID scans on or after this date (within FY). |
| `fy_scan_to` | string (date) | null | No | Include RFID scans on or before this date (within FY). |
| `sort_by` | string | No | (default `"created_at"`) |
| `sort_dir` | string | No | (default `"desc"`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AssetListResponse`](#schema-assetlistresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/assets` {#post-admin-assets}

**Summary:** Create Asset

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`AssetCreateRequest`](#schema-assetcreaterequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`AssetDetailPublic`](#schema-assetdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/assets/categories` {#get-admin-assets-categories}

**Summary:** List Categories

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`AssetCategoryPublic`](#schema-assetcategorypublic) (application/json) |

---

#### `GET /admin/assets/export` {#get-admin-assets-export}

**Summary:** Export Assets

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `fields` | array of string | Yes | — |
| `plant_id` | integer | null | No | — |
| `category_id` | integer | null | No | — |
| `cost_center` | string | null | No | — |
| `functional_location` | string | null | No | — |
| `actual_location` | string | null | No | — |
| `fy_verification` | string | null | No | — |
| `fy_start_year` | integer | null | No | — |
| `fy_scan_from` | string (date) | null | No | — |
| `fy_scan_to` | string (date) | null | No | — |
| `asset_ids` | array of integer | null | No | — |
| `sort_by` | string | No | (default `"asset_code"`) |
| `sort_dir` | string | No | (default `"asc"`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | `any` (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/assets/export/fields` {#get-admin-assets-export-fields}

**Summary:** List Export Fields

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AssetExportFieldsResponse`](#schema-assetexportfieldsresponse) (application/json) |

---

#### `GET /admin/assets/financial-years` {#get-admin-assets-financial-years}

**Summary:** List Financial Years

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `years_back` | integer | No | (min `1`; max `30`; default `10`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`FinancialYearListResponse`](#schema-financialyearlistresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/assets/fy-verification/export` {#get-admin-assets-fy-verification-export}

**Summary:** Export Fy Verification

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `format` | string | No | (pattern `^(?i)(xlsx|pdf)$`; default `"xlsx"`) |
| `fy_verification` | string | null | No | (default `"all"`) |
| `fy_start_year` | integer | null | No | — |
| `fy_scan_from` | string (date) | null | No | — |
| `fy_scan_to` | string (date) | null | No | — |
| `plant_id` | integer | null | No | — |
| `category_id` | integer | null | No | — |
| `search` | string | null | No | — |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | `any` (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/assets/import/cancel-batch/{batch_id}` {#post-admin-assets-import-cancel-batch-batch-id}

**Summary:** Cancel Import Batch

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `batch_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ImportCancelBatchResponse`](#schema-importcancelbatchresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/assets/import/confirm` {#post-admin-assets-import-confirm}

**Summary:** Import Confirm

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`ImportConfirmRequest`](#schema-importconfirmrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ImportConfirmResponse`](#schema-importconfirmresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/assets/import/confirm-chunk` {#post-admin-assets-import-confirm-chunk}

**Summary:** Import Confirm Chunk

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`ImportConfirmChunkRequest`](#schema-importconfirmchunkrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ImportConfirmChunkResponse`](#schema-importconfirmchunkresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/assets/import/preview` {#post-admin-assets-import-preview}

**Summary:** Import Preview

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`multipart/form-data`): [`Body_import_preview_admin_assets_import_preview_post`](#schema-body-import-preview-admin-assets-import-preview-post)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ImportPreviewResponse`](#schema-importpreviewresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/assets/import/validate` {#post-admin-assets-import-validate}

**Summary:** Import Validate

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`ImportValidateRequest`](#schema-importvalidaterequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ImportPreviewResponse`](#schema-importpreviewresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/assets/rfid/attach-by-code` {#post-admin-assets-rfid-attach-by-code}

**Summary:** Attach Asset Rfid By Code

Attach or update RFID when the operator knows asset code + tag (no row selection).

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`AssetRfidAttachByCodeRequest`](#schema-assetrfidattachbycoderequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AssetRfidAttachPublic`](#schema-assetrfidattachpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/assets/submit-for-approval` {#post-admin-assets-submit-for-approval}

**Summary:** Submit Assets For Approval

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`SubmitForApprovalRequest`](#schema-submitforapprovalrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`SubmitForApprovalResponse`](#schema-submitforapprovalresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/assets/{asset_id}` {#get-admin-assets-asset-id}

**Summary:** Get Asset

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `asset_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AssetDetailPublic`](#schema-assetdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/assets/{asset_id}` {#patch-admin-assets-asset-id}

**Summary:** Update Asset

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `asset_id` | integer | Yes | — |


**Request body** (`application/json`): [`AssetUpdateRequest`](#schema-assetupdaterequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AssetDetailPublic`](#schema-assetdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `DELETE /admin/assets/{asset_id}` {#delete-admin-assets-asset-id}

**Summary:** Delete Asset

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `asset_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `204` | Successful Response | No content body |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/assets/{asset_id}/audit` {#get-admin-assets-asset-id-audit}

**Summary:** Asset Audit

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `asset_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`AssetAuditEventPublic`](#schema-assetauditeventpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/assets/{asset_id}/rfid` {#patch-admin-assets-asset-id-rfid}

**Summary:** Update Asset Rfid

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `asset_id` | integer | Yes | — |


**Request body** (`application/json`): [`AssetRfidUpdateRequest`](#schema-assetrfidupdaterequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AssetDetailPublic`](#schema-assetdetailpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/assets/{asset_id}/rfid/attach` {#post-admin-assets-asset-id-rfid-attach}

**Summary:** Attach Asset Rfid

Dedicated endpoint: attach or update RFID on a single asset (unique per asset).

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `asset_id` | integer | Yes | — |


**Request body** (`application/json`): [`AssetRfidAttachRequest`](#schema-assetrfidattachrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AssetRfidAttachPublic`](#schema-assetrfidattachpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/assets/{asset_id}/submit-for-approval` {#post-admin-assets-asset-id-submit-for-approval}

**Summary:** Submit Asset For Approval

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `asset_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`SubmitForApprovalResponse`](#schema-submitforapprovalresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Dashboard {#admin-dashboard}

#### `GET /admin/dashboard/summary` {#get-admin-dashboard-summary}

**Summary:** Dashboard Summary

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | `object (map)` (application/json) |

---

### Email Templates {#admin-email-templates}

#### `GET /admin/email-templates` {#get-admin-email-templates}

**Summary:** List Templates

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`EmailTemplatePublic`](#schema-emailtemplatepublic) (application/json) |

---

#### `POST /admin/email-templates` {#post-admin-email-templates}

**Summary:** Create Template

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`EmailTemplateCreate`](#schema-emailtemplatecreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`EmailTemplatePublic`](#schema-emailtemplatepublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/email-templates/mappings` {#get-admin-email-templates-mappings}

**Summary:** List Mappings

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`EmailTemplateMappingPublic`](#schema-emailtemplatemappingpublic) (application/json) |

---

#### `POST /admin/email-templates/mappings` {#post-admin-email-templates-mappings}

**Summary:** Create Mapping

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`EmailTemplateMappingCreate`](#schema-emailtemplatemappingcreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`EmailTemplateMappingPublic`](#schema-emailtemplatemappingpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/email-templates/mappings/{mapping_id}` {#patch-admin-email-templates-mappings-mapping-id}

**Summary:** Update Mapping

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `mapping_id` | integer | Yes | — |


**Request body** (`application/json`): [`EmailTemplateMappingUpdate`](#schema-emailtemplatemappingupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`EmailTemplateMappingPublic`](#schema-emailtemplatemappingpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/email-templates/preview` {#post-admin-email-templates-preview}

**Summary:** Preview

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`EmailPreviewRequest`](#schema-emailpreviewrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`EmailPreviewResponse`](#schema-emailpreviewresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/email-templates/variables/{event_code}` {#get-admin-email-templates-variables-event-code}

**Summary:** Variables For Event

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `event_code` | string | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`EmailVariablesResponse`](#schema-emailvariablesresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/email-templates/{template_id}` {#patch-admin-email-templates-template-id}

**Summary:** Update Template

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `template_id` | integer | Yes | — |


**Request body** (`application/json`): [`EmailTemplateUpdate`](#schema-emailtemplateupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`EmailTemplatePublic`](#schema-emailtemplatepublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `DELETE /admin/email-templates/{template_id}` {#delete-admin-email-templates-template-id}

**Summary:** Delete Template

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `template_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `204` | Successful Response | No content body |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/email-templates/{template_id}` {#get-admin-email-templates-template-id}

**Summary:** Get Template

Keep this route **after** static subpaths like ``/mappings`` so FastAPI doesn't try to treat
``mappings`` as a template id (which would yield a 422).

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `template_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`EmailTemplatePublic`](#schema-emailtemplatepublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Features {#admin-features}

#### `POST /admin/features` {#post-admin-features}

**Summary:** Create Feature

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`FeatureCreate`](#schema-featurecreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`FeaturePublic`](#schema-featurepublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/features` {#get-admin-features}

**Summary:** List Features

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `skip` | integer | No | (min `0`; default `0`) |
| `limit` | integer | No | (min `1`; max `200`; default `50`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`FeaturePublic`](#schema-featurepublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/features/{feature_id}` {#get-admin-features-feature-id}

**Summary:** Get Feature

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `feature_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`FeaturePublic`](#schema-featurepublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/features/{feature_id}` {#patch-admin-features-feature-id}

**Summary:** Update Feature

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `feature_id` | integer | Yes | — |


**Request body** (`application/json`): [`FeatureUpdate`](#schema-featureupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`FeaturePublic`](#schema-featurepublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `DELETE /admin/features/{feature_id}` {#delete-admin-features-feature-id}

**Summary:** Delete Feature

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `feature_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `204` | Successful Response | No content body |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Org Units {#admin-org-units}

#### `GET /admin/org-units` {#get-admin-org-units}

**Summary:** List Org Units

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `type` | string | null | No | — |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`OrgUnitPublic`](#schema-orgunitpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/org-units` {#post-admin-org-units}

**Summary:** Create Org Unit

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`OrgUnitCreate`](#schema-orgunitcreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`OrgUnitPublic`](#schema-orgunitpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/org-units/{org_unit_id}` {#get-admin-org-units-org-unit-id}

**Summary:** Get Org Unit

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `org_unit_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`OrgUnitPublic`](#schema-orgunitpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/org-units/{org_unit_id}` {#patch-admin-org-units-org-unit-id}

**Summary:** Update Org Unit

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `org_unit_id` | integer | Yes | — |


**Request body** (`application/json`): [`OrgUnitUpdate`](#schema-orgunitupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`OrgUnitPublic`](#schema-orgunitpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Permissions {#admin-permissions}

#### `POST /admin/permissions` {#post-admin-permissions}

**Summary:** Create Permission

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`PermissionCreate`](#schema-permissioncreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`PermissionPublic`](#schema-permissionpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/permissions` {#get-admin-permissions}

**Summary:** List Permissions

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `skip` | integer | No | (min `0`; default `0`) |
| `limit` | integer | No | (min `1`; max `200`; default `50`) |
| `feature_id` | integer | null | No | — |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`PermissionPublic`](#schema-permissionpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/permissions/catalog` {#get-admin-permissions-catalog}

**Summary:** Permission Catalog

Grouped permission definitions merged with database ids (for admin UI).

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PermissionCatalogPublic`](#schema-permissioncatalogpublic) (application/json) |

---

#### `POST /admin/permissions/sync` {#post-admin-permissions-sync}

**Summary:** Sync Permission Catalog

Create any missing permission rows from MODULE_CONFIG so role assignment stays editable.

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PermissionCatalogSyncResult`](#schema-permissioncatalogsyncresult) (application/json) |

---

#### `GET /admin/permissions/{permission_id}` {#get-admin-permissions-permission-id}

**Summary:** Get Permission

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `permission_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PermissionPublic`](#schema-permissionpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/permissions/{permission_id}` {#patch-admin-permissions-permission-id}

**Summary:** Update Permission

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `permission_id` | integer | Yes | — |


**Request body** (`application/json`): [`PermissionUpdate`](#schema-permissionupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PermissionPublic`](#schema-permissionpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `DELETE /admin/permissions/{permission_id}` {#delete-admin-permissions-permission-id}

**Summary:** Delete Permission

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `permission_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `204` | Successful Response | No content body |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Physical Orders {#admin-physical-orders}

#### `GET /admin/physical-orders` {#get-admin-physical-orders}

**Summary:** List Orders

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab` | string | No | (default `"all"`) |
| `page` | integer | No | (min `1`; default `1`) |
| `page_size` | integer | No | (min `1`; max `100`; default `25`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderListResponse`](#schema-physicalorderlistresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders` {#post-admin-physical-orders}

**Summary:** Create Order

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`CreatePhysicalOrderRequest`](#schema-createphysicalorderrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/physical-orders/executors` {#get-admin-physical-orders-executors}

**Summary:** List Executors

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`ExecutorUserPublic`](#schema-executoruserpublic) (application/json) |

---

#### `POST /admin/physical-orders/validate-assets` {#post-admin-physical-orders-validate-assets}

**Summary:** Validate Assets

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`ValidateAssetsRequest`](#schema-validateassetsrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ValidateAssetsResponse`](#schema-validateassetsresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/physical-orders/{order_id}` {#get-admin-physical-orders-order-id}

**Summary:** Get Order

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/physical-orders/{order_id}` {#patch-admin-physical-orders-order-id}

**Summary:** Update Order

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |


**Request body** (`application/json`): [`UpdatePhysicalOrderRequest`](#schema-updatephysicalorderrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/approval/approve-all` {#post-admin-physical-orders-order-id-approval-approve-all}

**Summary:** Approve All Items

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/approval/approve-items` {#post-admin-physical-orders-order-id-approval-approve-items}

**Summary:** Approve Items

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |


**Request body** (`application/json`): [`ItemIdsRequest`](#schema-itemidsrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/approval/approve-order` {#post-admin-physical-orders-order-id-approval-approve-order}

**Summary:** Approve Creation Order

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/approval/reject-items` {#post-admin-physical-orders-order-id-approval-reject-items}

**Summary:** Reject Items

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |


**Request body** (`application/json`): [`RejectItemsRequest`](#schema-rejectitemsrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/approval/reject-order` {#post-admin-physical-orders-order-id-approval-reject-order}

**Summary:** Reject Order

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |


**Request body** (`application/json`): [`RejectOrderRequest`](#schema-rejectorderrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/close` {#post-admin-physical-orders-order-id-close}

**Summary:** Close Order

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/closure/approve-order` {#post-admin-physical-orders-order-id-closure-approve-order}

**Summary:** Approve Closure Order

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/execution/reject-items` {#post-admin-physical-orders-order-id-execution-reject-items}

**Summary:** Reject Execution Items

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |


**Request body** (`application/json`): [`RejectItemsRequest`](#schema-rejectitemsrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/reassign` {#post-admin-physical-orders-order-id-reassign}

**Summary:** Reassign Order

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |


**Request body** (`application/json`): [`UpdatePhysicalOrderRequest`](#schema-updatephysicalorderrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/scan` {#post-admin-physical-orders-order-id-scan}

**Summary:** Scan Asset

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |


**Request body** (`application/json`): [`ScanAssetRequest`](#schema-scanassetrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`ScanAssetResponse`](#schema-scanassetresponse) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/start` {#post-admin-physical-orders-order-id-start}

**Summary:** Start Order

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/submit` {#post-admin-physical-orders-order-id-submit}

**Summary:** Submit Order

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/physical-orders/{order_id}/submit-closure` {#post-admin-physical-orders-order-id-submit-closure}

**Summary:** Submit Closure

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `order_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PhysicalOrderDetail`](#schema-physicalorderdetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Roles {#admin-roles}

#### `POST /admin/roles` {#post-admin-roles}

**Summary:** Create Role

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`RoleCreate`](#schema-rolecreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`RoleDetail`](#schema-roledetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/roles` {#get-admin-roles}

**Summary:** List Roles

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `skip` | integer | No | (min `0`; default `0`) |
| `limit` | integer | No | (min `1`; max `200`; default `50`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`RoleListItem`](#schema-rolelistitem) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/roles/{role_id}` {#get-admin-roles-role-id}

**Summary:** Get Role

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `role_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`RoleDetail`](#schema-roledetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/roles/{role_id}` {#patch-admin-roles-role-id}

**Summary:** Update Role

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `role_id` | integer | Yes | — |


**Request body** (`application/json`): [`RoleUpdate`](#schema-roleupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`RoleDetail`](#schema-roledetail) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `DELETE /admin/roles/{role_id}` {#delete-admin-roles-role-id}

**Summary:** Delete Role

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `role_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `204` | Successful Response | No content body |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Settings {#admin-settings}

#### `GET /admin/settings/auth-policy` {#get-admin-settings-auth-policy}

**Summary:** Get Auth Policy

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AuthPolicyPublic`](#schema-authpolicypublic) (application/json) |

---

#### `PUT /admin/settings/auth-policy` {#put-admin-settings-auth-policy}

**Summary:** Put Auth Policy

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`AuthPolicyPublic`](#schema-authpolicypublic)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`AuthPolicyPublic`](#schema-authpolicypublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/settings/email-delivery` {#get-admin-settings-email-delivery}

**Summary:** Get Email Delivery

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`EmailDeliveryPublic`](#schema-emaildeliverypublic) (application/json) |

---

#### `PUT /admin/settings/email-delivery` {#put-admin-settings-email-delivery}

**Summary:** Put Email Delivery

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`EmailDeliveryPublic`](#schema-emaildeliverypublic)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`EmailDeliveryPublic`](#schema-emaildeliverypublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/settings/email-delivery/test` {#post-admin-settings-email-delivery-test}

**Summary:** Test Email Delivery

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`EmailDeliveryTestRequest`](#schema-emaildeliverytestrequest)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | `object (map of string)` (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/settings/financial-year` {#get-admin-settings-financial-year}

**Summary:** Get Financial Year

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`FinancialYearSettingsPublic`](#schema-financialyearsettingspublic) (application/json) |

---

#### `PUT /admin/settings/financial-year` {#put-admin-settings-financial-year}

**Summary:** Put Financial Year

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`FinancialYearSettingsPublic`](#schema-financialyearsettingspublic)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`FinancialYearSettingsPublic`](#schema-financialyearsettingspublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/settings/password-policy` {#get-admin-settings-password-policy}

**Summary:** Get Password Policy

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PasswordPolicyPublic`](#schema-passwordpolicypublic) (application/json) |

---

#### `PUT /admin/settings/password-policy` {#put-admin-settings-password-policy}

**Summary:** Put Password Policy

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`PasswordPolicyPublic`](#schema-passwordpolicypublic)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`PasswordPolicyPublic`](#schema-passwordpolicypublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/settings/session-idle` {#get-admin-settings-session-idle}

**Summary:** Get Session Idle

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`SessionIdleSettingsPublic`](#schema-sessionidlesettingspublic) (application/json) |

---

#### `PUT /admin/settings/session-idle` {#put-admin-settings-session-idle}

**Summary:** Put Session Idle

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`SessionIdleSettingsPublic`](#schema-sessionidlesettingspublic)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`SessionIdleSettingsPublic`](#schema-sessionidlesettingspublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Users {#admin-users}

#### `POST /admin/users` {#post-admin-users}

**Summary:** Create User

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`UserCreate`](#schema-usercreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`UserPublic`](#schema-userpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/users` {#get-admin-users}

**Summary:** List Users

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `skip` | integer | No | (min `0`; default `0`) |
| `limit` | integer | No | (min `1`; max `200`; default `50`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`UserPublic`](#schema-userpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `PATCH /admin/users/{user_id}` {#patch-admin-users-user-id}

**Summary:** Update User

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `user_id` | integer | Yes | — |


**Request body** (`application/json`): [`UserUpdate`](#schema-userupdate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | [`UserPublic`](#schema-userpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `DELETE /admin/users/{user_id}` {#delete-admin-users-user-id}

**Summary:** Delete User

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `user_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `204` | Successful Response | No content body |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/users/{user_id}/resend-mfa` {#post-admin-users-user-id-resend-mfa}

**Summary:** Resend Mfa Setup

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `user_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `204` | Successful Response | No content body |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/users/{user_id}/resend-welcome` {#post-admin-users-user-id-resend-welcome}

**Summary:** Resend Welcome Email

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `user_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `204` | Successful Response | No content body |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/users/{user_id}/roles/{role_id}` {#post-admin-users-user-id-roles-role-id}

**Summary:** Assign Role To User

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)

**Path parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `user_id` | integer | Yes | — |
| `role_id` | integer | Yes | — |



**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `204` | Successful Response | No content body |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

### Workflow Mappings {#admin-workflow-mappings}

#### `GET /admin/workflow-mappings` {#get-admin-workflow-mappings}

**Summary:** List Mappings

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)


**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `active_only` | boolean | No | (default `false`) |


**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`WorkflowMappingPublic`](#schema-workflowmappingpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `POST /admin/workflow-mappings` {#post-admin-workflow-mappings}

**Summary:** Create Mapping

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)



**Request body** (`application/json`): [`WorkflowMappingCreate`](#schema-workflowmappingcreate)

**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `201` | Successful Response | [`WorkflowMappingPublic`](#schema-workflowmappingpublic) (application/json) |
| `422` | Validation Error | [`HTTPValidationError`](#schema-httpvalidationerror) (application/json) |

---

#### `GET /admin/workflow-mappings/action-codes` {#get-admin-workflow-mappings-action-codes}

**Summary:** List Action Codes

All permission codes from the catalog (each row belongs to a feature).

**Authentication:** **Bearer token** (`Authorization: Bearer <access_token>`)




**Responses:**

| Status | Description | Schema |
|--------|-------------|--------|
| `200` | Successful Response | array of [`PermissionActionOption`](#schema-permissionactionoption) (application/json) |

---

## Data Schemas

Complete field reference for all Pydantic request/response models.

### `ActiveOrderConflict` {#schema-activeorderconflict}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `asset_id` | integer | Yes | — |
| `asset_code` | string | Yes | — |
| `asset_name` | string | Yes | — |
| `order_id` | integer | Yes | — |
| `order_number` | string | Yes | — |
| `order_status` | string | Yes | — |

### `ApprovalRequestPublic` {#schema-approvalrequestpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `workflow_id` | integer | Yes | — |
| `entity_type` | string | Yes | — |
| `entity_id` | integer | Yes | — |
| `status` | string | Yes | — |
| `current_step` | integer | Yes | — |
| `payload` | object (map) | Yes | — |
| `created_by` | integer | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |

### `ApprovalRequestStatusDetailPublic` {#schema-approvalrequeststatusdetailpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `request_id` | integer | Yes | — |
| `request_status` | string | Yes | — |
| `current_step` | integer | Yes | — |
| `total_steps` | integer | Yes | — |
| `pending_approvers` | array of string | No | — |
| `approved_count` | integer | Yes | — |
| `required_approvals` | integer | Yes | — |
| `steps` | array of object | No | — |

### `ApprovalRequestStatusStepPublic` {#schema-approvalrequeststatussteppublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `step_order` | integer | Yes | — |
| `role_name` | string | null | No | — |
| `required_approvals` | integer | Yes | — |
| `approved_by` | array of string | No | — |
| `pending` | array of string | No | — |

### `ApprovalStepCreate` {#schema-approvalstepcreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `step_order` | integer | Yes | min `1.0` |
| `approver_role_id` | integer | Yes | min `1.0` |
| `required_approvals` | integer | No | min `1.0`; default `1` |

### `ApprovalStepPublic` {#schema-approvalsteppublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `workflow_id` | integer | Yes | — |
| `step_order` | integer | Yes | — |
| `approver_role_id` | integer | Yes | — |
| `required_approvals` | integer | Yes | — |

### `ApprovalStepUpdate` {#schema-approvalstepupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `approver_role_id` | integer | null | No | — |
| `required_approvals` | integer | null | No | — |

### `ApprovalTaskActionRequest` {#schema-approvaltaskactionrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `action` | enum (`approve`, `reject`) | Yes | — |
| `comment` | string | null | No | — |

### `ApprovalTaskCommentRequest` {#schema-approvaltaskcommentrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `comment` | string | Yes | min length `1`; max length `10000` |

### `ApprovalWorkflowCreate` {#schema-approvalworkflowcreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `name` | string | Yes | min length `1`; max length `255` |
| `entity_type` | string | Yes | min length `1`; max length `64` |
| `is_active` | boolean | No | default `false` |

### `ApprovalWorkflowDetail` {#schema-approvalworkflowdetail}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `name` | string | Yes | — |
| `entity_type` | string | Yes | — |
| `is_active` | boolean | Yes | — |
| `created_by` | integer | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |
| `steps` | array of object | No | — |

### `ApprovalWorkflowUpdate` {#schema-approvalworkflowupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `name` | string | null | No | — |
| `entity_type` | string | null | No | — |

### `AssetAuditChangeLine` {#schema-assetauditchangeline}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `field_label` | string | Yes | — |
| `from_value` | string | Yes | — |
| `to_value` | string | Yes | — |

### `AssetAuditEventPublic` {#schema-assetauditeventpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `action` | string | Yes | — |
| `actor_user_id` | integer | null | Yes | — |
| `actor_name` | string | null | No | — |
| `activity_verb` | string | Yes | — |
| `summary` | string | Yes | — |
| `changes` | array of object | No | — |
| `created_at` | string (date-time) | Yes | — |

### `AssetCategoryPublic` {#schema-assetcategorypublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `code` | string | Yes | — |
| `name` | string | Yes | — |
| `description` | string | null | No | — |
| `is_active` | boolean | Yes | — |

### `AssetCreateRequest` {#schema-assetcreaterequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `asset_name` | string | Yes | min length `1`; max length `255` |
| `asset_code` | string | Yes | min length `1`; max length `128` |
| `rfid_code` | string | null | No | — |
| `serial_no` | string | null | No | — |
| `asset_class` | string | null | No | — |
| `asset_type` | string | null | No | — |
| `asset_category_id` | integer | null | No | — |
| `tag_color_id` | integer | null | No | — |
| `ownership_type` | string | null | No | — |
| `information` | any | null | No | — |
| `location` | any | null | No | — |
| `financial` | any | null | No | — |
| `inventory` | any | null | No | — |

### `AssetDetailPublic` {#schema-assetdetailpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `asset_name` | string | Yes | — |
| `asset_code` | string | Yes | — |
| `rfid_code` | string | null | Yes | — |
| `serial_no` | string | null | Yes | — |
| `asset_category_id` | integer | null | Yes | — |
| `asset_class` | string | null | No | — |
| `asset_type` | string | null | No | — |
| `category_name` | string | null | No | — |
| `tag_color_id` | integer | null | No | — |
| `tag_color_code` | string | null | No | — |
| `tag_color_name` | string | null | No | — |
| `tag_color_hex` | string | null | No | — |
| `lifecycle_status` | string | Yes | — |
| `approval_status` | string | Yes | — |
| `ownership_type` | string | null | Yes | — |
| `source_type` | string | Yes | — |
| `import_batch_id` | integer | null | Yes | — |
| `created_by` | integer | null | Yes | — |
| `approved_by` | integer | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |
| `updated_at` | string (date-time) | Yes | — |
| `information` | any | null | No | — |
| `location` | any | null | No | — |
| `financial` | any | null | No | — |
| `inventory` | any | null | No | — |
| `plant_name` | string | null | No | — |
| `financial_year_label` | string | null | No | — |
| `fy_verification_count` | integer | null | No | — |

### `AssetExportFieldPublic` {#schema-assetexportfieldpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `key` | string | Yes | — |
| `label` | string | Yes | — |

### `AssetExportFieldsResponse` {#schema-assetexportfieldsresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `fields` | array of object | Yes | — |

### `AssetFinancialPayload-Input` {#schema-assetfinancialpayload-input}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `cost_center` | string | null | No | — |
| `laboratory` | string | null | No | — |
| `profit_center` | string | null | No | — |
| `cap_date` | string (date) | null | No | — |
| `gross_block` | number | string | null | No | — |
| `party_details` | string | null | No | — |
| `invoice_no` | string | null | No | — |
| `invoice_date` | string (date) | null | No | — |
| `voucher_no` | string | null | No | — |
| `voucher_date` | string (date) | null | No | — |
| `grn_no` | string | null | No | — |
| `grn_date` | string (date) | null | No | — |
| `put_to_use_date` | string (date) | null | No | — |
| `depreciation_rate` | number | string | null | No | — |
| `life_span` | string | null | No | — |
| `vendor_name` | string | null | No | — |
| `po_number` | string | null | No | — |
| `currency` | string | null | No | — |

### `AssetFinancialPayload-Output` {#schema-assetfinancialpayload-output}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `cost_center` | string | null | No | — |
| `laboratory` | string | null | No | — |
| `profit_center` | string | null | No | — |
| `cap_date` | string (date) | null | No | — |
| `gross_block` | string | null | No | — |
| `party_details` | string | null | No | — |
| `invoice_no` | string | null | No | — |
| `invoice_date` | string (date) | null | No | — |
| `voucher_no` | string | null | No | — |
| `voucher_date` | string (date) | null | No | — |
| `grn_no` | string | null | No | — |
| `grn_date` | string (date) | null | No | — |
| `put_to_use_date` | string (date) | null | No | — |
| `depreciation_rate` | string | null | No | — |
| `life_span` | string | null | No | — |
| `vendor_name` | string | null | No | — |
| `po_number` | string | null | No | — |
| `currency` | string | null | No | — |

### `AssetInformationPayload` {#schema-assetinformationpayload}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `inventory_no` | string | null | No | — |
| `asset_description` | string | null | No | — |
| `engineering_description` | string | null | No | — |
| `qa_description` | string | null | No | — |
| `is_local_finance_user` | boolean | null | No | — |
| `asset_allocation` | string | null | No | — |
| `pm_equipment_id` | string | null | No | — |

### `AssetInventoryPayload` {#schema-assetinventorypayload}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `inventory_count` | integer | null | No | — |
| `physical_count` | integer | null | No | — |
| `last_verification_date` | string (date) | null | No | — |
| `verification_status` | string | null | No | — |
| `verification_remarks` | string | null | No | — |

### `AssetListItem` {#schema-assetlistitem}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `asset_name` | string | Yes | — |
| `asset_code` | string | Yes | — |
| `rfid_code` | string | null | No | — |
| `category_name` | string | null | No | — |
| `plant_id` | integer | null | No | — |
| `plant_code` | string | null | No | — |
| `plant_name` | string | null | No | — |
| `functional_location` | string | null | No | — |
| `functional_location_description` | string | null | No | — |
| `actual_location` | string | null | No | — |
| `actual_location_description` | string | null | No | — |
| `cost_center` | string | null | No | — |
| `cost_center_description` | string | null | No | — |
| `inventory_count` | integer | null | No | — |
| `physical_count` | integer | null | No | — |
| `last_verification_date` | string (date) | null | No | — |
| `fy_verified` | boolean | null | No | — |
| `fy_verification_count` | integer | null | No | — |
| `lifecycle_status` | string | Yes | — |
| `approval_status` | string | Yes | — |
| `source_type` | string | Yes | — |
| `created_at` | string (date-time) | Yes | — |

### `AssetListResponse` {#schema-assetlistresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `items` | array of object | Yes | — |
| `total` | integer | Yes | — |
| `page` | integer | Yes | — |
| `page_size` | integer | Yes | — |
| `financial_year_label` | string | null | No | — |
| `financial_year_start` | string (date) | null | No | — |
| `financial_year_end` | string (date) | null | No | — |
| `financial_year_start_year` | integer | null | No | — |
| `financial_year_is_current` | boolean | null | No | — |
| `scan_window_start` | string (date) | null | No | — |
| `scan_window_end` | string (date) | null | No | — |
| `total_fy_verification_events` | integer | null | No | — |
| `verified_assets_total` | integer | null | No | — |
| `pending_assets_total` | integer | null | No | — |
| `total_rfid_assets` | integer | null | No | — |
| `rfid_tagged_total` | integer | null | No | — |
| `rfid_not_tagged_total` | integer | null | No | — |

### `AssetLocationPayload` {#schema-assetlocationpayload}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `plant_id` | integer | null | No | — |
| `sub_location` | string | null | No | — |
| `functional_location` | string | null | No | — |
| `actual_location` | string | null | No | — |
| `building` | string | null | No | — |
| `floor` | string | null | No | — |
| `room` | string | null | No | — |
| `zone` | string | null | No | — |

### `AssetRfidAttachByCodeRequest` {#schema-assetrfidattachbycoderequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `asset_code` | string | Yes | min length `1`; max length `128` |
| `rfid_code` | string | Yes | min length `1`; max length `128` |
| `tag_color_id` | integer | null | No | — |

### `AssetRfidAttachPublic` {#schema-assetrfidattachpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `asset_id` | integer | Yes | — |
| `asset_code` | string | Yes | — |
| `asset_name` | string | Yes | — |
| `rfid_code` | string | Yes | — |
| `previous_rfid_code` | string | null | Yes | — |
| `operation` | enum (`attached`, `updated`) | Yes | — |
| `tag_color_id` | integer | null | No | — |
| `tag_color_code` | string | null | No | — |
| `tag_color_name` | string | null | No | — |
| `tag_color_hex` | string | null | No | — |

### `AssetRfidAttachRequest` {#schema-assetrfidattachrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `rfid_code` | string | Yes | min length `1`; max length `128` |
| `tag_color_id` | integer | null | No | — |

### `AssetRfidUpdateRequest` {#schema-assetrfidupdaterequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `rfid_code` | string | Yes | min length `1`; max length `128` |
| `tag_color_id` | integer | null | No | — |

### `AssetUpdateRequest` {#schema-assetupdaterequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `asset_name` | string | null | No | — |
| `asset_code` | string | null | No | — |
| `rfid_code` | string | null | No | — |
| `serial_no` | string | null | No | — |
| `asset_class` | string | null | No | — |
| `asset_type` | string | null | No | — |
| `asset_category_id` | integer | null | No | — |
| `tag_color_id` | integer | null | No | — |
| `ownership_type` | string | null | No | — |
| `lifecycle_status` | string | null | No | — |
| `information` | any | null | No | — |
| `location` | any | null | No | — |
| `financial` | any | null | No | — |
| `inventory` | any | null | No | — |

### `AuthPolicyPublic` {#schema-authpolicypublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `password_enabled` | boolean | No | default `true` |
| `mfa_enabled` | boolean | No | default `false` |
| `captcha_enabled` | boolean | No | default `false` |
| `mfa_enforced` | boolean | No | default `false` |

### `Body_import_preview_admin_assets_import_preview_post` {#schema-body-import-preview-admin-assets-import-preview-post}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `file` | string | Yes | — |

### `CatalogModuleItem` {#schema-catalogmoduleitem}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `key` | string | Yes | — |
| `title` | string | Yes | — |
| `tabs` | array of object | Yes | — |

### `CatalogPermissionItem` {#schema-catalogpermissionitem}

One configured action; ``id`` is set when the row exists in the database.

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | null | No | — |
| `action` | string | Yes | — |
| `code` | string | Yes | — |
| `description` | string | null | No | — |

### `CatalogTabItem` {#schema-catalogtabitem}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `key` | string | Yes | — |
| `title` | string | Yes | — |
| `actions` | array of string | Yes | — |
| `permissions` | array of object | Yes | — |

### `CategoryCreate` {#schema-categorycreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `code` | string | Yes | min length `1`; max length `64` |
| `name` | string | Yes | min length `1`; max length `255` |
| `description` | string | null | No | — |

### `CategoryPublic` {#schema-categorypublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `code` | string | Yes | — |
| `name` | string | Yes | — |
| `description` | string | null | Yes | — |
| `is_active` | boolean | Yes | — |
| `created_at` | string (date-time) | null | No | — |

### `CategoryUpdate` {#schema-categoryupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `code` | string | null | No | — |
| `name` | string | null | No | — |
| `description` | string | null | No | — |
| `is_active` | boolean | null | No | — |

### `CostCenterChildCreate` {#schema-costcenterchildcreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `code` | string | Yes | min length `1`; max length `64` |
| `description` | string | Yes | min length `1`; max length `512` |
| `cost_center_id` | integer | Yes | — |

### `CostCenterChildPublic` {#schema-costcenterchildpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `code` | string | Yes | — |
| `description` | string | Yes | — |
| `cost_center_id` | integer | Yes | — |
| `cost_center_code` | string | null | No | — |
| `plant_id` | integer | null | No | — |
| `plant_code` | string | null | No | — |
| `plant_name` | string | null | No | — |
| `is_active` | boolean | Yes | — |
| `created_at` | string (date-time) | Yes | — |
| `updated_at` | string (date-time) | Yes | — |

### `CreatePhysicalOrderRequest` {#schema-createphysicalorderrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `asset_ids` | array of integer | Yes | — |
| `assigned_to` | integer | Yes | — |
| `remarks` | string | null | No | — |
| `submit` | boolean | No | default `true` |
| `reset_verification_asset_ids` | array of integer | No | Assets to clear physical verification when creation is approved (re-audit in current FY). |

### `EmailDeliveryPublic` {#schema-emaildeliverypublic}

SMTP settings for onboarding and notification emails (superadmin Settings tab).

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `delivery_enabled` | boolean | No | default `false` |
| `smtp_host` | string | No | default `""` |
| `smtp_port` | integer | No | min `1.0`; max `65535.0`; default `587` |
| `smtp_username` | string | No | default `""` |
| `smtp_password` | string | No | default `""`; Leave empty on update to keep the stored password. |
| `password_configured` | boolean | No | default `false` |
| `smtp_use_tls` | boolean | No | default `true` |
| `smtp_from_email` | string | No | default `""` |
| `smtp_from_name` | string | No | default `""` |

### `EmailDeliveryTestRequest` {#schema-emaildeliverytestrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `to_email` | string | Yes | min length `3`; max length `255` |
| `config` | any | null | No | Current form values; used when testing before save. |

### `EmailPreviewRequest` {#schema-emailpreviewrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `subject` | string | Yes | min length `1`; max length `50000` |
| `body_html` | string | Yes | min length `1`; max length `200000` |
| `payload` | object (map) | No | — |

### `EmailPreviewResponse` {#schema-emailpreviewresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `subject` | string | Yes | — |
| `body_html` | string | Yes | — |
| `missing_variables` | array of string | No | — |

### `EmailTemplateCreate` {#schema-emailtemplatecreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `name` | string | Yes | min length `1`; max length `255` |
| `event_code` | string | Yes | min length `1`; max length `64` |
| `subject` | string | Yes | min length `1`; max length `50000` |
| `body_html` | string | Yes | min length `1`; max length `200000` |
| `body_text` | string | null | No | — |
| `is_active` | boolean | No | default `true` |

### `EmailTemplateMappingCreate` {#schema-emailtemplatemappingcreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `event_code` | string | Yes | min length `1`; max length `64` |
| `template_id` | integer | Yes | min `1.0` |
| `is_enabled` | boolean | No | default `true` |

### `EmailTemplateMappingPublic` {#schema-emailtemplatemappingpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `event_code` | string | Yes | — |
| `template_id` | integer | Yes | — |
| `is_enabled` | boolean | Yes | — |
| `created_at` | string (date-time) | null | No | — |
| `updated_at` | string (date-time) | null | No | — |

### `EmailTemplateMappingUpdate` {#schema-emailtemplatemappingupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `template_id` | integer | null | No | — |
| `is_enabled` | boolean | null | No | — |

### `EmailTemplatePublic` {#schema-emailtemplatepublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `name` | string | Yes | — |
| `event_code` | string | Yes | — |
| `subject` | string | Yes | — |
| `body_html` | string | Yes | — |
| `body_text` | string | null | Yes | — |
| `is_active` | boolean | Yes | — |
| `created_at` | string (date-time) | null | No | — |
| `updated_at` | string (date-time) | null | No | — |

### `EmailTemplateUpdate` {#schema-emailtemplateupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `name` | string | null | No | — |
| `event_code` | string | null | No | — |
| `subject` | string | null | No | — |
| `body_html` | string | null | No | — |
| `body_text` | string | null | No | — |
| `is_active` | boolean | null | No | — |

### `EmailVariablesResponse` {#schema-emailvariablesresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `event_code` | string | Yes | — |
| `variables` | array of string | Yes | — |
| `allowed_event_codes` | array of string | No | — |

### `ExecutorUserPublic` {#schema-executoruserpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `full_name` | string | Yes | — |
| `email` | string | null | Yes | — |

### `FeatureCreate` {#schema-featurecreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `key` | string | Yes | min length `1`; max length `100` |
| `name` | string | Yes | min length `1`; max length `255` |
| `description` | string | null | No | — |

### `FeaturePublic` {#schema-featurepublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `key` | string | Yes | — |
| `name` | string | Yes | — |
| `description` | string | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |

### `FeatureUpdate` {#schema-featureupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `key` | string | null | No | — |
| `name` | string | null | No | — |
| `description` | string | null | No | — |

### `FinancialYearListResponse` {#schema-financialyearlistresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `items` | array of object | Yes | — |
| `current_start_year` | integer | Yes | — |

### `FinancialYearOptionPublic` {#schema-financialyearoptionpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `label` | string | Yes | — |
| `start` | string (date) | Yes | — |
| `end` | string (date) | Yes | — |
| `start_year` | integer | Yes | — |
| `is_current` | boolean | Yes | — |

### `FinancialYearSettingsPublic` {#schema-financialyearsettingspublic}

Inclusive start date; end is the day before the next year's start.

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `start_month` | integer | No | min `1.0`; max `12.0`; default `4`; Month financial year begins (e.g. 4 = April). |
| `start_day` | integer | No | min `1.0`; max `31.0`; default `1` |
| `period_label` | string | No | default `""`; Computed label for the financial year containing today (read-only on GET). |
| `period_start` | string | No | default `""`; ISO date — read-only on GET. |
| `period_end` | string | No | default `""`; ISO date — read-only on GET. |

### `ForgotPasswordRequest` {#schema-forgotpasswordrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `email` | string (email) | Yes | — |

### `ForgotPasswordResponse` {#schema-forgotpasswordresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `ok` | boolean | No | default `true` |
| `message` | string | No | default `"A password reset link has been sent to your email."` |

### `FunctionalChildCreate` {#schema-functionalchildcreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `code` | string | Yes | min length `1`; max length `64` |
| `description` | string | Yes | min length `1`; max length `512` |
| `functional_location_id` | integer | Yes | — |

### `FunctionalChildPublic` {#schema-functionalchildpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `code` | string | Yes | — |
| `description` | string | Yes | — |
| `functional_location_id` | integer | Yes | — |
| `functional_location_code` | string | null | No | — |
| `plant_id` | integer | null | No | — |
| `plant_code` | string | null | No | — |
| `plant_name` | string | null | No | — |
| `is_active` | boolean | Yes | — |
| `created_at` | string (date-time) | Yes | — |
| `updated_at` | string (date-time) | Yes | — |

### `HTTPValidationError` {#schema-httpvalidationerror}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `detail` | array of object | No | — |

### `ImportCancelBatchResponse` {#schema-importcancelbatchresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `batch_id` | integer | Yes | — |
| `assets_removed` | integer | Yes | — |

### `ImportConfirmChunkRequest` {#schema-importconfirmchunkrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `rows` | array of object (map) | Yes | — |
| `filename` | string | null | No | — |
| `batch_id` | integer | null | No | — |
| `chunk_index` | integer | Yes | min `0.0` |
| `total_chunks` | integer | Yes | min `1.0` |
| `total_rows` | integer | Yes | min `1.0` |
| `processed_rows` | integer | Yes | min `0.0` |
| `is_final_chunk` | boolean | No | default `false` |
| `initiate_approval` | boolean | No | default `false` |

### `ImportConfirmChunkResponse` {#schema-importconfirmchunkresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `batch_id` | integer | Yes | — |
| `chunk_created_count` | integer | Yes | — |
| `chunk_error_count` | integer | Yes | — |
| `total_created_count` | integer | Yes | — |
| `processed_rows` | integer | Yes | — |
| `total_rows` | integer | Yes | — |
| `percent` | number | Yes | — |
| `errors` | array of string | No | — |
| `is_complete` | boolean | Yes | — |
| `pending_approval` | boolean | No | default `false` |

### `ImportConfirmRequest` {#schema-importconfirmrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `rows` | array of object (map) | Yes | — |
| `filename` | string | null | No | — |
| `initiate_approval` | boolean | No | default `false` |

### `ImportConfirmResponse` {#schema-importconfirmresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `batch_id` | integer | Yes | — |
| `created_count` | integer | Yes | — |
| `pending_approval` | boolean | Yes | — |
| `errors` | array of string | No | — |

### `ImportPreviewResponse` {#schema-importpreviewresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `filename` | string | null | Yes | — |
| `total_rows` | integer | Yes | — |
| `valid_rows` | integer | Yes | — |
| `error_rows` | integer | Yes | — |
| `rows` | array of object | Yes | — |

### `ImportPreviewRow` {#schema-importpreviewrow}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `row_number` | integer | Yes | — |
| `valid` | boolean | Yes | — |
| `errors` | array of string | No | — |
| `field_errors` | object (map of string) | No | — |
| `duplicate_asset_code` | boolean | No | default `false` |
| `duplicate_rfid_code` | boolean | No | default `false` |
| `data` | object (map) | No | — |

### `ImportValidateRequest` {#schema-importvalidaterequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `filename` | string | null | No | — |
| `rows` | array of object (map) | Yes | — |

### `InvalidAssetRef` {#schema-invalidassetref}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `asset_id` | integer | Yes | — |
| `asset_code` | string | Yes | — |
| `asset_name` | string | Yes | — |
| `plant_id` | integer | null | No | — |
| `plant_name` | string | null | No | — |
| `cost_center_code` | string | null | No | — |

### `ItemIdsRequest` {#schema-itemidsrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `item_ids` | array of integer | Yes | — |

### `MfaSetupInitBody` {#schema-mfasetupinitbody}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `setup_token` | string | Yes | min length `10`; max length `512` |

### `MfaSetupVerifyBody` {#schema-mfasetupverifybody}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `setup_token` | string | Yes | min length `10`; max length `512` |
| `otp` | string | Yes | min length `6`; max length `12` |

### `MfaVerifyRequest` {#schema-mfaverifyrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `challenge_token` | string | Yes | min length `10`; max length `512` |
| `otp` | string | Yes | min length `6`; max length `12` |

### `MyApprovalTaskItem` {#schema-myapprovaltaskitem}

Enriched inbox row for ``GET /approvals/my-tasks``.

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `task_id` | integer | Yes | — |
| `request_id` | integer | Yes | — |
| `entity_type` | string | Yes | — |
| `entity_id` | integer | Yes | — |
| `action_code` | string | Yes | — |
| `action_label` | string | null | No | — |
| `current_step` | integer | Yes | — |
| `total_steps` | integer | Yes | — |
| `step_order` | integer | Yes | — |
| `step_name` | string | null | No | — |
| `created_by` | integer | null | No | — |
| `created_by_name` | string | null | No | — |
| `created_at` | string (date-time) | Yes | — |
| `payload_preview` | object (map) | No | — |
| `status` | string | Yes | — |

### `OrderLifecycleApproverSlot` {#schema-orderlifecycleapproverslot}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `slot` | integer | Yes | — |
| `status` | string | Yes | — |
| `actor_name` | string | null | No | — |
| `acted_at` | string (date-time) | null | No | — |
| `comment` | string | null | No | — |

### `OrderLifecycleStepPublic` {#schema-orderlifecyclesteppublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `key` | string | Yes | — |
| `label` | string | Yes | — |
| `status` | string | Yes | — |
| `role_name` | string | null | No | — |
| `actor_name` | string | null | No | — |
| `occurred_at` | string (date-time) | null | No | — |
| `detail` | string | null | No | — |
| `approver_slots` | array of object | No | — |

### `OrderWorkflowDefinition` {#schema-orderworkflowdefinition}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `phase` | string | Yes | — |
| `workflow_name` | string | Yes | — |
| `action_code` | string | Yes | — |
| `steps` | array of object | Yes | — |

### `OrderWorkflowStepDefinition` {#schema-orderworkflowstepdefinition}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `step_order` | integer | Yes | — |
| `role_name` | string | Yes | — |
| `required_approvals` | integer | Yes | — |

### `OrgUnitCreate` {#schema-orgunitcreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `name` | string | Yes | min length `1`; max length `255` |
| `code` | string | Yes | min length `1`; max length `64` |
| `type` | string | Yes | min length `1`; max length `32` |
| `parent_id` | integer | null | No | — |

### `OrgUnitPublic` {#schema-orgunitpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `name` | string | Yes | — |
| `code` | string | Yes | — |
| `type` | string | Yes | — |
| `parent_id` | integer | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |
| `updated_at` | string (date-time) | Yes | — |

### `OrgUnitSummary` {#schema-orgunitsummary}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `name` | string | Yes | — |
| `type` | string | Yes | — |

### `OrgUnitUpdate` {#schema-orgunitupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `name` | string | Yes | min length `1`; max length `255` |
| `code` | string | Yes | min length `1`; max length `64` |

### `PasswordPolicyPublic` {#schema-passwordpolicypublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `min_length` | integer | No | min `1.0`; max `256.0`; default `8` |
| `require_uppercase` | boolean | No | default `false` |
| `require_lowercase` | boolean | No | default `false` |
| `require_digit` | boolean | No | default `false` |
| `require_special` | boolean | No | default `false` |
| `max_age_days` | integer | No | min `0.0`; max `36500.0`; default `90`; 0 disables password expiry. |

### `PermissionActionOption` {#schema-permissionactionoption}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `code` | string | Yes | — |
| `feature_key` | string | Yes | — |
| `feature_name` | string | Yes | — |

### `PermissionCatalogPublic` {#schema-permissioncatalogpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `modules` | array of object | Yes | — |

### `PermissionCatalogSyncResult` {#schema-permissioncatalogsyncresult}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `features_created` | integer | Yes | — |
| `permissions_created` | integer | Yes | — |
| `permission_codes_updated` | integer | Yes | — |

### `PermissionCreate` {#schema-permissioncreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `feature_id` | integer | Yes | — |
| `action` | string | Yes | min length `1`; max length `32` |
| `description` | string | null | No | — |

### `PermissionPublic` {#schema-permissionpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `feature_id` | integer | Yes | — |
| `action` | string | Yes | — |
| `code` | string | Yes | — |
| `description` | string | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |

### `PermissionUpdate` {#schema-permissionupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `description` | string | null | No | — |

### `PhysicalOrderApprovalNotice` {#schema-physicalorderapprovalnotice}

Shown to creation approvers when FY re-verification applies.

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `financial_year_label` | string | null | No | — |
| `financial_year_start` | string (date) | null | No | — |
| `financial_year_end` | string (date) | null | No | — |
| `fy_verified_asset_codes` | array of string | No | — |
| `reset_on_approval_asset_codes` | array of string | No | — |
| `message` | string | null | No | — |

### `PhysicalOrderAuditPublic` {#schema-physicalorderauditpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `action` | string | Yes | — |
| `label` | string | Yes | — |
| `detail` | string | null | No | — |
| `actor_name` | string | null | Yes | — |
| `old_value` | object (map) | null | Yes | — |
| `new_value` | object (map) | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |

### `PhysicalOrderDetail` {#schema-physicalorderdetail}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `order_number` | string | Yes | — |
| `plant_id` | integer | Yes | — |
| `plant_name` | string | Yes | — |
| `cost_center_id` | integer | Yes | — |
| `cost_center_code` | string | Yes | — |
| `cost_center_description` | string | Yes | — |
| `status` | string | Yes | — |
| `remarks` | string | null | Yes | — |
| `created_by` | integer | null | Yes | — |
| `created_by_name` | string | null | Yes | — |
| `assigned_to` | integer | null | Yes | — |
| `assigned_to_name` | string | null | Yes | — |
| `assigned_by_name` | string | null | Yes | — |
| `assigned_at` | string (date-time) | null | Yes | — |
| `started_at` | string (date-time) | null | Yes | — |
| `started_by_name` | string | null | Yes | — |
| `completed_at` | string (date-time) | null | Yes | — |
| `closed_at` | string (date-time) | null | No | — |
| `created_at` | string (date-time) | Yes | — |
| `approval_request_id` | integer | null | Yes | — |
| `items` | array of object | Yes | — |
| `verified_count` | integer | Yes | — |
| `physically_verified_count` | integer | Yes | — |
| `pending_physical_count` | integer | Yes | — |
| `rejected_item_count` | integer | Yes | — |
| `total_count` | integer | Yes | — |
| `audit` | array of object | Yes | — |
| `progress` | [`PhysicalOrderProgressPublic`](#schema-physicalorderprogresspublic) | Yes | — |
| `approval_notice` | any | null | No | — |

### `PhysicalOrderItemPublic` {#schema-physicalorderitempublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `asset_id` | integer | Yes | — |
| `asset_code` | string | Yes | — |
| `asset_name` | string | Yes | — |
| `rfid_code` | string | null | Yes | — |
| `verification_status` | string | Yes | — |
| `rejection_reason` | string | null | Yes | — |
| `scan_time` | string (date-time) | null | Yes | — |
| `verified_by_name` | string | null | Yes | — |
| `physically_verified` | boolean | Yes | — |
| `last_verification_date` | string (date) | null | No | — |

### `PhysicalOrderListItem` {#schema-physicalorderlistitem}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `order_number` | string | Yes | — |
| `plant_id` | integer | Yes | — |
| `plant_name` | string | Yes | — |
| `cost_center_id` | integer | Yes | — |
| `cost_center_code` | string | Yes | — |
| `cost_center_description` | string | Yes | — |
| `asset_count` | integer | Yes | — |
| `status` | string | Yes | — |
| `assigned_to_name` | string | null | Yes | — |
| `created_by_name` | string | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |

### `PhysicalOrderListResponse` {#schema-physicalorderlistresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `items` | array of object | Yes | — |
| `total` | integer | Yes | — |
| `page` | integer | Yes | — |
| `page_size` | integer | Yes | — |

### `PhysicalOrderProgressPublic` {#schema-physicalorderprogresspublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `steps` | array of object | Yes | — |
| `current_step_key` | string | null | Yes | — |
| `creation_workflow` | any | null | No | — |
| `closure_workflow` | any | null | No | — |

### `PlantChildCreate` {#schema-plantchildcreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `code` | string | Yes | min length `1`; max length `64` |
| `description` | string | Yes | min length `1`; max length `512` |
| `plant_id` | integer | Yes | — |

### `PlantChildPublic` {#schema-plantchildpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `code` | string | Yes | — |
| `description` | string | Yes | — |
| `plant_id` | integer | Yes | — |
| `plant_code` | string | null | No | — |
| `plant_name` | string | null | No | — |
| `is_active` | boolean | Yes | — |
| `created_at` | string (date-time) | Yes | — |
| `updated_at` | string (date-time) | Yes | — |

### `PlantChildUpdate` {#schema-plantchildupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `code` | string | null | No | — |
| `description` | string | null | No | — |
| `is_active` | boolean | null | No | — |

### `PlantOptionPublic` {#schema-plantoptionpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `name` | string | Yes | — |
| `code` | string | Yes | — |

### `RefreshRequest` {#schema-refreshrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `refresh_token` | string | Yes | min length `1` |

### `RejectItemsRequest` {#schema-rejectitemsrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `item_ids` | array of integer | Yes | — |
| `rejection_reason` | string | Yes | min length `1` |

### `RejectOrderRequest` {#schema-rejectorderrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `reason` | string | Yes | min length `1` |

### `ReportCatalogPublic` {#schema-reportcatalogpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `reports` | array of object | Yes | — |
| `plants` | array of object | Yes | — |

### `ReportDefinitionPublic` {#schema-reportdefinitionpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `key` | string | Yes | — |
| `title` | string | Yes | — |
| `description` | string | Yes | — |
| `filters` | array of object | Yes | — |
| `formats` | array of string | No | default `["xlsx", "pdf"]` |

### `ReportFilterOptionPublic` {#schema-reportfilteroptionpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `value` | string | Yes | — |
| `label` | string | Yes | — |

### `ReportFilterPublic` {#schema-reportfilterpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `key` | string | Yes | — |
| `label` | string | Yes | — |
| `kind` | string | Yes | — |
| `options` | array of object | Yes | — |

### `ResetPasswordRequest` {#schema-resetpasswordrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `token` | string | Yes | min length `10`; max length `512` |
| `new_password` | string | Yes | min length `8`; max length `128` |

### `ResetPasswordResponse` {#schema-resetpasswordresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `ok` | boolean | No | default `true` |

### `ResubmitRejectedResponse` {#schema-resubmitrejectedresponse}

Same approval request id; a new first-step approver task id after resubmit.

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `request_id` | integer | Yes | — |
| `new_task_id` | integer | Yes | — |
| `status` | string | No | default `"pending"` |

### `RoleCreate` {#schema-rolecreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `name` | string | Yes | min length `1`; max length `128` |
| `description` | string | null | No | — |
| `permission_ids` | array of integer | No | — |
| `org_unit_ids` | array of integer | No | Plants (org units) this role applies to; empty means all plants. |

### `RoleDetail` {#schema-roledetail}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `name` | string | Yes | — |
| `description` | string | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |
| `permissions` | array of object | Yes | — |
| `org_units` | array of object | Yes | — |

### `RoleListItem` {#schema-rolelistitem}

Built explicitly in the roles router (includes ``org_unit_ids`` from the association).

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `name` | string | Yes | — |
| `description` | string | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |
| `org_unit_ids` | array of integer | No | — |

### `RoleSummary` {#schema-rolesummary}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `name` | string | Yes | — |

### `RoleUpdate` {#schema-roleupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `name` | string | null | No | — |
| `description` | string | null | No | — |
| `permission_ids` | array of integer | null | No | — |
| `org_unit_ids` | array of integer | null | No | When set, replaces linked plants; empty list = all plants. |

### `ScanAssetRequest` {#schema-scanassetrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `scan_value` | string | Yes | min length `1` |
| `item_id` | integer | null | No | — |

### `ScanAssetResponse` {#schema-scanassetresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `item` | [`PhysicalOrderItemPublic`](#schema-physicalorderitempublic) | Yes | — |
| `verified_count` | integer | Yes | — |
| `total_count` | integer | Yes | — |

### `SessionIdleSettingsPublic` {#schema-sessionidlesettingspublic}

Minutes of inactivity (no API use / tab not active on client) before automatic sign-out.

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `idle_timeout_minutes` | integer | No | min `1.0`; max `1440.0`; default `10`; Applied to every user session. |

### `SubmitForApprovalRequest` {#schema-submitforapprovalrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `asset_ids` | array of integer | Yes | — |

### `SubmitForApprovalResponse` {#schema-submitforapprovalresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `submitted_count` | integer | Yes | — |
| `activated_count` | integer | Yes | — |
| `errors` | array of string | No | — |

### `TagColorCreate` {#schema-tagcolorcreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `code` | string | Yes | min length `1`; max length `64` |
| `name` | string | Yes | min length `1`; max length `255` |
| `color_hex` | string | null | No | — |

### `TagColorPublic` {#schema-tagcolorpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `code` | string | Yes | — |
| `name` | string | Yes | — |
| `color_hex` | string | null | Yes | — |
| `is_active` | boolean | Yes | — |
| `created_at` | string (date-time) | null | No | — |

### `TagColorUpdate` {#schema-tagcolorupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `code` | string | null | No | — |
| `name` | string | null | No | — |
| `color_hex` | string | null | No | — |
| `is_active` | boolean | null | No | — |

### `TaskApprovalActionLinePublic` {#schema-taskapprovalactionlinepublic}

One approver action on a workflow step (approve / reject with optional note).

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `actor_user_id` | integer | Yes | — |
| `actor_display_name` | string | Yes | — |
| `action` | string | Yes | — |
| `comment` | string | null | No | — |
| `created_at` | string (date-time) | null | No | — |

### `TaskApprovalContextPublic` {#schema-taskapprovalcontextpublic}

Enriched view of the backing approval request + current step (approval tasks only).

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `request_id` | integer | Yes | — |
| `entity_type` | string | Yes | — |
| `entity_id` | integer | Yes | — |
| `status` | string | Yes | — |
| `current_step` | integer | Yes | — |
| `created_by` | integer | null | Yes | — |
| `payload` | object (map) | No | — |
| `step_order` | integer | null | No | — |
| `approver_role_id` | integer | null | No | — |
| `approver_role_name` | string | null | No | — |
| `required_approvals` | integer | null | No | — |
| `created_by_display_name` | string | null | No | — |
| `workflow_steps` | array of object | No | — |

### `TaskApprovalStepLinePublic` {#schema-taskapprovalsteplinepublic}

One row in the visual approval workflow (per configured step).

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `step_order` | integer | Yes | — |
| `approver_role_name` | string | Yes | — |
| `required_approvals` | integer | Yes | — |
| `total_steps` | integer | Yes | — |
| `phase` | enum (`completed`, `current`, `upcoming`, `rejected`) | Yes | — |
| `approved_count` | integer | Yes | — |
| `actions` | array of object | No | — |
| `status_label` | string | Yes | — |
| `pool_size` | integer | No | default `0` |
| `pool_member_names` | array of string | No | — |

### `TaskAssignRequest` {#schema-taskassignrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `assigned_to` | integer | Yes | min `1.0` |

### `TaskAuditLogPublic` {#schema-taskauditlogpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `action` | string | Yes | — |
| `actor_user_id` | integer | null | No | — |
| `actor_display_name` | string | null | No | — |
| `old_value` | object (map) | null | No | — |
| `new_value` | object (map) | null | No | — |
| `created_at` | string (date-time) | null | No | — |

### `TaskCommentCreateRequest` {#schema-taskcommentcreaterequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `comment` | string | Yes | min length `1`; max length `10000` |

### `TaskCommentPublic` {#schema-taskcommentpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `user_id` | integer | Yes | — |
| `user_display_name` | string | null | No | — |
| `comment` | string | Yes | — |
| `created_at` | string (date-time) | null | No | — |

### `TaskCreateRequest` {#schema-taskcreaterequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `title` | string | Yes | min length `1`; max length `255` |
| `description` | string | null | No | — |
| `assigned_to` | integer | Yes | min `1.0` |
| `priority` | enum (`low`, `medium`, `high`) | No | default `"medium"` |
| `due_date` | string (date-time) | null | No | — |
| `entity_type` | string | null | No | — |
| `entity_id` | integer | null | No | — |
| `form_schema` | object (map) | null | No | — |
| `form_data` | object (map) | null | No | — |

### `TaskDetailPublic` {#schema-taskdetailpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `task_type` | string | Yes | — |
| `title` | string | null | No | — |
| `description` | string | null | No | — |
| `priority` | string | null | No | — |
| `status` | string | Yes | — |
| `due_date` | string (date-time) | null | No | — |
| `created_by` | integer | null | No | — |
| `assigned_to_user_id` | integer | null | No | — |
| `entity_type` | string | null | No | — |
| `entity_id` | integer | null | No | — |
| `form_schema` | object (map) | null | No | — |
| `form_data` | object (map) | null | No | — |
| `request_id` | integer | null | No | — |
| `step_id` | integer | null | No | — |
| `approval` | any | null | No | — |
| `comments` | array of object | No | — |
| `audit_logs` | array of object | No | — |

### `TaskInboxItem` {#schema-taskinboxitem}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `task_type` | enum (`approval`, `manual`, `rework`) | Yes | — |
| `title` | string | null | No | — |
| `priority` | string | null | No | — |
| `status` | string | Yes | — |
| `assigned_to_user_id` | integer | null | No | — |
| `due_date` | string (date-time) | null | No | — |
| `request_id` | integer | null | No | — |
| `step_id` | integer | null | No | — |
| `entity_type` | string | null | No | — |
| `entity_id` | integer | null | No | — |

### `TokenPair` {#schema-tokenpair}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `access_token` | string | Yes | — |
| `refresh_token` | string | Yes | — |
| `token_type` | const `bearer` | No | default `"bearer"` |

### `UpdatePhysicalOrderRequest` {#schema-updatephysicalorderrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `assigned_to` | integer | null | No | — |
| `remarks` | string | null | No | — |
| `asset_ids` | array of integer | null | No | — |

### `UserCreate` {#schema-usercreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `full_name` | string | Yes | min length `1`; max length `255` |
| `username` | string | Yes | min length `3`; max length `64` |
| `phone` | string | Yes | min length `10`; max length `32` |
| `email` | string (email) | Yes | — |
| `role_id` | integer | Yes | min `1.0` |
| `org_unit_id` | integer | Yes | min `1.0` |

### `UserMe` {#schema-userme}

Profile + RBAC snapshot for the authenticated user (JWT ``sub``).

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `full_name` | string | Yes | — |
| `email` | string | null | Yes | — |
| `phone` | string | null | Yes | — |
| `created_at` | string (date-time) | Yes | — |
| `is_superuser` | boolean | Yes | — |
| `is_active` | boolean | Yes | — |
| `role` | string | null | No | — |
| `org_unit` | string | null | No | — |
| `permissions` | array of string | Yes | — |

### `UserPublic` {#schema-userpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `full_name` | string | Yes | — |
| `username` | string | Yes | — |
| `phone` | string | null | Yes | — |
| `email` | string | null | Yes | — |
| `is_active` | boolean | Yes | — |
| `is_superuser` | boolean | Yes | — |
| `created_at` | string (date-time) | Yes | — |
| `updated_at` | string (date-time) | Yes | — |
| `mfa_setup_completed` | boolean | Yes | True if the user has completed MFA enrollment (TOTP).
When the relationship isn't loaded, defaults to False. |
| `role` | any | null | Yes | — |
| `org_unit` | any | null | Yes | — |

### `UserUpdate` {#schema-userupdate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `full_name` | string | null | No | — |
| `username` | string | null | No | — |
| `phone` | string | null | No | — |
| `email` | string (email) | null | No | — |
| `role_id` | integer | null | No | — |
| `org_unit_id` | integer | null | No | — |
| `is_active` | boolean | null | No | — |

### `ValidateAssetsRequest` {#schema-validateassetsrequest}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `asset_ids` | array of integer | Yes | — |

### `ValidateAssetsResponse` {#schema-validateassetsresponse}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `eligible_asset_ids` | array of integer | Yes | — |
| `active_order_conflicts` | array of object | Yes | — |
| `missing_rfid` | array of object | Yes | — |
| `plant_mismatch` | array of object | Yes | — |
| `cost_center_mismatch` | array of object | Yes | — |
| `financial_year_label` | string | null | No | — |
| `financial_year_start` | string (date) | null | No | — |
| `financial_year_end` | string (date) | null | No | — |
| `already_verified_in_fy` | array of object | No | — |

### `ValidationError` {#schema-validationerror}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `loc` | array of string | integer | Yes | — |
| `msg` | string | Yes | — |
| `type` | string | Yes | — |
| `input` | any | No | — |
| `ctx` | object | No | — |

### `VerifiedInFinancialYearRef` {#schema-verifiedinfinancialyearref}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `asset_id` | integer | Yes | — |
| `asset_code` | string | Yes | — |
| `asset_name` | string | Yes | — |
| `last_verification_date` | string (date) | null | No | — |
| `physical_count` | integer | null | No | — |

### `WorkflowMappingCreate` {#schema-workflowmappingcreate}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `action_code` | string | Yes | min length `1`; max length `128` |
| `workflow_id` | integer | Yes | min `1.0` |

### `WorkflowMappingPublic` {#schema-workflowmappingpublic}

| Field | Type | Required | Constraints / Notes |
|-------|------|----------|---------------------|
| `id` | integer | Yes | — |
| `action_code` | string | Yes | — |
| `workflow_id` | integer | Yes | — |
| `workflow_name` | string | null | No | — |
| `is_active` | boolean | Yes | — |
| `created_at` | string (date-time) | Yes | — |

## Appendix A: Permission Requirements

Endpoints require the listed permission code(s) in addition to a valid Bearer token. When multiple codes are listed with **OR**, any one is sufficient.

### App API

| Endpoint | Permission |
|----------|------------|
| `GET /me` | Authenticated user (no specific permission) |
| `GET /approvals/my-tasks` | `approval.view` |
| `GET /approvals/requests/{id}` | `approval.view` + access check |
| `POST /approvals/requests/{id}/resubmit` | Request creator only |
| `GET /approvals/requests/{id}/status` | `approval.view` |
| `POST /approvals/tasks/{id}/action` | `approval.act` |
| `POST /approvals/tasks/{id}/comment` | `approval.view` + access check |
| `GET /audit/entity/{type}/{id}` | `users.view` OR `approval.view` (for user entities); else `approval.view` |
| `GET /dashboard/summary` | Authenticated user |
| `GET /tasks/my-tasks` | `task.view` |
| `GET /tasks/{id}` | `task.view` + access check |
| `POST /tasks` | `task.create` |
| `POST /tasks/{id}/assign` | `task.assign` |
| `POST /tasks/{id}/start` | `task.act` |
| `POST /tasks/{id}/complete` | `task.act` |
| `POST /tasks/{id}/close` | `task.close` |
| `POST /tasks/{id}/comments` | `task.view` + access check |
| `GET /reports/catalog` | Authenticated user |
| `GET /reports/generate` | Authenticated user |

### Mobile application (login gate)

| Rule | Detail |
|------|--------|
| Mobile sign-in | `POST /login` and `POST /auth/mfa/verify` with `client_type: "mobile"` |
| Required permission | `mobile.access` (assign via role in admin UI) |
| Superuser | Always allowed on mobile |
| Web sign-in | `client_type` omitted or `web` — no `mobile.access` check |

### Admin API — Users

| Endpoint | Permission |
|----------|------------|
| `POST /admin/users` | `users.create` |
| `GET /admin/users` | `users.view` |
| `PATCH /admin/users/{id}` | `users.update` |
| `POST /admin/users/{id}/resend-mfa` | `mfa.manage` |
| `POST /admin/users/{id}/resend-welcome` | `users.update` |
| `POST /admin/users/{id}/roles/{role_id}` | `users.update` |
| `DELETE /admin/users/{id}` | **Superuser only** |

### Admin API — Org Units

| Endpoint | Permission |
|----------|------------|
| `GET /admin/org-units` | `org_units.view` OR `users.create` OR `users.update` OR `roles.create` OR `roles.update` OR `asset.view` OR `asset.create` OR `asset.update` OR `masters.view` |
| `GET /admin/org-units/{id}` | `org_units.view` OR `org_units.update` |
| `POST /admin/org-units` | `org_units.create` |
| `PATCH /admin/org-units/{id}` | `org_units.update` |

### Admin API — Roles & Permissions

| Endpoint | Permission |
|----------|------------|
| `POST /admin/roles` | `roles.create` |
| `PATCH /admin/roles/{id}` | `roles.update` |
| `DELETE /admin/roles/{id}` | `roles.delete` |
| `POST /admin/permissions/sync` | `permissions.create` OR `roles.update` |
| `POST /admin/permissions` | `permissions.create` |
| `PATCH /admin/permissions/{id}` | `permissions.update` |
| `DELETE /admin/permissions/{id}` | `permissions.delete` |

### Admin API — Settings

| Endpoint | Permission |
|----------|------------|
| `PUT /admin/settings/password-policy` | `settings.update` |
| `GET /admin/settings/auth-policy` | `auth_policy.view` |
| `PUT /admin/settings/auth-policy` | `auth_policy.update` |
| `GET/PUT /admin/settings/email-delivery` | `settings.update` |
| `POST /admin/settings/email-delivery/test` | `settings.update` |
| `GET/PUT /admin/settings/session-idle` | `settings.update` |
| `GET/PUT /admin/settings/financial-year` | `settings.update` |

### Admin API — Approval Workflows & Mappings

All routes under `/admin/approval-workflows` and `/admin/workflow-mappings` require **superuser** + `approval.manage`.

### Admin API — Email Templates

All routes require **superuser** plus per-route: `email_templates.view`, `email_templates.create`, `email_templates.update`, or `email_templates.delete`.

### Admin API — Assets

| Endpoint | Permission |
|----------|------------|
| `GET /admin/assets/*` (read) | `asset.view` |
| `POST /admin/assets` | `asset.create` |
| `PATCH /admin/assets/{id}` | `asset.update` OR `asset.manage` |
| `DELETE /admin/assets/{id}` | `asset.delete` OR `asset.manage` |
| `POST /admin/assets/import/*` | `asset.import` |
| `POST /admin/assets/*/rfid/*` | `asset.update` OR `asset.manage` |
| `POST /admin/assets/submit-for-approval` | `asset.create` |

### Admin API — Asset Masters

| Endpoint | Permission |
|----------|------------|
| `GET /admin/asset-masters/*` | `masters.view` OR `asset.view` |
| `POST /admin/asset-masters/*` | `masters.create` |
| `PATCH /admin/asset-masters/*` | `masters.update` |

### Admin API — Physical Orders

| Endpoint | Permission |
|----------|------------|
| `POST /admin/physical-orders/validate-assets` | `order.create` |
| `GET /admin/physical-orders/executors` | `order.create` OR `order.manage` OR `order.reassign` OR `order.execute` |
| `GET /admin/physical-orders` | `order.view` |
| `POST /admin/physical-orders` | `order.create` |
| `GET /admin/physical-orders/{id}` | `order.view` |
| `PATCH /admin/physical-orders/{id}` | `order.update` |
| `POST /admin/physical-orders/{id}/submit` | `order.create` |
| `POST /admin/physical-orders/{id}/approval/*` | `order.approve` and/or `order.create` (see endpoint) |
| `POST /admin/physical-orders/{id}/execution/*` | `order.execute` |
| `POST /admin/physical-orders/{id}/reassign` | `order.reassign` OR `order.create` OR `order.update` OR `order.manage` |
| `POST /admin/physical-orders/{id}/close` | `order.approve` OR `order.update` OR `order.create` |
| `POST /admin/physical-orders/{id}/start` | `order.execute` |
| `POST /admin/physical-orders/{id}/scan` | `order.execute` |
| `POST /admin/physical-orders/{id}/submit-closure` | `order.execute` |
| `POST /admin/physical-orders/{id}/closure/approve-order` | `order.approve` OR `order.create` |

---

## Appendix B: Special Endpoint Notes

### `POST /login` — Multiple response shapes

Login does not use a fixed response model. Possible `200` responses:

**Success (tokens):**
```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "token_type": "bearer"
}
```

**MFA challenge required:**
```json
{
  "mfa_required": true,
  "setup_required": false,
  "challenge_token": "<token>",
  "expires_in": 300
}
```

**MFA setup required (first-time enrollment):**
```json
{
  "mfa_required": true,
  "setup_required": true,
  "setup_token": "<token>",
  "expires_in": 300
}
```

**Content types accepted:** `application/json` or `application/x-www-form-urlencoded`. Multipart (`415`) is not supported.

**Identifier fields:** Provide one of `email`, `phone`, or `username` plus `password`. Optional `captcha_token` when CAPTCHA is enabled.

**Mobile client (`client_type: "mobile"`):**

```json
{
  "email": "user@example.com",
  "password": "secret",
  "client_type": "mobile"
}
```

If the user does not have `mobile.access`, login returns **403**:

```json
{
  "error": "mobile_access_denied",
  "detail": "Your account is not authorized to use the mobile application."
}
```

After MFA, send the same `client_type` to `POST /auth/mfa/verify`.

### File download endpoints

These return binary files (not JSON) with `Content-Disposition: attachment`:

| Endpoint | Format |
|----------|--------|
| `GET /reports/generate` | `xlsx` or `pdf` |
| `GET /admin/assets/export` | Spreadsheet export |
| `GET /admin/assets/fy-verification/export` | FY verification report |

### Multipart upload endpoints

| Endpoint | Field | Description |
|----------|-------|-------------|
| `POST /admin/assets/import/preview` | `file` | Excel/CSV asset import file |

### RFID error responses

`POST /admin/assets/*/rfid/*` may return structured errors:

- **409** `{ "code": "duplicate_rfid", "message": "...", "rfid_code": "...", "existing_asset_id": 1, "existing_asset_code": "..." }`
- **422** `{ "code": "invalid_rfid" }` or `{ "code": "invalid_tag_color" }`

### Unmounted legacy route

`GET/PATCH /admin/auth-policy` exists in source (`auth_policy/admin_router.py`) but is **not mounted**. Use `/admin/settings/auth-policy` instead.

---

## Appendix C: Regenerating This Document

With the backend running on port 8000:

```bash
curl -s http://127.0.0.1:8000/openapi.json -o /tmp/openapi.json
# Then run the generator script in docs/generate_api_docs.py (if added)
```

Or browse live interactive docs at `http://localhost:8000/docs`.

---

## Appendix D: Mobile application permissions

Permissions for the upcoming mobile APK. Assign them to roles in **Roles** (or sync via **Permissions → Sync from config** / migration `044`).

| Permission code | Action | Description | Mobile usage |
|-----------------|--------|-------------|--------------|
| `mobile.access` | access | Sign in to the mobile application | **Required** to obtain tokens when `client_type` is `mobile` on login/MFA |
| `mobile.asset.view` | view | View assets in the mobile app | Browse asset list and details offline/online |
| `mobile.asset.scan` | scan | Scan RFID / barcodes for assets | Attach or verify assets via device scanner |
| `mobile.order.view` | view | View physical orders on mobile | Order inbox and detail screens |
| `mobile.order.execute` | execute | Execute physical orders from mobile | Start orders, mark progress, submit closure |
| `mobile.order.scan` | scan | Scan during order execution | RFID scan step on order line items |

### Recommended role setup

| Role type | Minimum permissions |
|-----------|---------------------|
| Mobile field operator | `mobile.access`, `mobile.order.view`, `mobile.order.execute`, `mobile.order.scan` |
| Mobile asset tagger | `mobile.access`, `mobile.asset.view`, `mobile.asset.scan` |
| Mobile supervisor | All `mobile.*` permissions above |

### API flow for mobile clients

1. `GET /auth/policy` — optional; check MFA/CAPTCHA before login UI.
2. `POST /login` with `client_type: "mobile"` — returns tokens or MFA challenge.
3. If MFA: `POST /auth/mfa/verify` with `challenge_token`, `otp`, and `client_type: "mobile"`.
4. `GET /me` — read `permissions[]`; gate in-app features (`mobile.asset.*`, `mobile.order.*`).
5. Use existing admin/app APIs (orders scan, assets, etc.) with the Bearer token; enforce feature permissions in the mobile UI.

Superusers bypass `mobile.access` and receive all permission codes on `GET /me`.
