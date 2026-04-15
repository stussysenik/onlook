## ADDED Requirements

### Requirement: Tauri desktop application bundle

The system SHALL ship as a Tauri 2 desktop application targeting macOS, packaged as a `.app` bundle produced by `cargo tauri build`, with a single main window that hosts the `apps/editor` Vite SPA as its primary WebView content.

#### Scenario: Launch the packaged application

- **WHEN** the user double-clicks the built `Onlook.app` bundle on macOS
- **THEN** a single Tauri window opens within 3 seconds
- **AND** the main WebView renders the `apps/editor` SPA with no visible loading placeholder after the first paint
- **AND** no browser tab, Electron chrome, or console window appears

#### Scenario: Development launch via tauri dev

- **WHEN** the developer runs `bun --filter desktop tauri dev` from the repo root
- **THEN** the same main window opens pointing at the Vite dev server for `apps/editor`
- **AND** edits to `apps/editor` source trigger HMR inside the Tauri window without requiring a restart

### Requirement: Native project folder picker

The system SHALL expose a "Open Folder…" action in the editor SPA that invokes a native macOS folder picker via the Rust core, returns the selected absolute path, and validates that the folder contains a `package.json` before proceeding.

#### Scenario: User picks a valid frontend project

- **WHEN** the user triggers "Open Folder…" and selects a directory that contains a `package.json` with a `scripts.dev` entry
- **THEN** the Rust core returns the absolute path to the SPA over IPC
- **AND** the SPA transitions to a "project loading" state for that path

#### Scenario: User picks a folder without package.json

- **WHEN** the user triggers "Open Folder…" and selects a directory that does not contain `package.json`
- **THEN** the SPA displays a visible error identifying the missing file
- **AND** no dev-server supervision, sidecar attachment, or preview webview is initiated

#### Scenario: User picks a folder with package.json but no dev script

- **WHEN** the user selects a directory whose `package.json` has no `scripts.dev` entry
- **THEN** the SPA displays a visible error naming the missing `dev` script
- **AND** the project does not enter a loading state

### Requirement: Dev-server subprocess supervision

The Rust core SHALL spawn the selected project's dev script as a child process, capture its stdout and stderr, detect the served URL via a known regex catalogue, and notify the SPA when the dev server is ready.

#### Scenario: Vite project starts successfully

- **WHEN** the Rust core spawns `bun run dev` on a Vite-based project
- **AND** the child process emits a line matching the Vite "Local: http://localhost:<port>" pattern to stdout
- **THEN** the Rust core emits a `DevServerReady` IPC event with the captured URL within 2 seconds of the stdout match
- **AND** the child process remains alive and attached to the Rust core's lifecycle

#### Scenario: Dev server never becomes ready

- **WHEN** the child process runs for more than 60 seconds without emitting a recognized URL pattern
- **THEN** the Rust core emits a `DevServerTimeout` IPC event with the captured stdout buffer
- **AND** the SPA displays the raw output to the user for diagnosis
- **AND** the Rust core terminates the child process cleanly

#### Scenario: Dev server exits unexpectedly

- **WHEN** the child process exits with a non-zero status while supervised
- **THEN** the Rust core emits a `DevServerExited` IPC event carrying the exit code and last stderr lines
- **AND** the SPA disables editing actions and shows the error
- **AND** the Rust core does not automatically respawn the process

#### Scenario: Application shutdown kills the dev server

- **WHEN** the user closes the Tauri main window
- **THEN** the Rust core sends SIGTERM to the dev-server child process before the main window unloads
- **AND** if the child process is still alive after 5 seconds, the Rust core sends SIGKILL
- **AND** no dev-server process remains running after the application exits

### Requirement: Preview webview rendering the dev server

The system SHALL render the user project's dev-server URL inside a separate Tauri child webview attached to the main window, distinct from the main WebView that hosts the editor SPA, with lifecycle tied to the dev-server supervisor.

#### Scenario: Preview attaches after dev-server ready

- **WHEN** the Rust core emits `DevServerReady` with a URL
- **THEN** a child webview is created (or navigated) to that URL
- **AND** the child webview occupies the SPA-designated preview region inside the main window
- **AND** no `<iframe>` is used to host the dev-server URL

#### Scenario: Preview reload after HMR

- **WHEN** the dev-server HMR causes the preview webview to reload its page
- **THEN** the Rust core emits a `PreviewReloaded` IPC event to the SPA with the new document identifier
- **AND** the SPA's overlay layer re-queries the currently selected element against the new DOM

#### Scenario: Switch to a different project

