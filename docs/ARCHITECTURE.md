# NeuroWorks / clawbot — System Architecture

_Generated 2026-06-08. Render in Obsidian, VS Code (Markdown Preview Mermaid Support), or GitHub._

## 1. System map

```mermaid
flowchart TB
  classDef ext fill:#3a2740,stroke:#a06bd6,color:#f4e9da;
  classDef store fill:#26313a,stroke:#5fa8c7,color:#e9f3f7;
  classDef core fill:#2b2438,stroke:#a06bd6,color:#f4e9da;
  classDef agent fill:#3a2b22,stroke:#d68a4b,color:#f7efe6;

  subgraph CLIENT["🖥️  Web UI — React + Vite (:7470)"]
    direction LR
    W1["Login · Users"]
    W2["Chat · Dashboard"]
    W3["Connectors · Payments · Integrations<br/>Governance · Schedules · Reports"]
  end

  CLIENT -->|"/api/* via Vite proxy<br/>Authorization: Bearer token"| GUARD

  subgraph SERVER["⚙️  clawbot server — Express (:7471)"]
    GUARD["origin-guard<br/>(loopback + Host/Origin allow-list)"]:::core
    subgraph ROUTES["REST routes"]
      direction LR
      RA["/api/auth · /api/users"]
      RC["/api/chat · /api/templates"]
      RX["/api/executor · /api/primitives"]
      RB["/api/connectors · /api/payments"]
      RG["/api/integrations · /api/governance<br/>/api/reflection · /api/schedules"]
    end
    GUARD --> ROUTES
  end

  RC --> EXEC{"Executor mode<br/>(.neuroworks/executor.json)"}:::core
  EXEC -->|clawbot| PIPE["clawbot pipeline<br/>plan → execute → synth → quality → peer-review"]:::core
  EXEC -->|hermes| HERMES["Hermes agent (CLI)<br/>persona + lane + governance injected"]:::agent
  HERMES -.->|"can't do: error / thin /<br/>fails quality.check → OFFLOAD"| PIPE
  PIPE --> POOL["worker pool<br/>persona-shifter (:7473 / :7474)"]:::core

  HERMES -.->|"MCP (stdio)"| MCP["clawbot-mcp.mjs<br/>bridge"]:::agent
  MCP -->|"/api/primitives/call (allowlist)"| TOOLS

  subgraph TOOLS["🧰  Primitives (agent tools)"]
    direction LR
    TV["vault.*"]
    TC["connector.*"]
    TP["payment.*"]
    TU["users.* · org.*"]
    TI["integration.*"]
    TW["web.*"]
    TM["media.*"]
  end
  PIPE --> TOOLS
  POOL --> TOOLS

  PIPE --> LLM{"LLM router"}:::core
  HERMES --> ORX
  LLM --> OLLAMA["Ollama (local GPU)"]:::ext
  LLM --> ORX["OpenRouter (cloud / free)"]:::ext
  LLM --> MMX["MiniMax (LLM + media)"]:::ext

  subgraph DATA["🗄️  Local state — .neuroworks/ (encrypted secrets via secret-box)"]
    direction LR
    DU["users · sessions · login-events"]:::store
    DC["connectors.json"]:::store
    DI["integrations.json"]:::store
    DJ["jobs journal → Reports"]:::store
    DE["executor.json"]:::store
  end

  subgraph VAULTFS["📓  Obsidian vault — D:/Main brain (git: main-brain)"]
    direction LR
    VG["_governance<br/>policies · people · API blueprint"]:::store
    VR["_neuroworks/reflections + progress"]:::store
    VN["notes / second brain"]:::store
  end

  ROUTES --- DATA
  TU --- DU
  TV --- VAULTFS
  RA --- DU

  TC -->|Bearer, read-only, SSRF-guarded| AIIA["AIIA finance system"]:::ext
  TP -->|REST + signed webhook| STRIPE["Stripe"]:::ext
  TI --> SAAS["Slack · Notion · Jira · …"]:::ext
  EMAIL["Mailjet API / IMAP+SMTP"]:::ext --- RG
  PIPE --- GH["GitHub (vault sync, repos)"]:::ext
```

## 2. Task execution flow (executor + offload + MCP)

```mermaid
sequenceDiagram
  autonumber
  participant U as User (Web)
  participant API as clawbot /api/chat
  participant EX as Executor (executor.json)
  participant H as Hermes
  participant MCP as MCP bridge
  participant CB as clawbot pipeline
  participant T as Tools (vault / AIIA / web …)
  participant J as Jobs journal

  U->>API: task (+ Bearer token → attributed to user)
  API->>EX: which executor?
  alt mode = hermes (primary)
    EX->>H: run task + persona/governance preamble
    H->>MCP: tool call (e.g. connector.call → AIIA)
    MCP->>T: /api/primitives/call (allowlisted)
    T-->>H: live result
    H-->>API: answer
    API->>API: quality.check (time-bounded, fail-safe)
    opt error / thin / quality fail
      API->>CB: OFFLOAD ("whatever Hermes can't do")
      CB->>T: plan → execute (full tool access)
      CB-->>API: answer
    end
  else mode = clawbot
    EX->>CB: plan → execute → synth → QA → peer-review
    CB->>T: tools (incl. worker pool fan-out)
    CB-->>API: answer
  end
  API->>J: persist job (survives reload → Reports)
  API-->>U: result
```

## 3. Identity / auth layer

```mermaid
flowchart LR
  classDef store fill:#26313a,stroke:#5fa8c7,color:#e9f3f7;
  L["Login page"] -->|"POST /api/auth/login<br/>email + password"| A["auth route"]
  A -->|scrypt verify / claim-on-first-login| US["users.json<br/>(scrypt hashes)"]:::store
  A -->|issue bearer token| SE["sessions.json"]:::store
  A -->|record| EV["login-events.json<br/>(audit)"]:::store
  US -. "directory (no secrets)" .-> AG["agent: users.list / users.lookup<br/>(also via MCP → Hermes)"]
  note["Identity layer, NOT a hard gate.<br/>origin-guard is the real network boundary (loopback)."]
```

## Notes

- **Executor is a live runtime switch** (`POST /api/executor`) — no restart. Hermes is primary now, with automatic offload to clawbot on failure / thin answer / failed quality gate.
- **MCP bridge** lets Hermes call clawbot's own tools (16-tool allowlist: vault, connectors → AIIA, integrations, web reads, users directory, payment status). Money-moving (`payment.link`) and writes are excluded.
- **Secrets** (connector tokens, integration creds, user passwords) are encrypted/hashed at rest under `.neuroworks/` (AES-256-GCM via secret-box; scrypt for passwords).
- **Two git repos:** the clawbot code repo and the `main-brain` vault repo (auto-committed by the commit queue).
```
