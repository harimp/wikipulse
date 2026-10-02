import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * The lake bucket. Prefixes: `raw/` (dumps as downloaded), later the Iceberg
 * warehouse and Athena results. Retained on delete: the raw snapshot cannot
 * be downloaded again once Wikimedia rotates it out.
 */
export class DataLakeStack extends Stack {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'Lake', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        // A download Lambda killed mid-upload leaves its parts behind.
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
    });
  }
}
