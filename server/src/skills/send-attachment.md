---
name: send-attachment
description: Attach a real file (spreadsheet, PDF, doc, image, etc.) to an outbound email instead of pasting its contents inline.
applies_to: [draft-email, draft-other]
---

# Skill: Send document as attachment

## When to use this

The user says "attach", "send the file/document/report", "email me that
spreadsheet", or otherwise wants a **document sent AS a document** — not its
content summarized or pasted into the email body. If they ALSO want a
summary ("summarize it in an email"), do both: a short summary in the body
AND the real file attached, unless they clearly only want one or the other.

The tell that this skill applies and `local-doc-summary` / `pc-doc-handling`
alone doesn't: the request implies the RECIPIENT should receive the file
itself (open it, forward it, import it into their own tool) — not just read
your description of it.

## Process

1. **Locate the file.** `fs.find_in` with the name/folder the user gave (or
   the general search if they just said "that file"). Take the newest/best
   match's absolute path from `matches[0].path` — do not guess a path.
2. **Do not paste the file's raw content into the email body as a
   substitute for attaching it.** A CSV/XLSX dump pasted inline is illegible
   and looks broken in an inbox — that's the exact mistake this skill exists
   to prevent. If a text summary is also wanted, write a short PROSE summary
   (see `email-writing`) and attach the file separately.
3. **Resolve the recipient's real address** — `users.lookup` if the user
   named a person/role rather than a literal address (see `email-writing`'s
   recipient rule; never invent an address).
4. **Send with `email.send`**, passing the file's absolute path in
   `attach_paths`:
   ```
   email.send({
     to: "<resolved address>",
     subject: "<short, specific subject naming the document>",
     body: "<1-3 sentence prose intro — what the file is, what's notable>",
     attach_paths: "$step_N.matches.0.path"
   })
   ```
   Multiple files: comma-separate the paths or pass a JSON array.
5. **Confirm from the result**, not from your own assumption. `email.send`
   returns `{ ok, transport, attachments: [{ filename, bytes }] }` when
   attachments went out. If `attachments` is missing or empty, the file did
   NOT actually attach — say so, don't claim delivery.

## Limits (fail loud, don't silently drop)

- **10MB total** across all attachments (Mailjet's practical cap after
  base64 inflation). Over that, `email.send` throws — tell the user the file
  is too large to email and suggest sharing a vault link or a shorter export
  instead of silently sending without it.
- **The file must exist at the resolved path.** A missing file throws rather
  than sending an empty attachment — if that happens, re-run `fs.find_in` to
  confirm you have the right path.
- Supported types are attached as-is (PDF, XLSX/XLS, DOCX/DOC, PPTX, CSV,
  images, ZIP, etc.) — no conversion happens; you're sending the original
  bytes.

## Pitfalls

- **Inlining spreadsheet CSV/rows into the email body.** This looks like raw
  data soup to the recipient and is the #1 failure mode this skill fixes —
  always prefer `attach_paths` over pasting tabular content.
- Fabricating a path instead of using `fs.find_in`'s actual match — a
  guessed path throws "attachment not found" and fails the whole send.
- Claiming "I've attached the document" when the `email.send` result shows
  no `attachments` array — always check the result before saying so.
- Treating `attach_paths` as optional decoration when the user's core ask
  WAS the attachment — if the file didn't attach, the task failed, even if
  the email itself sent.
