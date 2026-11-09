---
name: block-hardcoded-keys
enabled: true
event: file
action: block
conditions:
  - field: content
    operator: regex_match
    pattern: \bsk_live_[0-9a-z]{10,}|\brk_live_[0-9a-z]{10,}|\bAKIA[0-9A-Z]{16}\b|-{5}BEGIN [A-Z ]*PRIVATE KEY|\bghp_[0-9a-z]{30,}|\bgithub_pat_[0-9a-z_]{20,}|\bxox[abprs]-[0-9a-z-]{10,}|\bsk-ant-[0-9a-z_-]{20,}|\brnd_[0-9a-z]{20,}|\bsb_secret_[0-9a-z_-]{10,}
---

⛔ **Blocked: this edit contains what looks like a real secret key.**

Never put secrets in code. Read them from environment variables, and ask the owner to add the real value in the service's dashboard or the local secrets file.
