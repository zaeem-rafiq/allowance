---
name: block-secret-file-edits
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: (^|/)\.env(?!(?:\.[\w-]+)*\.(?:example|sample|template)$)(?:[._-][\w.-]*)?$
---

⛔ **Blocked: this edit changes a secrets file (.env).**

The owner puts secrets in place themselves. Edit `.env.example` with placeholder values instead, and tell the owner which values they need to add.
