---
name: block-test-deletion
enabled: true
event: bash
action: block
pattern: \b(rm|git\s+rm|unlink|trash)\b[^|;&]*((\.(test|spec)\.[cm]?[jt]sx?)|(_test\.py)|(test_[^/\s]*\.py)|((^|[\s/])(tests?|__tests__|e2e)(/|\s|$)))
---

⛔ **Blocked: this command deletes tests.**

Deleting tests removes the owner's protection against broken features.
- If a test is obsolete, explain why to the owner in plain language and ask before removing it.
- Never delete a test to get a pass.
