# Agent access to sensitive files

All agents working in this repository must follow these rules, including when planning or implementing authentication.

- Never open, read, search within, print, copy, summarize, or transmit the contents of `.env`, `.env.*`, `*.env`, `.envrc`, `.npmrc`, private keys, credential files, database exports, browser storage states, or any other file that may contain secrets or personal data. Do not send such contents to another agent, CLI reviewer, external service, or chat.
- Do not inspect a sensitive file merely to determine whether it contains a real secret. Its filename or location is enough to treat it as sensitive.
- Filename listings, existence checks, and Git ignore/tracking checks are allowed if they reveal no values. Prefer reading source code that names required environment variables over opening environment files.
- Do not ask the user to paste passwords, connection strings, private keys, JWT signing keys, recovery codes, or tokens into chat. The user must place production values through a private environment or secret manager.
- If an operation genuinely requires accessing a sensitive file's contents, stop that operation and ask for a safer workflow. A task to build authentication or migrate configuration does not itself grant permission to read credentials.
- Ignore rules prevent future additions; they do not remove a secret from Git history. If a real secret was ever committed, advise rotation and a separate history cleanup without exposing the value.
