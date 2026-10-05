#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack';
import { WikipulseStage } from '../lib/wikipulse-stage';

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: app.node.getContext('region') as string,
};

// Deployed once by hand: the GitHub deploy roles and the budget.
new FoundationStack(app, 'Wikipulse-Foundation', {
  env,
  githubRepo: app.node.getContext('githubRepo') as string,
  githubIds: app.node.getContext('githubIds') as { owner: number; repo: number },
  monthlyBudgetUsd: Number(app.node.getContext('monthlyBudgetUsd')),
  budgetEmail: app.node.tryGetContext('budgetEmail') as string | undefined,
});

// Everything else, deployed by GitHub Actions (`cdk deploy 'Prod/*'`).
new WikipulseStage(app, 'Prod', { env });

Tags.of(app).add('project', 'wikipulse');
