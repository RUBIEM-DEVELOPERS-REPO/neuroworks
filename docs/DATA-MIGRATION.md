# NeuroWorks / clawbot — Data Migration & Movement

_Generated 2026-06-09. Render in Obsidian, VS Code (Markdown Preview Mermaid Support), or GitHub._

How data moves, persists, and migrates across the system: at-rest encryption migration, job-state recovery, vault git sync, and moving the whole workspace to a new machine.

## 1. At-rest secret migration (legacy plaintext → encrypted)

Applies to `data-sources.json` (DB connection strings) and `connectors.json` (auth tokens) — both use the shared `secret-box` (AES-256-GCM). Legacy plaintext records are migrated transparently on the next write; no manual step.

```mermaid
flowchart TB
  classDef store fill:#26313a,stroke:#5fa8c7,color:#e9f3f7;
  classDef proc fill:#2b2438,stroke:#a06bd6,color:#f4e9da;

  KEY["🔑 secret key<br/>CLAWBOT_SECRET_KEY (env)<br/>else .neuroworks/.secret-key (mode 0600)"]:::store

  subgraph LOAD["load() — read from disk"]
    F["records on disk"]:::store --> CHK{"isEncrypted()?<br/>value starts with v1:"}
    CHK -->|yes| DEC["decryptSecret()<br/>AES-256-GCM"]:::proc
    CHK -->|"no — legacy plaintext"| MARK["flag sawPlaintext"]:::proc
    DEC --> RT["runtime objects<br/>(decrypted)"]:::proc
    MARK --> RT
  end

  RT -->|"if sawPlaintext → save()"| MIG["one-time transparent re-encrypt"]:::proc

  subgraph SAVE["save() — write to disk"]
    OBJ["runtime object"]:::proc --> Q{"already v1: ?"}
    Q -->|no| ENC["encryptSecret()<br/>→ v1:iv:tag:ciphertext"]:::proc
    Q -->|yes| KEEP["keep as-is"]:::proc
    ENC --> DISK["encrypted on disk"]:::store
    KEEP --> DISK
  end

  MIG --> SAVE
  KEY -. used by .-> DEC
  KEY -. used by .-> ENC
```

> User passwords (`users.json`) use a one-way **scrypt** hash (not the reversible box) — they're never decrypted, only verified.

## 2. Job-state persistence & recovery (Reports survive reloads)

```mermaid
flowchart LR
  classDef store fill:#26313a,stroke:#5fa8c7,color:#e9f3f7;
  classDef proc fill:#2b2438,stroke:#a06bd6,color:#f4e9da;

  RUN["job runs"]:::proc --> MEM["in-memory Map<br/>(RECENT = 200)"]:::proc
  RUN -->|persistJobRecord| JL["JSONL journal<br/>server/.neuroworks/jobs/YYYY-MM-DD.jsonl"]:::store
  REL["server reload / restart<br/>(wipes in-memory)"]:::proc -.-> MEM

  GET["GET /api/templates/jobs"]:::proc --> MERGE{"merge"}:::proc
  MEM --> MERGE
  JL -->|"loadJobsInWindow(30d)"| MERGE
  MERGE -->|"dedup by id<br/>(in-memory wins)"| RPT["Reports / Tasks UI<br/>+ nightly reflection"]:::store
```

## 3. Vault data sync (local ⇄ main-brain git)

```mermaid
sequenceDiagram
  autonumber
  participant A as Agent / write
  participant V as Vault (D:/Main brain)
  participant Q as commit-queue (debounced)
  participant G as origin (main-brain repo)
  participant P as pull scheduler (~5 min)
  A->>V: writeVaultFile()
  V->>Q: enqueueVaultCommit()
  Q->>G: git commit + push (batched)
  P->>G: git pull (edits from other machines / Obsidian)
  G->>V: merge into local vault
  Note over V,Q: _neuroworks/ writes skip the search-index invalidation (machine-state)
```

## 4. Migrating the workspace to a new machine

```mermaid
flowchart TB
  classDef ok fill:#24332a,stroke:#5fb87a,color:#e9f7ee;
  classDef warn fill:#3a3322,stroke:#d6b84b,color:#f7f1e6;
  classDef rebuild fill:#26313a,stroke:#5fa8c7,color:#e9f3f7;

  subgraph PORT["✅ Carry these"]
    NW[".neuroworks/ (repo root)<br/>users · sessions · connectors · integrations<br/>data-sources · schedules · personas<br/>custom-templates · executor.json · login-events"]:::ok
    JOBS["server/.neuroworks/jobs/<br/>(job journal — note: cwd-relative path)"]:::ok
    ENVF[".env (GitHub/LLM/Stripe/AIIA keys, config)"]:::ok
    VLT["Obsidian vault — or just re-clone the main-brain repo"]:::ok
  end

  subgraph KEYED["⚠️ Decryption-coupled — carry together with secrets"]
    SK[".neuroworks/.secret-key<br/>REQUIRED to read connector/data-source secrets.<br/>If you use CLAWBOT_SECRET_KEY in .env, carry that instead."]:::warn
  end

  subgraph REBUILD["🔁 Rebuilt automatically — don't copy"]
    IDX["vault search index (MiniSearch)"]:::rebuild
    SESS["sessions (users just re-login)"]:::rebuild
    POOL["managed worker pool"]:::rebuild
  end

  NW --> KEYED
  NOTE["Rotating the secret key WITHOUT re-encrypting orphans existing<br/>connector/data-source secrets — they'll fail to decrypt (handled gracefully:<br/>the blob is left in place and the call errors clearly, not silently)."]:::warn
```

## Notes

- **One box, two consumers:** `secret-box.ts` (AES-256-GCM) backs both `data-sources` and `connectors`; integrations encrypt on write from the start. Passwords are scrypt (one-way).
- **Two git repos move independently:** the clawbot **code** repo and the **main-brain vault** repo. The vault auto-commits via the commit queue; code is committed manually.
- **Path quirk to remember when migrating:** the job journal lives under `server/.neuroworks/jobs/` (resolved from `process.cwd()`), while the rest of the machine state lives under the repo-root `.neuroworks/`. Carry **both** locations.
- **Safe-by-default migration:** plaintext→encrypted is transparent on next write; a wrong/rotated key leaves the blob untouched and surfaces a clear error rather than corrupting data.
```
