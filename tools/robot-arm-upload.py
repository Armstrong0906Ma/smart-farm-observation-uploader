#!/usr/bin/env python3
"""Upload a robot-arm observation to the modeling pipeline."""

import argparse
import hashlib
import mimetypes
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urljoin

import requests


MAX_IMAGE_BYTES = 15 * 1024 * 1024


def _validate_image(path, label):
    if not os.path.isfile(path):
        raise FileNotFoundError('{} image does not exist: {}'.format(label, path))
    size = os.path.getsize(path)
    if size == 0:
        raise ValueError('{} image is empty: {}'.format(label, path))
    if size > MAX_IMAGE_BYTES:
        raise ValueError('{} image ({:.1f} MB) exceeds 15 MB'.format(
            label, size / (1024 * 1024)))
    mime_type = mimetypes.guess_type(path)[0]
    if not mime_type or not mime_type.startswith('image/'):
        raise ValueError('{} file type is not a supported image: {}'.format(label, path))
    return mime_type


def build_submission_key(plant_id, observed_at, front_path, right_path):
    """Return a stable key so retrying the same capture cannot create a second job."""
    digest = hashlib.sha256()
    digest.update(plant_id.encode('utf-8'))
    digest.update(b'\0')
    digest.update(observed_at.encode('ascii'))
    for path in (front_path, right_path):
        digest.update(b'\0')
        with open(path, 'rb') as image:
            for chunk in iter(lambda: image.read(1024 * 1024), b''):
                digest.update(chunk)
    return 'robot-{}'.format(digest.hexdigest())


def vertical_scan_upload_paths(composites, captures=None):
    """Map scan positions, falling back to each side's middle capture."""
    captures = captures or {}
    return {
        'front_path': composites.get('pos1') or captures['pos1_mid'],
        'right_path': composites.get('pos2') or captures['pos2_mid'],
    }


def upload_observation(service_url, internal_token, plant_id, front_path,
                       right_path, observed_at=None, timeout=120):
    """Submit front and right images and return the modeling-jobs response."""
    if observed_at is None:
        observed_at = datetime.now(timezone.utc).isoformat(timespec='seconds')

    front_mime = _validate_image(front_path, 'front')
    right_mime = _validate_image(right_path, 'right')
    submission_key = build_submission_key(
        plant_id, observed_at, front_path, right_path)
    url = urljoin(service_url.rstrip('/') + '/', 'api/modeling-jobs')

    with open(front_path, 'rb') as front, open(right_path, 'rb') as right:
        try:
            response = requests.post(
                url,
                headers={'X-Internal-Task-Token': internal_token},
                data={
                    'plantId': plant_id,
                    'observedAt': observed_at,
                    'submissionKey': submission_key,
                },
                files={
                    'front': (os.path.basename(front_path), front, front_mime),
                    'right': (os.path.basename(right_path), right, right_mime),
                },
                timeout=timeout,
            )
        except requests.RequestException as error:
            raise RuntimeError('modeling upload request failed: {}'.format(error)) from error

    if not response.ok:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text
        raise RuntimeError('modeling upload returned HTTP {}: {}'.format(
            response.status_code, detail))

    try:
        result = response.json()
    except ValueError as error:
        raise RuntimeError('modeling upload returned invalid JSON') from error
    if not result.get('job', {}).get('id'):
        raise RuntimeError('modeling upload response is missing job.id')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Upload robot-arm front/right images to the modeling pipeline')
    parser.add_argument('--plant-id', required=True)
    parser.add_argument(
        '--front', required=True,
        help='Front composite (vertical scan pos1)')
    parser.add_argument(
        '--right', required=True,
        help='Right composite (vertical scan pos2)')
    parser.add_argument('--observed-at', default=None, help='ISO 8601 timestamp')
    parser.add_argument(
        '--service-url', default=None,
        help='Cloud Run URL (default: SERVICE_URL)')
    parser.add_argument('--timeout', type=int, default=120)
    args = parser.parse_args(argv)

    service_url = args.service_url or os.environ.get('SERVICE_URL')
    internal_token = os.environ.get('INTERNAL_TASK_TOKEN')
    if not service_url:
        parser.error('SERVICE_URL is required')
    if not internal_token:
        parser.error('INTERNAL_TASK_TOKEN is required')

    try:
        result = upload_observation(
            service_url=service_url,
            internal_token=internal_token,
            plant_id=args.plant_id,
            front_path=args.front,
            right_path=args.right,
            observed_at=args.observed_at,
            timeout=args.timeout,
        )
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, 'Upload failed: {}\n'.format(error))

    job = result['job']
    state = 'replayed' if result.get('replayed') else 'accepted'
    print('{}: job={} status={} plant={} observedAt={}'.format(
        state, job['id'], job.get('status'), job.get('plantId'),
        job.get('observedAt')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
