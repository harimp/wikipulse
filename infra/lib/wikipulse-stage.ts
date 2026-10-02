import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DataLakeStack } from './data-lake-stack';
import { IngestStack } from './ingest-stack';

/** The application: one stack per pipeline step, stateful storage kept separate. */
export class WikipulseStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    const lake = new DataLakeStack(this, 'DataLake');
    new IngestStack(this, 'Ingest', { bucket: lake.bucket });
  }
}
