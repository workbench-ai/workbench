# Start Here

- Read `README.md` for the public source map.
- The installable agent skill is `skills/workbench/SKILL.md`.
- Do not add a root `SKILL.md`; `npx skills add workbench-ai/workbench` must install only the nested skill directory.
- Hosted Workbench Cloud infrastructure, hosted auth, billing, Terraform, and worker fleet code are intentionally outside this public source repository.
- Keep package names and workspace imports consistent with the existing `@workbench-ai/*` package names.
