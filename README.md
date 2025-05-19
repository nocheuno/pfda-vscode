# PFDA Explorer Extension

This extension demonstrates integration with the PFDA platform, providing a fully-featured file explorer with drag and drop upload capabilities.

## Features

- File Explorer for PFDA spaces
- Support for drag and drop file uploads
- Upload and download files
- Copy file IDs
- Create folders and organize files
- Monitor space usage
- View app execution status

## Drag and Drop File Upload

![PFDA File Upload](./resources/file-upload.png)

Simply drag files or folders from your file system and drop them into the PFDA Explorer view.
The extension supports:
- Single file uploads
- Multiple file uploads
- Folder uploads with nested structure
- Progress tracking in the status bar

See [USAGE.md](./USAGE.md) for detailed usage instructions.

---

# Views & View Containers

This sample demonstrates how to implement and contribute a tree view in VS Code. This includes:

- Contributing views and view containers.
- Contributing actions in various location of the view.
- Implementing the tree data provider for the view.
- Creating and working with the view.

This sample provides following views

- Node dependencies view
- Ftp file explorer view

Following example shows Node dependencies view in Package Explorer View container.

![Package Explorer](./resources/package-explorer.png)

## VS Code API

This sample uses following contribution points, activation events and APIs

### Contribution Points

- `views`
- `viewsContainers`
- `menu`
  - `view/title`
  - `view/item/context`

### Activation Events

- `onView:${viewId}`

### APIs

- `window.createTreeView`
- `window.registerTreeDataProvider`
- `TreeView`
- `TreeDataProvider`

Refer to [Usage](./USAGE.md) document for more details.

## Running the Sample

- Open this example in VS Code Insiders
- `npm install`
- `npm run watch`
- `F5` to start debugging
- Node dependencies view is shown in Package explorer view container in Activity bar.
- FTP file explorer view should be shown in Explorer
