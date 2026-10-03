import { test } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { FoundationStack } from '../lib/foundation-stack';
import { WikipulseStage } from '../lib/wikipulse-stage';

const env = { account: '123456789012', region: 'us-east-1' };
const context = { githubRepo: 'octo/wikipulse' };

test('ingest workflow copies files two at a time', () => {
  const stage = new WikipulseStage(new App({ context }), 'Test', { env });
  const template = Template.fromStack(stage.node.findChild('Ingest') as never);

  template.resourceCountIs('AWS::Lambda::Function', 2);
  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'ingest.download.handler',
    Timeout: 900,
  });
  template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
    DefinitionString: Match.objectLike({
      'Fn::Join': Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp('"MaxConcurrency":2')])]),
    }),
  });
});

test('lake bucket is private and retained', () => {
  const stage = new WikipulseStage(new App({ context }), 'Test', { env });
  const template = Template.fromStack(stage.node.findChild('DataLake') as never);

  template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true }),
  });
});

test('deploy role trusts only the production environment', () => {
  const stack = new FoundationStack(new App(), 'Foundation', {
    env,
    githubRepo: 'octo/wikipulse',
    monthlyBudgetUsd: 5,
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'wikipulse-github-deploy',
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: [
        Match.objectLike({
          Condition: Match.objectLike({
            StringLike: {
              'token.actions.githubusercontent.com:sub': 'repo:octo@*/wikipulse@*:environment:production',
            },
          }),
        }),
      ],
    }),
  });
});
