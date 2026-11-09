---
name: block-risky-commands
enabled: true
event: bash
action: block
pattern: \brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(/|~|\$HOME|\.\.|\*)(\s|/|$)|\bdd\s+if=|\bmkfs\b|\bgit\s+push\b[^|;&]*(--force\b|\s-f\b)|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f|\bchmod\s+-R\s+777\b|\bcurl\b[^|]*\|\s*(ba|z)?sh\b
---

⛔ **Blocked: this command can destroy work or history, or run untrusted code.**

Use a safer, reversible approach that stays inside the project folder. If no safe approach exists, explain the action, its risk, and the recovery path to the owner, and ask first.