- **WHEN** the user opens a different project folder while one is already loaded
- **THEN** the existing dev-server child process is terminated per the shutdown scenario
- **AND** the existing sidecar session is reset
- **AND** the preview webview navigates to `about:blank` before attaching to the new dev server

### Requirement: Bun sidecar process hosting framework-engine

The Rust core SHALL spawn a Bun subprocess that runs the `framework-engine` package, communicate with it over stdin/stdout using a length-prefixed JSON protocol, and expose parse / emit / transform operations to the editor SPA via Tauri IPC commands that internally forward to the sidecar.

#### Scenario: Sidecar starts with the project

- **WHEN** a valid project folder is opened
- **THEN** the Rust core spawns exactly one sidecar process for that project
- **AND** the sidecar initializes `framework-engine` with the project root as its working directory
- **AND** the sidecar is ready to accept requests within 5 seconds of spawn

#### Scenario: Parse request round-trip

- **WHEN** the SPA invokes the Tauri command `engine_parse_file` with an absolute path inside the project
- **THEN** the Rust core forwards a `parse` request with that path to the sidecar
- **AND** the sidecar returns an `EditorDocument` IR payload over stdout
- **AND** the Rust core relays the payload back to the SPA as the command return value within 500 ms for a file under 50 KB

#### Scenario: Sidecar crash handling

- **WHEN** the sidecar process exits unexpectedly during a session
- **THEN** the Rust core emits a `SidecarCrashed` IPC event to the SPA
- **AND** the SPA disables editing actions until the user reopens the project
- **AND** the Rust core does not automatically respawn the sidecar

### Requirement: Edit write-back through the sidecar

When the user commits an edit in the editor SPA, the system SHALL route the edit through the sidecar's emit pipeline, write the resulting source file to disk via the Rust core, and suppress the corresponding file-watcher event so the round-trip does not trigger a spurious reload.

#### Scenario: Successful edit write-back

- **WHEN** the user triggers an inspector action (e.g., change text, add class, insert, move, remove)
- **THEN** the SPA sends the edit intent to the sidecar via the Rust core
- **AND** the sidecar produces an updated source string for the target file
- **AND** the Rust core writes the file to disk atomically
- **AND** the project's dev-server HMR reloads the preview webview with the new content

#### Scenario: Debounced file-watcher suppression

- **WHEN** the Rust core writes a file as a result of an edit
- **THEN** file-watcher events for that exact path are suppressed for 500 ms after the write
- **AND** the sidecar is not asked to re-parse the file it just wrote within that window

#### Scenario: Emit failure surfaces cleanly

- **WHEN** the sidecar returns an emit error for a given edit
- **THEN** the Rust core relays the error to the SPA without writing anything to disk
- **AND** the SPA displays the error message next to the attempted action

### Requirement: Runtime adapter in the editor SPA

The `apps/editor` SPA SHALL detect whether it is running inside the Tauri desktop shell and, when it is, route file IO, project loading, and preview surface operations to IPC-backed implementations rather than mocked browser fallbacks.

#### Scenario: Desktop shell detection

- **WHEN** the SPA boots inside the Tauri main WebView
- **AND** `window.__TAURI_INTERNALS__` is present
- **THEN** the SPA initializes its runtime adapter in "desktop" mode
- **AND** subsequent project-loading actions call Tauri IPC commands instead of the browser mock

#### Scenario: Non-desktop fallback preserved

- **WHEN** the SPA boots in a regular browser without Tauri internals
- **THEN** the SPA initializes its runtime adapter in "browser" mode
- **AND** the existing mocked preview and in-memory project behavior continues to work unchanged

### Requirement: Explicit scope exclusions

The desktop shell SHALL NOT integrate with the Phoenix backend (`apps/backend`), SHALL NOT expose any network listener, SHALL NOT ship a scripting plugin runtime, and SHALL NOT support iPadOS, Android, or any mobile target in this change.

#### Scenario: No network listener is opened

- **WHEN** the desktop shell is running with a project loaded
- **THEN** no TCP listener is bound by the Rust core for incoming connections
- **AND** `lsof -iTCP -sTCP:LISTEN -p <pid>` shows no ports opened by the Tauri process (the dev-server child process is separate and may bind its own port)

#### Scenario: No Phoenix client is initialized

- **WHEN** the desktop shell is running
- **THEN** no HTTP or WebSocket client in the Rust core or SPA targets `apps/backend`
- **AND** launching the app without Phoenix running does not produce connection errors, retries, or logged warnings

#### Scenario: No scripting runtime is embedded

- **WHEN** the desktop shell is built
- **THEN** the Rust core does not link a JavaScript, Lua, Ruby, or WebAssembly scripting engine
- **AND** the SPA does not load a plugin host module
