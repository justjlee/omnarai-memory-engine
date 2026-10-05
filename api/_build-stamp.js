// Which build is live. scripts/deploy.sh overwrites BUILD_STAMP with "YYYY.MM.DD+<commit>"
// just before every build and restores this file afterwards, so the committed value is always
// "unstamped" and /api/health + /api/manifest report the real deploy date and commit.
// (Until 2026-10-05 this was a hand-bumped constant in info.js and sat on 2026.09.29 while
// four later deploys shipped — a visitor couldn't tell which build they were reading.)
export const BUILD_STAMP = "unstamped";
