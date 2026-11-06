# Windows test builds

The Windows installer workflow stamps the package version as
`<major>.<minor>.<GitHub workflow run number>` before packaging. For example,
the 65th workflow run using the 1.0 source version produces PRISM 1.0.65.
Each new workflow run increments the final number. Retrying the same run keeps
its version; start a new run to create a newer version.

The stamped version is used by Electron's About menu, the Windows executable,
and the installer filename. The installed-app smoke check verifies the
executable's product version against the stamped version.

The source package stores the major/minor baseline as 1.0.0. Change that baseline
when intentionally starting a new major/minor series. The CI patch number is
build identity, not a claim that every feature is complete or an automatic-update
service.

Download the **PRISM-Windows-Installer** artifact from a successful run of
**Build PRISM Windows installer**, extract the ZIP, and run
`PRISM Setup <version>.exe`. This installs the test build; it does not merge the
feature branch into main.

ASIO remains disabled. Native device diagnostics are not native song playback;
unfinished native-engine features are described in NATIVE-AUDIO.md.
