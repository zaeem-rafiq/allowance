---
name: block-risky-commands
enabled: true
event: bash
action: block
pattern: (?:(?<![\w-])(?<!git\s)rm\b|\bgit\s+rm\b(?!(?:[^|;&\n]|\\\n)*(?:[ \t]|\\\n)--cached\b))(?=(?:[^|;&\n]|\\\n)*(?:[ \t]|\\\n)(?:-[a-z]*r|--recursive\b))(?:[^|;&\n]|\\\n)*(?:[ \t]|\\\n)["']?(?:(?:~|\$\{?HOME\}?|\.\.|\*|/)["']?(?:/|\s|$|[;&|)])|(?:/[^/\s"']+/?|/(?:Users|home)/[^/\s"']+/?|/\*|\./?)\*?["']?(?:\s|$|[;&|)]))|\bdd\s+if=|\bmkfs\b|\bgit(?:\s+(?:-c\s+(?:"[^"]*"|'[^']*'|\S+)|--(?:git-dir|work-tree|namespace)\s+\S+|--[\w-]+(?:=\S+)?))*\s+(?:push\b(?:[^|;&\n]|\\\n)*(?:[ \t]|\\\n)(?:--force\b|-[a-z]*f[a-z]*\b|["']?\+\S)|reset\b(?:[^|;&\n]|\\\n)*(?:[ \t]|\\\n)--hard\b|clean\b(?:[^|;&\n]|\\\n)*(?:[ \t]|\\\n)(?:-[a-z]*f|--force\b))|\bchmod\s+-R\s+777\b|\bcurl\b[^|]*\|\s*(ba|z)?sh\b
---

⛔ **Blocked: this command can destroy work or history, or run untrusted code.**

Use a safer, reversible approach that stays inside the project folder. If no safe approach exists, explain the action, its risk, and the recovery path to the owner, and ask first.
