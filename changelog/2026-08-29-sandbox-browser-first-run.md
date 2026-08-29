# Skip Chromium's first-run screen in sandbox browsing

Agents using sandbox browsing could land on Chromium's first-run sign-in screen because the
shared launch arguments omitted `--no-first-run`.

The flag now belongs to the browser sandbox's shared arguments, covering both visible and
headless launches. The graphical desktop launcher already had the flag, so it was left unchanged.
