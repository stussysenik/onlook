## ADDED Requirements

### Requirement: Project file scan command

The Rust core SHALL expose a Tauri command `project_list_files` that walks the active project's root directory, returns a flat list of entries annotated with path, relative path, kind, size, and editability, applies a hardcoded ignore list, and caps the result at 10,000 entries with a truncation marker so the SPA can render a warning if the scan was capped.

#### Scenario: Scanning a valid loaded project

- **WHEN** the SPA invokes `project_list_files` after a successful `project_validate` and `dev_server_start`
- **THEN** the Rust core walks the project root recursively on a blocking worker thread
- **AND** returns a list of `FileEntry` values containing `path`, `relative`, `kind`, `size`, and `editable`
- **AND** the list is sorted so that directories appear before files at each depth and entries at each depth are alphabetically ordered
- **AND** the total number of returned entries is at most 10,000

#### Scenario: Ignored directories are excluded

- **WHEN** the Rust core walks a project that contains any of `node_modules`, `.git`, `dist`, `build`, `.svelte-kit`, `.next`, `.turbo`, or `.cache` at any depth
- **THEN** none of those directories or their descendants appear in the returned entries
- **AND** the scan does not recurse into them

#### Scenario: Editability flag is derived from extension

- **WHEN** a file entry has an extension of `.svelte`, `.jsx`, or `.tsx`
- **THEN** its `editable` field is `true`
- **AND** for any other extension or for directories, `editable` is `false`

#### Scenario: Scan without an active project fails cleanly

- **WHEN** `project_list_files` is invoked before `project_validate` has registered an active project
- **THEN** the Rust core returns a typed `CoreError` with a message identifying the missing project
- **AND** no filesystem walk is initiated

#### Scenario: Scan hits the entry cap

- **WHEN** the project contains more than 10,000 walkable entries after applying the ignore list
- **THEN** the Rust core returns the first 10,000 entries in sort order
- **AND** the response payload includes a `truncated: true` marker the SPA can surface as a visible warning

### Requirement: Atomic project file write command

The Rust core SHALL expose a Tauri command `project_write_file` that takes an absolute target path and a string content payload, validates that the target path is contained inside the active project's canonicalized root, rejects any ancestor path component that is a symlink, and writes the file via a temp file plus rename in the same directory so the operation is atomic on APFS.

#### Scenario: Successful write inside the project root

- **WHEN** the SPA invokes `project_write_file` with a path inside the active project root and a string payload smaller than 1 MB
- **THEN** the Rust core writes the payload to `<path>.onlook.tmp` next to the target
- **AND** renames the temp file to the target path
- **AND** returns an `Ok(())` IPC response

#### Scenario: Write outside the project root is rejected

- **WHEN** the SPA invokes `project_write_file` with a path that, after canonicalization, does not start with the canonicalized project root
- **THEN** the Rust core returns a typed `CoreError` identifying the containment violation
- **AND** no file is written, no temp file is created

#### Scenario: Symlinked ancestor is rejected

- **WHEN** any ancestor directory of the target path is a symlink
- **THEN** the Rust core returns a typed `CoreError` identifying the symlink in the path
- **AND** no file is written, no temp file is created

#### Scenario: Oversized payload is rejected

- **WHEN** the payload exceeds 1 MB in length
- **THEN** the Rust core returns a typed `CoreError` identifying the size limit
- **AND** no file is written

#### Scenario: Temp file cleanup on rename failure

- **WHEN** the temp file is written successfully but the rename step fails
- **THEN** the Rust core attempts to delete the temp file
- **AND** returns the original rename failure as a typed `CoreError`

### Requirement: File tree panel in desktop mode

The `apps/editor` SPA SHALL render a file tree panel in desktop mode that displays the entries returned by `project_list_files`, tracks a single `selectedFilePath`, and gates file selection on the entry's `editable` flag.

#### Scenario: Panel appears after dev server is ready

- **WHEN** the SPA is in desktop mode and `desktop://dev-server-ready` has fired for the current project
- **THEN** the SPA calls `adapter.listFiles()` exactly once for that project
- **AND** renders a tree constructed from the returned flat entry list
- **AND** the tree replaces the framework-pill sample-framework selector in the left rail

#### Scenario: Selecting an editable file loads it into the inspector

- **WHEN** the user clicks a tree entry whose `editable` flag is `true`
- **THEN** the SPA calls `adapter.parseFile(path, framework)` with the framework inferred from the file extension
- **AND** replaces its current `EditorDocument`, `source`, and `selectedNodeId` state with the values derived from the parse response
- **AND** records the absolute path in `selectedFilePath` so subsequent edits know where to write

#### Scenario: Selecting a non-editable file is a no-op

- **WHEN** the user clicks a tree entry whose `editable` flag is `false`
- **THEN** the SPA does not call `parseFile`
- **AND** does not change its current selection or document state
- **AND** renders the entry with reduced opacity so the state is visible

