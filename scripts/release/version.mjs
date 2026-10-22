const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

export function parseTag(tag) {
  if (typeof tag !== 'string') {
    return null;
  }
  const match = TAG_PATTERN.exec(tag);
  if (match === null) {
    return null;
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  return { major, minor, patch };
}

export function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function nextVersion({ tags, milestoneMinor }) {
  if (!Number.isInteger(milestoneMinor) || milestoneMinor < 1) {
    throw new Error(`milestoneMinor must be a positive integer, got ${String(milestoneMinor)}`);
  }
  if (!Array.isArray(tags)) {
    throw new Error('tags must be an array of tag names');
  }

  let latest = null;
  for (const tag of tags) {
    const parsed = parseTag(tag);
    if (parsed === null || parsed.major !== 0) {
      continue;
    }
    if (latest === null || compareVersions(parsed, latest.parsed) > 0) {
      latest = { tag, parsed };
    }
  }

  if (latest === null || latest.parsed.minor < milestoneMinor) {
    const version = `0.${milestoneMinor}.0`;
    return { version, tag: `v${version}`, previousTag: latest === null ? null : latest.tag };
  }
  if (latest.parsed.minor > milestoneMinor) {
    throw new Error(
      `milestone minor ${milestoneMinor} is behind latest tag ${latest.tag} (minor ${latest.parsed.minor})`,
    );
  }
  const version = `0.${milestoneMinor}.${latest.parsed.patch + 1}`;
  return { version, tag: `v${version}`, previousTag: latest.tag };
}
