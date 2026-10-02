"""Find a MediaWiki history snapshot and list one year's monthly files for a wiki."""

import os
import re

from ingest.http import open_url

BASE_URL = os.environ.get("DUMPS_BASE_URL", "https://dumps.wikimedia.org/other/mediawiki_history/")
RAW_PREFIX = os.environ.get("RAW_PREFIX", "raw/mediawiki_history")

_SNAPSHOT_LINK = re.compile(r'href="(\d{4}-\d{2})/"')
# nginx autoindex row: <a href="NAME">NAME</a>   02-Sep-2026 19:07   675828265
_FILE_ROW = re.compile(r'href="([^"/]+)">[^<]*</a>\s+\S+\s+\S+\s+(\d+)')


class SnapshotIncomplete(Exception):
    """The snapshot folder exists but not every month has been published yet."""


def handler(event, _context):
    wiki = event.get("wiki", "enwiki")
    year = event.get("year", "2025")
    snapshot = event.get("snapshot") or latest_snapshot(_get(BASE_URL))

    files = year_files(_get(f"{BASE_URL}{snapshot}/{wiki}/"), snapshot, wiki, year)
    if len(files) != 12:
        raise SnapshotIncomplete(f"{snapshot}/{wiki}: {len(files)} of 12 files for {year}")

    return {
        "snapshot": snapshot,
        "wiki": wiki,
        "year": year,
        "files": [
            {
                "url": f"{BASE_URL}{snapshot}/{wiki}/{name}",
                "key": f"{RAW_PREFIX}/snapshot={snapshot}/wiki={wiki}/{name}",
                "size": size,
            }
            for name, size in files
        ],
    }


def latest_snapshot(index_html: str) -> str:
    snapshots = _SNAPSHOT_LINK.findall(index_html)
    if not snapshots:
        raise ValueError("no snapshot folders in the dump index")
    return max(snapshots)


def year_files(listing_html: str, snapshot: str, wiki: str, year: str) -> list[tuple[str, int]]:
    """(file name, size in bytes) for `<snapshot>.<wiki>.<year>-MM.tsv.bz2`, by month."""
    wanted = re.compile(rf"{re.escape(snapshot)}\.{re.escape(wiki)}\.{year}-\d{{2}}\.tsv\.bz2")
    rows = _FILE_ROW.findall(listing_html)
    return sorted((name, int(size)) for name, size in rows if wanted.fullmatch(name))


def _get(url: str) -> str:
    with open_url(url, timeout=30) as response:
        return response.read().decode()
