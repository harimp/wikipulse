import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface FoundationStackProps extends StackProps {
  /** `owner/name` of the GitHub repository allowed to deploy. */
  githubRepo: string;
  monthlyBudgetUsd: number;
  /** Where budget alerts go. No email, no notifications. */
  budgetEmail?: string;
  /** Reuse an account's existing GitHub OIDC provider instead of creating one. */
  existingOidcProviderArn?: string;
}

/**
 * Account-level plumbing that CI cannot deploy for itself: the OIDC trust
 * for GitHub Actions, and a budget alarm.
 */
export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    const provider = props.existingOidcProviderArn
      ? iam.OidcProviderNative.fromOidcProviderArn(this, 'GitHubOidc', props.existingOidcProviderArn)
      : new iam.OidcProviderNative(this, 'GitHubOidc', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        });

    // GitHub's `sub` carries immutable IDs: repo:owner@<id>/name@<id>:<context>.
    // Matching the IDs by wildcard trusts the names, which are unique while the
    // account exists (users and orgs share one namespace).
    const [owner, name] = props.githubRepo.split('/');
    const githubPrincipal = (subject: string) =>
      new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${owner}@*/${name}@*:${subject}`,
        },
      });

    // The CDK bootstrap roles do the real work; these roles only get to assume them.
    const cdkRole = (kind: string) =>
      `arn:aws:iam::${this.account}:role/cdk-hnb659fds-${kind}-role-${this.account}-${this.region}`;

    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'wikipulse-github-deploy',
      description: 'GitHub Actions deploys from the production environment',
      assumedBy: githubPrincipal('environment:production'),
    });
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: ['deploy', 'file-publishing', 'image-publishing', 'lookup'].map(cdkRole),
      }),
    );

    const diffRole = new iam.Role(this, 'DiffRole', {
      roleName: 'wikipulse-github-diff',
      description: 'GitHub Actions read-only cdk diff on pull requests',
      assumedBy: githubPrincipal('pull_request'),
    });
    diffRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: [cdkRole('lookup')] }),
    );

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'wikipulse-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: props.budgetEmail
        ? [
            { notificationType: 'ACTUAL', threshold: 80 },
            { notificationType: 'FORECASTED', threshold: 100 },
          ].map(({ notificationType, threshold }) => ({
            notification: {
              notificationType,
              comparisonOperator: 'GREATER_THAN',
              threshold,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: props.budgetEmail! }],
          }))
        : undefined,
    });

    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new CfnOutput(this, 'DiffRoleArn', { value: diffRole.roleArn });
  }
}
