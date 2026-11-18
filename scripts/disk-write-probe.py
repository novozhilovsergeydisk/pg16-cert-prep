#!/usr/bin/env python3
"""Bounded, temporary disk write probe; no database or application data used."""
import argparse
import collections
import datetime
import json
import os
import signal
import tempfile
import threading
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds', type=int, default=600)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 1200:
        parser.error('--seconds must be between 1 and 1200')
    stop = threading.Event()
    sync = getattr(os, 'fdatasync', os.fsync)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    started = time.monotonic()
    deadline = started + args.seconds
    samples = collections.deque(maxlen=2400)
    count = 0
    slow = 0
    max_ms = 0.0
    last_start = None

    def emit(kind):
        values = sorted(samples)
        print(json.dumps({
            'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'kind': kind, 'elapsed_s': round(time.monotonic() - started, 1),
            'writes': count, 'file_limit_bytes': 1048576,
            'writes_over_1s': slow, 'max_ms': round(max_ms, 2),
            'p50_ms': round(values[len(values) // 2], 2) if values else None,
            'p95_ms': round(values[min(len(values)-1, int(len(values)*.95))], 2) if values else None,
            'current_write_age_s': round(time.monotonic()-last_start, 1) if last_start else 0,
        }), flush=True)

    def heartbeat():
        while not stop.wait(30):
            emit('progress')
            if time.monotonic() >= deadline:
                stop.set()

    fd, path = tempfile.mkstemp(prefix='pg16-disk-probe-', dir='/var/tmp')
    try:
        os.ftruncate(fd, 1048576)
        emit('start')
        worker = threading.Thread(target=heartbeat, daemon=True)
        worker.start()
        block = bytes(4096)
        while time.monotonic() < deadline and not stop.is_set():
            last_start = time.monotonic()
            os.lseek(fd, (count % 256) * 4096, os.SEEK_SET)
            os.write(fd, block)
            sync(fd)
            ms = (time.monotonic() - last_start) * 1000
            last_start = None
            count += 1
            samples.append(ms)
            max_ms = max(max_ms, ms)
            slow += ms >= 1000
            if ms >= 1000:
                emit('slow_write')
            stop.wait(min(.25, max(0, deadline-time.monotonic())))
    finally:
        stop.set()
        os.close(fd)
        os.unlink(path)
        emit('finished_file_removed')


if __name__ == '__main__':
    main()
