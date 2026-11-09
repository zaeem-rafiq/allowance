---
name: block-test-skipping
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: (\.(test|spec)\.[cm]?[jt]sx?$)|(_test\.py$)|((^|/)test_[^/]*\.py$)|(/(tests?|__tests__|e2e)/)
  - field: content
    operator: regex_match
    pattern: \b(it|test|describe|suite)\.(skip|only|todo|fixme|fail|fails|failing|skipIf|runIf)\b|\bx(it|test|describe)\s*\(|@pytest\.mark\.(skip|skipif|xfail)|\bpytest\.skip\(|\bunittest\.skip
---

⛔ **Blocked: this edit skips, disables, or narrows a test.**

The owner's rules forbid weakening or disabling tests to get a pass.
- If the test expects the wrong behavior, work out the intended behavior from the requirements or the owner, correct the test, and explain the change in your report.
- If the intended behavior is unclear, treat it as a product decision and ask the owner.
