---
name: warn-guard-edits
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: (^|/)(scripts/check-features|\.gitleaks\.toml|\.gitleaksignore)$
---

⚠️ **This edit changes a guard: the feature-map checker or the secret scan's settings.**

Any change here can let a missing proof pass or silence a key the scan would have found, so the pull request is High tier. Make sure `scripts/check-features --self-test` still passes and that no allowlist hides a real key. Explain the change and the reason in your report to the owner.
