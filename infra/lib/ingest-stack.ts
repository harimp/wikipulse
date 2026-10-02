import * as path from 'node:path';
import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface IngestStackProps extends StackProps {
  bucket: s3.IBucket;
}

const RAW_PREFIX = 'raw/mediawiki_history';
const SOURCE_DIR = path.join(__dirname, '..', '..', 'services', 'ingest', 'src');

/**
 * Wikimedia dumps -> S3 raw. A Step Functions workflow finds the latest
 * snapshot, lists the year's monthly files, and copies each one with its
 * own Lambda, two at a time.
 */
export class IngestStack extends Stack {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: IngestStackProps) {
    super(scope, id, props);

    const code = lambda.Code.fromAsset(SOURCE_DIR, { exclude: ['**/__pycache__'] });
    const fn = (name: string, handler: string, timeout: Duration, memorySize: number) =>
      new lambda.Function(this, name, {
        runtime: lambda.Runtime.PYTHON_3_14,
        architecture: lambda.Architecture.ARM_64,
        code,
        handler,
        timeout,
        memorySize,
        environment: {
          BUCKET: props.bucket.bucketName,
          RAW_PREFIX,
          // Wikimedia asks automated clients for a descriptive User-Agent.
          USER_AGENT: `wikipulse-ingest/0.1 (https://github.com/${this.node.getContext('githubRepo')})`,
        },
        logGroup: new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_MONTH }),
      });

    const discover = fn('Discover', 'ingest.discover.handler', Duration.seconds(30), 256);
    // ~680 MB at the measured ~5 MB/s is a few minutes; 15 min is the ceiling.
    const download = fn('Download', 'ingest.download.handler', Duration.minutes(15), 512);
    props.bucket.grantReadWrite(download, `${RAW_PREFIX}/*`);

    const discoverTask = new tasks.LambdaInvoke(this, 'FindSnapshotFiles', {
      lambdaFunction: discover,
      payloadResponseOnly: true,
    });

    const downloadTask = new tasks.LambdaInvoke(this, 'CopyFileToS3', {
      lambdaFunction: download,
      payloadResponseOnly: true,
      retryOnServiceExceptions: true,
    }).addRetry({
      errors: ['States.ALL'],
      interval: Duration.minutes(1),
      backoffRate: 2,
      maxAttempts: 3,
    });

    const copyAll = new sfn.Map(this, 'CopyEachFile', {
      itemsPath: '$.files',
      maxConcurrency: 2, // be polite to the dump servers
      resultPath: '$.results',
    }).itemProcessor(downloadTask);

    this.stateMachine = new sfn.StateMachine(this, 'IngestWorkflow', {
      stateMachineName: 'wikipulse-ingest',
      definitionBody: sfn.DefinitionBody.fromChainable(discoverTask.next(copyAll)),
      timeout: Duration.hours(3),
    });

    // Monthly refresh, off until the backfill is proven. Snapshots land in the
    // first week of the month; files already copied are skipped.
    new events.Rule(this, 'MonthlySchedule', {
      enabled: false,
      schedule: events.Schedule.cron({ day: '10', hour: '6', minute: '0' }),
      targets: [new targets.SfnStateMachine(this.stateMachine)],
    });

    new CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
  }
}
