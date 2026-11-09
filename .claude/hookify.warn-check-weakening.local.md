---
name: warn-check-weakening
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: (^|/)(check|package\.json|pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|(vitest|jest|playwright)(\.[\w-]+)?\.config\.[cm]?[jt]s|\.github/workflows/[^/]+\.ya?ml)$
  - field: content
    operator: regex_match
    pattern: testPathIgnorePatterns|passWithNoTests|continue-on-error|\|\|\s*true|--no-verify|coverageThreshold|\bexclude\b|testIgnore|testMatch|grepInvert|\bgrep\s*:
---

⚠️ **This edit changes how tests or checks run.**

Make sure it does not hide, skip, or ignore failures. Explain the change and the reason in your report to the owner.
