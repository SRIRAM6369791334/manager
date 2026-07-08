# Antigravity Dashboard

Central hub for managing AI plugins, skills, tasks, git operations, and system controls.

## Features

### Core Dashboard
| Feature | Status | Notes |
|---------|--------|-------|
| Plugin Manager | ✅ Implemented | Enable/disable AI plugins |
| Task Scheduler | ✅ Implemented | Real cron-based execution via `node-cron` with run history |
| Git Integration | ✅ Implemented | Multi-repo support, commit/push |
| Real-time Logs | ✅ Implemented | SSE-based log streaming |
| Session Analytics | ✅ Implemented | Usage statistics and charts |
| File Watcher | ✅ Implemented | Single-path directory monitoring |
| Backup & Restore | ✅ Implemented | Zip/restore configuration |
| Global Rules | ✅ Implemented | Inject rules into AI context |
| Subagents Builder | ✅ Implemented | Create custom AI agents |
| Custom Macros | ✅ Implemented | Build slash command macros |
| Memory Injector | ✅ Implemented | Persistent project memory |
| System Controls | ✅ Implemented | Volume, media, file organizer, web scraper |
| Agent Arena | ✅ Implemented | Multi-agent AI debate system |

### Antigravity-Native Features
| Feature | Status | Notes |
|---------|--------|-------|
| Skill Scope (Global vs Workspace) | ✅ Implemented | Reads `~/.gemini/config/skills/` (Global) and `.agents/skills/` (Workspace); Workspace overrides Global on name match |
| YAML Frontmatter Parsing | ✅ Implemented | Extracts `name` and `description` from each SKILL.md — the field Antigravity uses for semantic skill triggering |
| Description Linter | ✅ Implemented | Flags vague/generic descriptions that won't trigger reliably |
| Semantic Trigger Tester | ✅ Implemented | Type a user request → see ranked skill matches by description overlap |
| Skill Conflict Detector | ✅ Implemented | Jaccard similarity >60% flagged as overlap; scope-duplicate skills flagged |
| MCP Server Health Monitor | ✅ Implemented | Pings each configured MCP server URL; shows connected/unreachable |
| Skill ↔ MCP Mapping | ✅ Implemented | Parses SKILL.md body for MCP tool references |
| Trust Artifact Viewer | ✅ Implemented | Lists task-lists, plans, screenshots, recordings from `.agents/artifacts/` |
| Skill Usage Heatmap | ✅ Implemented | Tracks per-skill trigger count over time |
| Rule ↔ Skill Enforcement | ✅ Implemented | Checks rules for required skill names, verifies they're installed |
| Marketplace Search | ✅ Implemented | Configurable registry URL with fallback to local hardcoded catalog |
| Skill Script Sandbox | ✅ Implemented | Runs skill scripts with `--help` only (never full execution), 5s timeout |

### Security & Reliability
| Feature | Status | Notes |
|---------|--------|-------|
| Audit Log | ✅ Implemented | Tracks all destructive actions with timestamps + IP |
| Task History | ✅ Implemented | Execution history with exit codes and output capture |
| API Rate Limiting | ✅ Implemented | Token-bucket per-IP (60 req/min, 5/min for login) |
| CSRF Protection | ✅ Implemented | Origin/referer header validation |
| Path Traversal Protection | ✅ Implemented | All file writes confined via safeJoin + safeFilename |
| Command Injection Protection | ✅ Implemented | execFile + argument arrays for all shell operations |
| SSRF Protection | ✅ Implemented | Private IP blocklist for web scraper |
| Secrets Handling | ✅ Implemented | API key sent via header, masked in responses |
| Confirmation Dialogs | ✅ Implemented | All destructive actions require confirm() |

### Planned / In Progress
| Feature | Status | Notes |
|---------|--------|-------|
| Light/Print Theme | 🚧 Planned | In addition to 4 existing dark themes |
| Scheduled Backups | 🚧 Planned | Auto-backup via task scheduler |
| Multi-LLM Arena | 🚧 Planned | Anthropic/Ollama support for Agent Arena |
| Mobile Responsive Layout | 🚧 Planned | Collapsible sidebar, stacked grids |
| Command Palette | 🚧 Planned | Ctrl+K overlay for navigation |

## Setup

```bash
npm install
node plugin_manager.js
```

Visit `http://localhost:4000`

## Security Notes

- All API endpoints require Bearer token authentication (configurable via `AUTH_TOKEN` env var)
- Dashboard password configurable via `DASHBOARD_PASSWORD` env var (default: `admin`)
- Login rate-limited to 5 attempts per minute per IP
- File write endpoints protected against path traversal
- Command execution uses `execFile` with argument arrays (no shell string interpolation)
- Web scraper blocks private/internal IP ranges (SSRF protection)
- API key sent to Google via `x-goog-api-key` header (not URL query parameter)
- All user data escaped before DOM insertion (XSS protection)
- Destructive actions logged to `data/audit.json` with timestamp and source IP

## Test

```bash
# Start server first, then:
python tests/e2e_test.py
```
