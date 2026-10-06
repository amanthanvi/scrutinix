/**
 * Path-tenanted platforms: one hostname serves content from many unrelated
 * users, so a feed listing of one URL there says nothing about another, and
 * a "this host has N malware URLs" count is just the platform's size. On
 * these hosts only exact-URL evidence scores; host-level listings are kept
 * as observations.
 *
 * Subdomain-tenanted platforms (github.io, web.app, pages.dev) do not belong
 * here: the PSL's private suffixes already give each tenant its own
 * registrable domain.
 */
const SHARED_PLATFORM_HOSTS = new Set([
  // Code hosting and release downloads
  "github.com",
  "gist.github.com",
  "codeload.github.com",
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "user-images.githubusercontent.com",
  "gitlab.com",
  "bitbucket.org",
  // Documents and file sharing
  "docs.google.com",
  "drive.google.com",
  "drive.usercontent.google.com",
  "sites.google.com",
  "storage.googleapis.com",
  "firebasestorage.googleapis.com",
  "s3.amazonaws.com",
  "dropbox.com",
  "dl.dropboxusercontent.com",
  "onedrive.live.com",
  "1drv.ms",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "mediafire.com",
  "pastebin.com",
  "archive.org",
  // Link shorteners: every path is a different owner's link
  "bit.ly",
  "tinyurl.com",
  "t.co",
]);

export function isSharedPlatformHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  return SHARED_PLATFORM_HOSTS.has(host);
}
