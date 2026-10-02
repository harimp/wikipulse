import pytest

from ingest import discover

INDEX = """<html><body><pre><a href="../">../</a>
<a href="2026-07/">2026-07/</a>          06-Aug-2026 05:49                   -
<a href="2026-08/">2026-08/</a>          02-Sep-2026 21:10                   -
<a href="readme.html">readme.html</a>          29-Jan-2024 17:47                8290
</pre></body></html>"""


def listing(months, snapshot="2026-08"):
    rows = [
        f'<a href="{snapshot}.enwiki.{m}.tsv.bz2">{snapshot}.enwiki.{m}.tsv.bz2</a>'
        f"                     02-Sep-2026 19:07           {500_000_000 + i}"
        for i, m in enumerate(months)
    ]
    return '<pre><a href="../">../</a>\n' + "\n".join(rows) + "\n</pre>"


YEAR_2025 = [f"2025-{m:02d}" for m in range(1, 13)]


def test_latest_snapshot_picks_newest_folder():
    assert discover.latest_snapshot(INDEX) == "2026-08"


def test_year_files_keeps_only_requested_year():
    html = listing(["2024-12", *YEAR_2025, "2026-01"])
    files = discover.year_files(html, "2026-08", "enwiki", "2025")
    assert [name for name, _ in files] == [f"2026-08.enwiki.{m}.tsv.bz2" for m in YEAR_2025]
    assert files[0][1] == 500_000_001


def test_handler_builds_keys_under_snapshot_partition(monkeypatch):
    pages = {discover.BASE_URL: INDEX, f"{discover.BASE_URL}2026-08/enwiki/": listing(YEAR_2025)}
    monkeypatch.setattr(discover, "_get", pages.__getitem__)

    result = discover.handler({}, None)

    assert result["snapshot"] == "2026-08"
    assert len(result["files"]) == 12
    assert result["files"][0]["key"] == (
        "raw/mediawiki_history/snapshot=2026-08/wiki=enwiki/2026-08.enwiki.2025-01.tsv.bz2"
    )


def test_handler_refuses_partial_snapshot(monkeypatch):
    pages = {f"{discover.BASE_URL}2026-08/enwiki/": listing(YEAR_2025[:7])}
    monkeypatch.setattr(discover, "_get", pages.__getitem__)

    with pytest.raises(discover.SnapshotIncomplete):
        discover.handler({"snapshot": "2026-08"}, None)