#### Scenario: Active file is visible in the source panel header

- **WHEN** a `selectedFilePath` is set in desktop mode
- **THEN** the source panel header displays the relative path of the file currently loaded
- **AND** the source textarea shows the file's current source string as read-only content

### Requirement: Edit write-back through the file tree

When a file is selected in the file tree and the user commits an inspector edit, the SPA SHALL call `adapter.writeFile(selectedFilePath, document.source)` with the updated source string, and MUST NOT write to disk if no `selectedFilePath` is set.

#### Scenario: Inspector edit persists to disk

- **WHEN** the user has a file selected in the tree
- **AND** commits an inspector action that produces a new `EditorDocument`
- **THEN** the SPA calls `adapter.writeFile` with the `selectedFilePath` and the new `document.source`
- **AND** on success, the project's dev server HMR reload updates the preview webview with the new file content within 2 seconds
- **AND** the SPA's `syncStatus` reflects "saved" with the relative path

#### Scenario: Inspector edit without a selected file stays in memory

- **WHEN** the SPA is in desktop mode but no `selectedFilePath` is set
- **AND** the user commits an inspector action
- **THEN** the SPA updates its in-memory `EditorDocument` via `adapter.emitEdit`
- **AND** does not call `writeFile`
- **AND** does not surface a "saved" status

#### Scenario: Write failure keeps the in-memory document intact

- **WHEN** `adapter.writeFile` returns an error
- **THEN** the SPA keeps the post-edit `EditorDocument` in memory
- **AND** shows the error message in the `syncStatus` banner
- **AND** does not revert the inspector's local state, so the user can retry without re-entering their change

### Requirement: Framework inference from file extension

The SPA SHALL infer the `FrameworkId` to pass to `parseFile` from the file extension of the selected entry, using the mapping `.svelte → svelte`, `.jsx → react`, `.tsx → react`, with all other extensions treated as non-editable.

#### Scenario: Svelte file is parsed as Svelte

- **WHEN** the user selects an entry whose path ends in `.svelte`
- **THEN** the SPA passes `svelte` as the framework argument to `adapter.parseFile`

#### Scenario: TSX file is parsed as React

- **WHEN** the user selects an entry whose path ends in `.tsx`
- **THEN** the SPA passes `react` as the framework argument to `adapter.parseFile`

#### Scenario: Unsupported extension is not openable

- **WHEN** the user clicks an entry whose extension is not one of `.svelte`, `.jsx`, `.tsx`
- **THEN** the SPA does not call `parseFile`
- **AND** the entry is rendered as non-editable in the tree

### Requirement: Runtime adapter extension for file operations

The `Adapter` interface in `apps/editor/src/runtime/adapter.ts` SHALL gain two methods, `listFiles` and `writeFile`, with the desktop implementation routing to the new Rust commands and the browser implementation throwing a `not available` error that the SPA already handles for other desktop-only methods.

#### Scenario: Desktop adapter listFiles round-trip

- **WHEN** the SPA calls `adapter.listFiles()` on a `DesktopAdapter`
- **THEN** the adapter invokes the Tauri command `project_list_files`
- **AND** returns the typed `FileEntry[]` and truncation flag to the caller

#### Scenario: Desktop adapter writeFile round-trip

- **WHEN** the SPA calls `adapter.writeFile(path, contents)` on a `DesktopAdapter`
- **THEN** the adapter invokes the Tauri command `project_write_file` with `{ path, contents }`
- **AND** returns success or rethrows the `CoreError` to the caller

#### Scenario: Browser adapter surfaces a clear error

- **WHEN** the SPA calls `listFiles` or `writeFile` on a `BrowserAdapter`
- **THEN** the adapter throws an `Error` whose message identifies the method as desktop-only
- **AND** the browser-mode UI never reaches these call sites because the file tree is only rendered in desktop mode

### Requirement: Scope exclusions for the file tree change

The `desktop-file-tree` capability SHALL NOT introduce a filesystem watcher, git awareness, file create / rename / delete, file search, multi-file selection, or lazy subdirectory expansion in this change.

#### Scenario: No filesystem watcher is spawned

- **WHEN** a project is opened in desktop mode with the file tree loaded
- **THEN** the Rust core does not spawn any `notify`-based watcher for the project root
- **AND** the tree refreshes only on an explicit user action (reopening the project)

#### Scenario: No git commands are invoked

- **WHEN** the Rust core walks the project for `project_list_files`
- **THEN** it does not invoke `git`, does not read `.git/index`, and does not annotate entries with git status
- **AND** the `.git` directory is skipped by the ignore list exactly like `node_modules`

#### Scenario: No file creation, rename, or delete commands

- **WHEN** the SPA is loaded in desktop mode with the file tree panel visible
- **THEN** the UI exposes no controls for creating, renaming, or deleting files or directories
- **AND** the Rust core does not expose any Tauri command for such operations in this change
