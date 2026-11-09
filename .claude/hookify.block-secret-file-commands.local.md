---
name: block-secret-file-commands
enabled: true
event: bash
action: block
pattern: (^|[\s<>|;&'"=/])\.env(?!(?:\.[\w-]+)*\.(?:example|sample|template)\.?(?:$|[\s'";|&)>]))(?:[._-][\w*?\[][\w.*?\[\]-]*|[*?\[][\w.*?\[\]-]*)?(?:$|[\s'";|&)>])
---

⛔ **Blocked: this command touches a secrets file (.env).**

The owner puts secrets in place themselves. Never read, print, copy, move, or edit secrets files.
To record which settings a project needs, edit `.env.example` with placeholder values only.
