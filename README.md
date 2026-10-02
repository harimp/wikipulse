# wikipulse

What happened on English Wikipedia in 2025, built as a batch lakehouse on AWS. See [PLAN.md](PLAN.md).

## Layout

```
infra/                 CDK app (TypeScript)
  bin/wikipulse.ts       Wikipulse-Foundation (by hand) + Prod stage (by CI)
  lib/foundation-stack   GitHub OIDC deploy/diff roles, monthly budget
  lib/data-lake-stack    the lake bucket (retained)
  lib/ingest-stack       Step Functions: discover -> copy each file (2 at a time)
services/ingest/       Python Lambdas, stdlib + boto3 only (no bundling step)
  src/ingest/discover    latest snapshot -> the year's 12 monthly files
  src/ingest/download    stream one file into an S3 multipart upload, skip if already there
.github/workflows/
  ci.yml                 lint, test, synth (PRs, and called by deploy.yml)
  diff.yml               on PRs: posts `cdk diff` against production as a comment
  deploy.yml             on push to main: CI, then `cdk deploy 'Prod/*'`
```

## How changes ship

1. Open a PR. CI runs ruff and pytest, then `tsc`, the CDK tests and `cdk synth`. It also comments the `cdk diff` against production.
2. Merge to `main`. CI runs again, then the workflow deploys the `Prod/*` stacks through the `production` environment.

GitHub Actions never holds AWS keys. It gets short-lived credentials through OIDC. The deploy role trusts only the `production` environment. The diff role trusts only pull requests and is read-only.

## One-time setup

You need AWS credentials for the account locally, plus Node 24 and Python 3.14.

```bash
# 1. Set your repo in infra/cdk.json ("githubRepo": "owner/wikipulse"), then:
cd infra && npm ci
npx cdk bootstrap
npx cdk deploy Wikipulse-Foundation -c budgetEmail=you@example.com
#    (account already has a GitHub OIDC provider? pass its ARN as
#     existingOidcProviderArn in bin/wikipulse.ts)

# 2. In GitHub: Settings -> Environments -> create "production".
#    Settings -> Variables -> Actions, add from the stack outputs:
#      AWS_DEPLOY_ROLE_ARN, AWS_DIFF_ROLE_ARN, AWS_REGION (us-east-1)

# 3. Push to main; the Deploy workflow creates Prod-DataLake and Prod-Ingest.
```

## Running ingestion

```bash
ARN=$(aws cloudformation describe-stacks --stack-name Prod-Ingest \
  --query "Stacks[0].Outputs[?OutputKey=='StateMachineArn'].OutputValue" --output text)

aws stepfunctions start-execution --state-machine-arn "$ARN" --input '{}'
# or pin things down: --input '{"snapshot": "2026-08", "wiki": "enwiki", "year": "2025"}'
```

Files land at `s3://<lake>/raw/mediawiki_history/snapshot=<snapshot>/wiki=enwiki/`. Re-running is safe: files already copied at the right size are skipped. Discovery fails if the snapshot doesn't have all 12 months yet, so a half-published snapshot is never ingested.

## Local development

```bash
cd services/ingest && python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]' && ruff check . && pytest

cd infra && npm test && npx cdk synth
```
