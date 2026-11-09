# Validation record

Executed locally on 2026-11-09, Node.js v26.13.0, npm 11.20.0.

| Command | Observed result |
|---|---|
| `npm test` | 3 test files passed; 28 tests passed |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0 |
| `npm start` | Exit 0; generated a complete 120000 ms synthetic result with 220 detected compressions |
| `npm run schema` | Exit 0; generated draft-2020-12 JSON Schema |
| `npm run eval` | Exit 0; generated RESULTS.md, results.json and example-session.json |

The test suite includes real local stdio MCP initialization, tool discovery, both tool calls, invalid structural input and inconsistent result rejection. All test inputs are synthetic landmarks or summary JSON. No browser tools or real-person imagery were used. The browser video adapter was type-checked only; no browser runtime or camera/pose-estimation performance claim is made.
