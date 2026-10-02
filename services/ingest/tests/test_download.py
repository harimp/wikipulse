import io

import pytest

from ingest import download


class FakeS3:
    def __init__(self):
        self.parts, self.completed, self.aborted = [], None, False

    def create_multipart_upload(self, **_):
        return {"UploadId": "u1"}

    def upload_part(self, PartNumber, Body, **_):
        self.parts.append(Body)
        return {"ETag": f"etag-{PartNumber}"}

    def complete_multipart_upload(self, MultipartUpload, **_):
        self.completed = MultipartUpload["Parts"]

    def abort_multipart_upload(self, **_):
        self.aborted = True


class TrickleStream(io.BytesIO):
    """Returns at most 3 bytes per read, like a slow socket."""

    def read(self, n=-1):
        return super().read(min(n, 3))


def test_streams_in_fixed_size_parts():
    s3 = FakeS3()
    data = bytes(range(25))

    written = download.stream_to_s3(TrickleStream(data), s3, "b", "k", 25, {}, part_size=10)

    assert written == 25
    assert [len(p) for p in s3.parts] == [10, 10, 5]
    assert b"".join(s3.parts) == data
    assert [p["PartNumber"] for p in s3.completed] == [1, 2, 3]


def test_short_read_aborts_upload():
    s3 = FakeS3()

    with pytest.raises(download.SizeMismatch):
        download.stream_to_s3(io.BytesIO(b"x" * 15), s3, "b", "k", 25, {}, part_size=10)

    assert s3.aborted and s3.completed is None
