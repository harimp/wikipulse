"""Stream one dump file from Wikimedia into S3 as a multipart upload, never touching disk."""

import functools
import os

from ingest.http import open_url

BUCKET = os.environ.get("BUCKET", "")
PART_SIZE = 32 * 1024 * 1024


class SizeMismatch(Exception):
    pass


def handler(event, _context):
    url, key, size = event["url"], event["key"], int(event["size"])
    s3 = _s3()

    # Idempotent: a file already copied at the same size is left alone.
    if _object_size(s3, BUCKET, key) == size:
        return {"key": key, "status": "skipped", "bytes": size}

    with open_url(url) as response:
        length = int(response.headers["Content-Length"])
        if length != size:
            raise SizeMismatch(f"{url}: listing says {size} bytes, server sends {length}")
        metadata = {
            "source-url": url,
            "source-last-modified": response.headers.get("Last-Modified", ""),
            "source-etag": response.headers.get("ETag", "").strip('"'),
        }
        written = stream_to_s3(response, s3, BUCKET, key, size, metadata)

    return {"key": key, "status": "copied", "bytes": written}


def stream_to_s3(stream, s3, bucket, key, expected_size, metadata, part_size=PART_SIZE) -> int:
    upload_id = s3.create_multipart_upload(
        Bucket=bucket, Key=key, ContentType="application/x-bzip2", Metadata=metadata
    )["UploadId"]
    try:
        parts, total = [], 0
        while chunk := _read_exactly(stream, part_size):
            number = len(parts) + 1
            etag = s3.upload_part(
                Bucket=bucket, Key=key, UploadId=upload_id, PartNumber=number, Body=chunk
            )["ETag"]
            parts.append({"PartNumber": number, "ETag": etag})
            total += len(chunk)

        if total != expected_size:
            raise SizeMismatch(f"{key}: expected {expected_size} bytes, read {total}")

        s3.complete_multipart_upload(
            Bucket=bucket, Key=key, UploadId=upload_id, MultipartUpload={"Parts": parts}
        )
        return total
    except BaseException:
        s3.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
        raise


def _read_exactly(stream, n: int) -> bytes:
    """Read n bytes, or fewer only at end of stream."""
    buffer = bytearray()
    while len(buffer) < n and (data := stream.read(n - len(buffer))):
        buffer += data
    return bytes(buffer)


def _object_size(s3, bucket, key) -> int | None:
    try:
        return s3.head_object(Bucket=bucket, Key=key)["ContentLength"]
    except s3.exceptions.ClientError as error:
        if error.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


@functools.cache
def _s3():
    import boto3  # provided by the Lambda runtime

    return boto3.client("s3")
