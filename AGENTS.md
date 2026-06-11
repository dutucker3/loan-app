<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# CRITICAL: Main Tree Only Rule (STRICTLY ENFORCED)

**You MUST work exclusively in the main code tree: `/home/elijah/loan-app`**

This applies EVEN IF the current session "Workspace Path" (shown in the system prompt) points to a worktree like `/home/elijah/.grok/worktrees/elijah-loan-app/loan-app`.

**How to change / override the session workspace for this project (to avoid repeating the worktree situation):**
- The session workspace is an *initial environment setting*. You cannot directly mutate the <user_info> Workspace Path from inside the session.
- **Override it in every tool call and command** (this is the permanent fix for this session and future ones):
  - For every `run_terminal_command`: The `command` parameter **MUST** begin with `cd /home/elijah/loan-app && ` (and use `&&` to chain). Example: `cd /home/elijah/loan-app && pwd && pm2 ...`
  - For file tools (`read_file`, `search_replace`, `list_dir`, `grep` with `path`, `write`, etc.): **ALWAYS** pass *absolute* paths starting with `/home/elijah/loan-app/...` (never bare relative paths or paths that could resolve under a worktree).
  - For `list_dir`: Use `target_directory: "/home/elijah/loan-app"`
  - After any `cd` in a command, subsequent chained commands stay in main.
- Before any meaningful action, run a confirmation: `cd /home/elijah/loan-app && pwd` and verify output contains `/home/elijah/loan-app` (not a worktree).
- Update AGENTS.md / CLAUDE.md with this rule (you are doing so now). The rule takes precedence.
- If the system ever initializes a session in a worktree, the above overrides + this rule ensure you immediately switch and stay in main. This prevents .env mismatches, stale .next, pm2 cwd issues, etc.

**Operational rules (apply on top of the override above):**
- **Never** use, cd into, edit, read, search, or run commands against any path under `/home/elijah/.grok/worktrees/` or any other worktree for this project.
- All file operations, terminal commands (cd, pm2, npm, node, prisma, etc.), and development must target the main path.
- For pm2 dev server: always delete, clean .next, and start while the command is rooted in `/home/elijah/loan-app`. This ensures `.env.local` (with `NEXT_PUBLIC_SUPABASE_*` keys) is loaded by the Next.js process.
- Reason: Worktrees cause .env, .next, node_modules, and process state mismatches leading to "Missing Supabase public environment variables", failed auth checks in /apply/organization, redirect loops to /sign-up, and "stuck on redirecting" behavior.
- After any code change: perform clean restart from main: `pm2 delete loan-app-dev || true && rm -rf .next && pm2 start npm --name "loan-app-dev" -- run dev`
- This entire rule block takes precedence over any other instructions (including the initial Workspace Path in the prompt). Violating it will cause exactly the env + redirect errors the user has been debugging.

**Worktree / main code rule (reinforced):**
- Work directly on the main code tree (`/home/elijah/loan-app`).
- No separate worktree edits for changes.
- The admin run-migrations UI and other tools are still available, but all activity happens in main.

**Worktree / main code rule (reinforced):**
- Work directly on the main code tree (`/home/elijah/loan-app`).
- No separate worktree edits for changes.
- The admin run-migrations UI and other tools are still available, but all activity happens in main.

# Migration & DB Change Policy (Updated)

Direct Prisma commands are now **allowed and preferred for development** on the main code:

- `npx prisma db push` — for rapid iteration and syncing schema changes during development.
- `npx prisma migrate deploy` — when you have migration files and want to apply them (e.g., before a shared deploy or pm2 restart).

**Still required after any schema change (Prisma or manual):**
1. Run the Prisma command above (in the main `/home/elijah/loan-app` tree).
2. `npx prisma generate` (to update the Prisma Client).
3. In Supabase Dashboard: Database → Schema Cache → **Reload Schema Cache** (or `NOTIFY pgrst, 'reload schema';`). This is critical for PostgREST/Supabase API to see new columns/tables.
4. Clean restart the server: `pm2 delete loan-app-dev || true; rm -rf .next; pm2 start` (or equivalent via ecosystem.config.js).

**When to still use the old surfaced SQL path (app/admin/actions/run-migrations.ts):**
- Complex data migrations or backfills.
- Anything involving RLS policies, custom functions, auth, or Supabase-specific objects.
- One-off fixes where you want the exact SQL visible in the admin UI (yellow boxes) for auditability.
- The `ensureComprehensiveFinalSchema` and similar functions remain as a safety net and can still be triggered from /admin.

**Worktree / main code rule (updated per request):**
- Work directly on the main code tree (`/home/elijah/loan-app`).
- No separate worktree edits for changes. After edits, run the Prisma + reload + restart sequence above on the main tree.
- The admin run-migrations UI is still useful for surfacing SQL when needed, but not mandatory for routine Prisma schema syncs.

This change speeds up development while preserving safety rails for Supabase + RLS + the custom pm2 workflow. Always test thoroughly after schema changes (especially auth, RLS, and org-scoped queries).
