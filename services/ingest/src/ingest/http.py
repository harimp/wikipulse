import os
import urllib.request

USER_AGENT = os.environ.get("USER_AGENT", "wikipulse-ingest/0.1")


def open_url(url: str, method: str = "GET", timeout: float = 60):
    request = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(request, timeout=timeout)
