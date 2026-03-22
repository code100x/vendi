# Vendi — Full Implementation Plan

## Context

Vendi is a SaaS platform that lets non-technical people (CEOs/PMs) make code changes to their org's repos via a simplified chat interface + live preview. Unlike Claude Code/Devin, the UI hides all code/diffs/terminal output and shows only plain-English status updates.

**Key architectural decisions:**
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) as the AI agent layer, running inside e2b sandboxes
- **BYOK model** — each user provides their own Anthropic API key (no "Sign in with Claude" exists; subscription OAuth tokens are banned for third-party use)
- **Agent runs inside the sandbox** (Approach A) — all file I/O is local to sandbox, Vendi server only sends/receives chat messages
- **Output filtering** — stream Agent SDK output, hide diffs/terminal/file paths, show only human-friendly status messages

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind + Shadcn |
| Backend | Node.js + Express |
| Database | PostgreSQL + Prisma |
| Auth | Lucia Auth + Arctic (Google/GitHub OAuth) |
| State | Zustand + React Query |
| Real-time | WebSocket (`ws` library) |
| AI Agent | Claude Agent SDK inside e2b sandboxes |
| GitHub | Octokit (via user's OAuth token with `repo` scope) |
| Monorepo | Turborepo + bun workspaces |

---

## 1. Monorepo Structure

```
vendi/
├── turbo.json
├── package.json                    # bun workspaces root
├── tsconfig.base.json
├── apps/
│   ├── web/                        # React + Vite frontend
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── routes.tsx
│   │   │   ├── lib/                # api.ts, ws.ts, utils.ts
│   │   │   ├── hooks/              # useAuth, useSession, useWebSocket, useOrg
│   │   │   ├── stores/             # authStore, sessionStore, orgStore (Zustand)
│   │   │   ├── components/
│   │   │   │   ├── ui/             # Shadcn components
│   │   │   │   ├── layout/         # AppLayout, Sidebar, Header
│   │   │   │   ├── chat/           # ChatPanel, ChatMessage, ChatInput, StatusIndicator
│   │   │   │   ├── preview/        # PreviewPanel, PreviewToolbar
│   │   │   │   ├── session/        # SessionActions, SessionTimer
│   │   │   │   ├── project/        # ProjectCard, SetupWizard, ServiceChecklist
│   │   │   │   └── org/            # InviteModal, MemberList, RepoSelector
│   │   │   └── pages/
│   │   │       ├── auth/           # SignIn, SignUp, OAuthCallback
│   │   │       ├── org/            # CreateOrg, OrgSettings
│   │   │       ├── dashboard/      # Dashboard
│   │   │       ├── project/        # ProjectSetup, ProjectSettings
│   │   │       ├── session/        # SessionPage (chat+preview), SessionHistory
│   │   │       └── settings/       # UserSettings (API key, profile)
│   │   └── ...config files
│   │
│   └── server/                     # Express backend
│       ├── prisma/
│       │   └── schema.prisma
│       └── src/
│           ├── index.ts            # Express + HTTP + WS server entry
│           ├── app.ts              # Middleware, routes
│           ├── config/             # env.ts (Zod-validated), constants.ts
│           ├── lib/                # prisma.ts, auth.ts, crypto.ts, github.ts, e2b.ts, ws.ts
│           ├── middleware/         # requireAuth, requireOrg, errorHandler
│           ├── routes/             # auth, org, project, session, github, user
│           ├── services/           # auth, org, project, session, sandbox, agent, template
│           ├── ws/                 # handler.ts, rooms.ts, messages.ts
│           └── jobs/               # cleanupSandboxes.ts, templateBuilder.ts
│
└── packages/
    └── shared/                     # Shared types + validation
        └── src/
            ├── types/              # auth, org, project, session, chat, ws
            ├── constants/          # roles, sessionStatus, limits
            └── validation/         # Zod schemas
```

---

## 2. Database Schema (Prisma)

### Core Models

**User** — `id`, `email`, `name`, `avatarUrl`, `githubId`, `googleId`, `encryptedApiKey`, `apiKeyIv`

**OAuthAccount** — `userId`, `provider` (google|github), `providerAccountId`, `accessToken` (encrypted), `refreshToken`, `scopes`

**AuthSession** — Lucia session: `id`, `userId`, `expiresAt`

**Organization** — `id`, `name`, `slug`, `githubInstallationId?`

**OrgMember** — `userId`, `orgId`, `role` (ADMIN|MEMBER). Unique on [userId, orgId]

**OrgInvite** — `orgId`, `email?`, `token`, `role`, `expiresAt`, `acceptedAt?`

**Project** — `id`, `orgId`, `name`, `githubRepoFullName`, `githubRepoUrl`, `defaultBranch`, `envVars` (encrypted), `contextInstructions`, `startupCommands[]`, `requiredServices[]`, `allowedFilePatterns[]`, `e2bTemplateId?`, `templateStatus` (PENDING|BUILDING|READY|FAILED), `maxSessionDurationMin` (default 60), `maxBudgetUsd` (default 5.0)

**Session** — `id`, `projectId`, `userId`, `branchName`, `status` (STARTING|RUNNING|STOPPING|COMPLETED|ERRORED|TIMED_OUT), `sandboxId?`, `previewUrl?`, `totalTokensIn`, `totalTokensOut`, `totalCostUsd`, `outcome?` (PR_CREATED|COMMITTED_TO_MAIN|DISCARDED), `prUrl?`, `commitSha?`, `startedAt`, `endedAt?`

**ChatMessage** — `id`, `sessionId`, `role` (USER|ASSISTANT|SYSTEM), `content` (filtered), `rawContent?` (original agent output), `metadata` (JSON: filesChanged, toolsUsed, hasErrors)

---

## 3. API Routes (`/api/v1`)

### Auth (`/auth`)
- `GET /auth/google` — redirect to Google OAuth
- `GET /auth/google/callback` — handle callback, create/login user
- `GET /auth/github` — redirect to GitHub OAuth (with `repo` scope)
- `GET /auth/github/callback` — handle callback
- `GET /auth/me` — get current user
- `POST /auth/logout` — destroy session

### User (`/users`)
- `PUT /users/api-key` — store encrypted Anthropic API key
- `DELETE /users/api-key` — remove key
- `GET /users/api-key/status` — check if key is set (boolean only)

### Org (`/orgs`)
- `POST /orgs` — create org
- `GET /orgs` — list user's orgs
- `GET /orgs/:orgId` — org details (Member+)
- `PUT /orgs/:orgId` — update org (Admin)
- `DELETE /orgs/:orgId` — delete org (Admin)
- `GET/POST/DELETE /orgs/:orgId/members` — member management (Admin)
- `POST /orgs/:orgId/invites` — create invite (Admin)
- `POST /orgs/invites/:token/accept` — accept invite

### GitHub (`/github`)
- `GET /github/repos` — list user's repos
- `GET /github/repos/:owner/:repo` — repo details

### Project (`/orgs/:orgId/projects`)
- `POST` — create project (Admin)
- `GET` — list projects (Member+)
- `GET /:projectId` — project details
- `PUT /:projectId` — update config (Admin)
- `POST /:projectId/build-template` — trigger e2b template build (Admin)
- `GET /:projectId/template-status` — poll build status
- `GET /:projectId/active-sessions` — list active sessions (conflict check)

### Session (`/sessions`)
- `POST /sessions` — start new session (body: `{projectId}`)
- `GET /sessions/:sessionId` — session details
- `GET /sessions/:sessionId/messages` — chat history
- `POST /sessions/:sessionId/create-pr` — create PR, stop sandbox
- `POST /sessions/:sessionId/commit-to-main` — merge to main, stop sandbox (Admin)
- `POST /sessions/:sessionId/discard` — discard, stop sandbox
- `GET /orgs/:orgId/sessions` — session history for org

---

## 4. Frontend Routes

```
/signin, /signup, /auth/callback/:provider — public auth pages
/invite/:token — accept invite (prompts login if not authed)

/ → redirect to /orgs
/orgs — org list
/orgs/new — create org
/orgs/:orgId — dashboard (project list)
/orgs/:orgId/projects/:projectId/setup — project setup wizard (Admin)
/orgs/:orgId/projects/:projectId/settings — project settings
/orgs/:orgId/sessions — session history
/orgs/:orgId/settings — org settings (members, invites)
/settings — user settings (API key, profile)

/session/:sessionId — full-screen chat + preview (no sidebar)
```

---

## 5. e2b Integration

### Template Building (`template.service.ts`)
1. Admin submits project config (services, startup commands, env vars)
2. Server builds an e2b Template programmatically:
   - Base image: `node:22-bookworm`
   - Install services: PostgreSQL, Redis based on `requiredServices`
   - Install Claude Agent SDK globally + bake in a `/sandbox-agent/runner.ts` script
   - Install git, curl
   - Set env vars
3. `Template.build()` → store `e2bTemplateId` on Project, mark as READY

### Sandbox Lifecycle (`sandbox.service.ts`)
**Start:** `Sandbox.create(templateId)` → clone repo → checkout new branch `vendi/session-<id>` → write .env → start services → run startup commands → get preview URL from `sandbox.getHost(port)`

**Stop:** `sandbox.kill()` — called after PR creation, commit, discard, or timeout

**Reconnect:** Store `sandboxId` on Session. Server can `Sandbox.connect(sandboxId)` after restart.

**Cleanup job:** Runs every 5 min, kills sandboxes for COMPLETED/ERRORED/TIMED_OUT sessions.

---

## 6. Agent Architecture (the core)

**Agent runs INSIDE the sandbox.** A small Node.js script (`/sandbox-agent/runner.ts`) is baked into every template:

```typescript
// Runs inside e2b sandbox
import { query } from "@anthropic-ai/claude-agent-sdk";

const prompt = process.argv[2];
for await (const message of query({
  prompt,
  options: {
    maxBudgetUsd: parseFloat(process.env.MAX_BUDGET_USD || "5"),
    permissionMode: "bypassPermissions",
    cwd: "/workspace",
    systemPrompt: process.env.SYSTEM_PROMPT,
    includePartialMessages: true,
  },
})) {
  process.stdout.write(JSON.stringify(message) + "\n");
}
```

**Vendi server** spawns this via `sandbox.commands.run()` and reads streamed JSON lines:
- Parses each line as an Agent SDK message
- Filters output (hide tool calls, diffs, file paths → show only natural language + high-level status)
- Broadcasts filtered messages to WebSocket room
- Persists both raw and filtered content to DB

**System prompt** tells the agent:
- Only modify files matching `allowedFilePatterns`
- Explain changes in simple terms, no code syntax
- Fix breakages before reporting back
- Commit changes with clear messages
- Project-specific context instructions from developer

**Output filtering logic:**
- `text` blocks from agent → keep (this is the human-friendly summary)
- `tool_use` blocks → extract file paths for metadata, don't show to user
- `tool_result` blocks → check for errors, don't show to user
- If no text but files changed → generate summary: "I've updated 2 files: App.tsx, Header.tsx"

---

## 7. WebSocket Architecture

**Path:** `/ws` on the Express HTTP server

**Auth:** Validate session cookie on connection upgrade

**Rooms:** Map of `sessionId → Set<WebSocket>`. User joins room when opening session page.

### Message Types (shared types in `packages/shared`)

**Client → Server:**
- `join_session` / `leave_session`
- `chat_message` (sessionId + content)
- `stop_session`

**Server → Client:**
- `session_status` — sandbox provisioning progress
- `chat_message` — user or assistant message
- `agent_status` — "Thinking...", "Editing files...", etc.
- `agent_streaming` — partial text deltas for typing effect
- `preview_updated` — signal frontend to refresh iframe
- `cost_update` — running token/cost totals
- `conflict_warning` — other active sessions on same project
- `error` — error messages

### Flow
1. User sends `chat_message` via WS
2. Server persists user message, broadcasts it to room
3. Server broadcasts `agent_status: "Thinking..."`
4. Server spawns agent runner in sandbox
5. As agent streams, server filters + broadcasts `agent_streaming` deltas
6. On agent turn complete: broadcast full `chat_message` (ASSISTANT) + `preview_updated` + `cost_update`
7. Frontend `ChatPanel` renders messages, `PreviewPanel` reloads iframe

---

## 8. GitHub Integration

- **OAuth:** Arctic library for Google/GitHub. GitHub OAuth requests `repo` scope for private repo access.
- **Token storage:** GitHub access token stored encrypted in `OAuthAccount.accessToken`
- **Repo listing:** `octokit.repos.listForAuthenticatedUser()` via user's token
- **Branch creation:** Create `vendi/session-<id>` branch via `octokit.git.createRef()`
- **PR creation:** After agent commits + pushes from sandbox, `octokit.pulls.create()` from session branch to default branch
- **Commit to main (Admin):** Create PR then `octokit.pulls.merge()`

---

## 9. Security & Guardrails

- **API key encryption:** AES-256-GCM for Anthropic keys and GitHub tokens. IV stored alongside.
- **File pattern enforcement:** `allowedFilePatterns` in system prompt + server-side validation
- **Budget caps:** `maxBudgetUsd` per session via Agent SDK option
- **Session timeout:** `maxSessionDurationMin` enforced via e2b sandbox timeout
- **Conflict detection:** Check for active sessions on same project before starting new one; warn user
- **Role-based access:** Admin can configure projects, merge to main. Member can chat and create PRs.
- **Rate limiting:** express-rate-limit on session creation and chat messages

---

## 10. Implementation Order

| Phase | What | Depends On |
|-------|------|-----------|
| **1** | Monorepo scaffold, Prisma schema, Lucia auth (Google/GitHub), frontend shell with React Router, Shadcn setup | — |
| **2** | Org CRUD, member management, invites, GitHub repo listing, project CRUD, API key management | Phase 1 |
| **3** | e2b template building, sandbox agent runner script, template status UI | Phase 2 |
| **4** | Session lifecycle (start/stop sandbox), branch management, conflict detection | Phase 3 |
| **5** | WebSocket server, chat message handling, agent integration, output filtering, streaming UI | Phase 4 |
| **6** | Live preview (iframe + port exposure + auto-refresh) | Phase 4-5 |
| **7** | PR creation, commit to main, discard session, session finalization UI | Phase 5 |
| **8** | Session history page, session detail view, UX polish, error handling | All |
| **9** | Security hardening, rate limiting, logging, production deployment config | All |

---

## 11. Key Packages

**Frontend:** `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `zustand`, `axios`, `tailwindcss`, `@radix-ui/*` (Shadcn), `lucide-react`, `sonner`, `zod`

**Backend:** `express`, `@prisma/client`, `lucia`, `arctic`, `@octokit/rest`, `e2b`, `@anthropic-ai/claude-agent-sdk`, `ws`, `zod`, `node-cron`, `nanoid`, `pino`

**Shared:** `zod`

---

## 12. Verification Plan

1. **Auth:** Sign in with Google/GitHub → verify session cookie set → `/auth/me` returns user
2. **Org:** Create org → invite member → member accepts → verify roles work
3. **Project setup:** Link repo → configure services/env/commands → build template → verify template status goes to READY
4. **Session start:** Click "Start Session" → verify sandbox spins up → preview URL loads → chat input is available
5. **Chat:** Send message → verify agent responds with filtered output → preview updates
6. **PR creation:** Click "Create PR" → verify branch pushed → PR created on GitHub → sandbox killed → session marked COMPLETED
7. **Cost tracking:** After a few messages, verify cost_update shows reasonable numbers
8. **Conflict warning:** Start two sessions on same project → verify warning appears
9. **Session history:** Complete a session → verify it appears in history with correct metadata
