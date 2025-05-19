import * as vscode from 'vscode';
import * as path from 'path';
import { PfdaCli } from '../pfdaCli';
import { PfdaNode } from '../pfdaNode';

export class PfdaDragAndDropController implements vscode.TreeDragAndDropController<PfdaNode> {
    // Define MIME types for drag and drop operations
    dropMimeTypes = ['application/vnd.code.tree.pfdaFileExplorer', 'files', 'text/uri-list'];
    dragMimeTypes = ['text/uri-list'];

    /**
     * Prevent dropping onto file nodes by disabling drop on non-directories.
     */
    public validateDrop(target: PfdaNode | undefined, _dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): boolean {
        // Only allow drops when target is undefined (root) or a directory
        return !target || target.isDirectory;
    }

    // Current active space ID
    private activeSpaceId: string | undefined;

    constructor(
        private pfdaCli: PfdaCli,
        private refreshCallback: (spaceId?: string) => void
    ) {}

    public async handleDrop(target: PfdaNode | undefined, sources: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        // First, check if the drop is from within the tree (internal move)
        const internalTransferItem = sources.get('application/vnd.code.tree.pfdaFileExplorer');
        if (internalTransferItem) {
            // Handle internal file/folder movement
            const sourceNodes: PfdaNode[] = internalTransferItem.value;
            
            // Move each file/directory to the target location
            for (const node of sourceNodes) {
                if (target && target.isDirectory) {
                    // Get the destination path
                    const destPath = path.join(target.path, path.basename(node.path));
                    
                    try {
                        // Execute the pfda mv command to move the file
                        await this.pfdaCli.executeCommand(`${this.pfdaCli.getCliPath()} mv ${this.pfdaCli.getDefaultParams()} "${node.path}" "${destPath}"`);
                    } catch (err) {
                        vscode.window.showErrorMessage(`Failed to move ${node.path}: ${err}`);
                    }
                }
            }
            
            // Refresh the view with the active space ID
            this.refreshCallback(this.activeSpaceId);
            return;
        }
        
        // Check if the drop is from external sources (file upload)
        const uriListTransferItem = sources.get('text/uri-list');
        if (uriListTransferItem) {
            // Handle external file/folder uploads
            try {
                const uriList: string = uriListTransferItem.value;
                const uris = uriList.split('\n')
                    .map(uri => uri.trim())
                    .filter(uri => uri.length > 0)
                    .map(uri => vscode.Uri.parse(uri));
                
                if (uris.length === 0) {
                    return;
                }
                
                // Get local filesystem paths from URIs
                const filePaths = uris.map(uri => uri.fsPath);
                
                // Determine target folder ID
                let targetFolderId: string | undefined;
                if (target) {
                    // If dropped on a folder, use that folder's ID
                    if (target.isDirectory) {
                        targetFolderId = target.id;
                    } 
                    // If dropped on a file, use the file's parent folder
                    else if (target.parent) {
                        targetFolderId = target.parent.id;
                    }
                }
                
                // Confirm upload with the user
                const fileCount = filePaths.length;
                const uploadMsg = `Upload ${fileCount} ${fileCount === 1 ? 'file' : 'files'} to ${target ? target.label : 'PFDA'}?`;
                const response = await vscode.window.showInformationMessage(
                    uploadMsg,
                    { modal: true },
                    'Upload',
                    'Cancel'
                );
                
                if (response !== 'Upload') {
                    return;
                }
                
                // Upload files with progress tracking
                await this.pfdaCli.uploadFiles(
                    filePaths, 
                    this.activeSpaceId === 'my-home' ? undefined : this.activeSpaceId, 
                    targetFolderId
                );
                
                // Show success message
                vscode.window.showInformationMessage(`Successfully uploaded ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`);
                
                // Refresh the view
                this.refreshCallback(this.activeSpaceId);
            } catch (err) {
                vscode.window.showErrorMessage(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
        }
    }

    public async handleDrag(source: PfdaNode[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        treeDataTransfer.set('application/vnd.code.tree.pfdaFileExplorer', new vscode.DataTransferItem(source));
    }
    
    /**
     * Set the active space ID
     */
    public setActiveSpaceId(spaceId: string | undefined): void {
        this.activeSpaceId = spaceId;
    }
}
