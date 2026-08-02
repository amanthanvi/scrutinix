# Contributing to Scrutinix

Thanks for contributing. Scrutinix is a public, FOSS URL threat analyzer, so
changes should optimize for clarity, correctness, and user trust.

## Before You Start

- Read [`README.md`](./README.md) for the product overview and local setup.
- Read [`SPEC.md`](./SPEC.md) for product and architecture context.
- Check [`PLAN.md`](./PLAN.md) if your change affects scope, sequencing, or
  verification expectations.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Provider keys are optional for many changes. Keep automated tests deterministic;
do not introduce live third-party dependencies into the default test path.

## Quality Bar

Run the narrowest relevant check first, then broaden if the change warrants it.

```bash
npm run lint
npm run typecheck
npm run test:unit -- --run
npm run test:integration -- --run
npm run test:e2e -- --grep @smoke
npm run build
npm run lighthouse
```

GitHub Actions runs the full browser gates on pull requests and pushes to
`main`. Lighthouse blocks below Performance `0.90` or Accessibility `0.95`;
its Chromium executable is provisioned explicitly by the workflow.

## Contribution Rules

- Keep diffs small and reviewable.
- Preserve the public API contract unless the change explicitly targets it.
- Do not log raw URLs server-side.
- Keep provider adapters behind stable interfaces; do not leak provider-specific
  payloads into UI components.
- Update user-facing docs when commands, env vars, endpoints, or signal
  semantics change.
- Prefer tests and harness improvements over hand-wavy behavioral claims.

## Pull Requests

- Write a clear title and summary.
- Include verification steps and outcomes.
- Call out any user-visible behavior changes, provider caveats, or migration
  concerns.
- Add screenshots only when the UI materially changes.

## Security Issues

Do not open public issues for suspected vulnerabilities. Follow the process in
[`SECURITY.md`](./SECURITY.md) instead.
