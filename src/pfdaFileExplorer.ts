import * as vscode from 'vscode';
import { PfdaCli } from './pfdaCli';
import { PfdaNode } from './pfdaNode';
import { FileOperations } from './services/fileOperations';
import { FileOpener } from './services/fileOpener';
import { PfdaTreeDataProvider } from './services/treeDataProvider';
import { PfdaDragAndDropController } from './services/dragAndDropController';

export class PfdaFileExplorer implements vscode.TreeDataProvider<PfdaNode>, vscode.TreeDragAndDropController<PfdaNode> {
    // Define MIME types for drag and drop operations
    dropMimeTypes = ['application/vnd.code.tree.pfdaFileExplorer', 'text/uri-list'];
    dragMimeTypes = ['text/uri-list'];

    // Service instances
    private treeDataProvider: PfdaTreeDataProvider;
    private dragAndDropController: PfdaDragAndDropController;
    private fileOperations: FileOperations;
    private fileOpener: FileOpener;
    
    // Pfda CLI instance
    private pfdaCli: PfdaCli;
    
    // Current active space ID
    private activeSpaceId: string | undefined;

    constructor(context: vscode.ExtensionContext) {
        // Find the path to the pfda CLI - search for it in the workspace
        const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!rootPath) {
            throw new Error('No workspace folder is open');
        }
        
        // Initialize PfdaCli instance
        this.pfdaCli = new PfdaCli(rootPath);

        // Initialize service instances
        this.treeDataProvider = new PfdaTreeDataProvider(this.pfdaCli);
        this.dragAndDropController = new PfdaDragAndDropController(this.pfdaCli, (spaceId) => this.refresh(spaceId));
        this.fileOperations = new FileOperations(this.pfdaCli);
        this.fileOpener = new FileOpener(this.pfdaCli);
        
        // Create the treeview in the Explorer
        const view = vscode.window.createTreeView('pfdaFileExplorer', { 
            treeDataProvider: this, 
            showCollapseAll: true, 
            canSelectMany: true, 
            dragAndDropController: this 
        });
        
        // Register the view
        context.subscriptions.push(view);
        
        // Register commands for file operations
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.refresh', (spaceId?: string) => this.refresh(spaceId)));
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.upload', () => this.uploadFile()));
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.uploadToPfda', (target: PfdaNode, uris: vscode.Uri[]) => this.uploadFilesToPfda(target, uris)));
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.download', (node: PfdaNode) => this.downloadFile(node)));
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.mkdir', (node?: PfdaNode) => this.createDirectory(node)));
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.rm', (node: PfdaNode) => this.removeFile(node)));
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.rmdir', (node: PfdaNode) => this.removeDirectory(node)));
        // Register command to delete multiple items (files or folders)
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.deleteItems', (nodes: PfdaNode | PfdaNode[]) => this.deleteItems(nodes)));
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.cat', (node: PfdaNode) => this.catFile(node)));
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.head', (node: PfdaNode) => this.headFile(node)));
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.openFile', (node: PfdaNode) => this.openFile(node)));
        context.subscriptions.push(vscode.commands.registerCommand('pfdaFileExplorer.copyFileDxid', (node: PfdaNode) => this.copyFileDxid(node)));
        
        // Initially load files
        this.refresh();
    }

    // TreeDataProvider implementation - delegates to the tree data provider service
    public async getChildren(element: PfdaNode | undefined): Promise<PfdaNode[]> {
        return this.treeDataProvider.getChildren(element);
    }

    public async getTreeItem(element: PfdaNode): Promise<vscode.TreeItem> {
        return this.treeDataProvider.getTreeItem(element);
    }
    
    public getParent(element: PfdaNode): PfdaNode | undefined {
        return this.treeDataProvider.getParent(element);
    }

    // Tree event handling
    public get onDidChangeTreeData(): vscode.Event<any> {
        return this.treeDataProvider.onDidChangeTreeData;
    }

    // Drag and drop implementation - delegates to the drag and drop controller
    public async handleDrop(target: PfdaNode | undefined, sources: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        return this.dragAndDropController.handleDrop(target, sources, token);
    }

    public async handleDrag(source: PfdaNode[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        return this.dragAndDropController.handleDrag(source, treeDataTransfer, token);
    }

    // File operations - delegates to the file operations service
    public async refresh(spaceId?: string): Promise<void> {
        try {
            console.log(`FileExplorer: Refresh called with space ID: ${spaceId || 'undefined'}`);
            
            // If a space ID is provided, update the active space ID
            if (spaceId !== undefined) {
                console.log(`FileExplorer: Setting active space ID to ${spaceId}`);
                this.activeSpaceId = spaceId;
                // Update the drag and drop controller's space ID
                this.dragAndDropController.setActiveSpaceId(spaceId);
                // Update the file operations space ID
                this.fileOperations.setActiveSpaceId(spaceId);
                // Update the file opener space ID
                this.fileOpener.setActiveSpaceId(spaceId);
            } else if (this.activeSpaceId === undefined) {
                // If no space ID is provided and no active space is set, default to My Home (no space-id)
                console.log('FileExplorer: No space specified, defaulting to My Home (no space-id)');
                this.activeSpaceId = 'my-home';
                this.dragAndDropController.setActiveSpaceId(this.activeSpaceId);
                this.fileOperations.setActiveSpaceId(this.activeSpaceId);
                this.fileOpener.setActiveSpaceId(this.activeSpaceId);
            } else {
                console.log(`FileExplorer: Using existing active space ID: ${this.activeSpaceId || 'undefined'}`);
            }
            
            // Refresh the tree data provider with the current space ID
            this.treeDataProvider.refresh(this.activeSpaceId);
        } catch (err) {
            console.error('FileExplorer: Error refreshing file list:', err);
            vscode.window.showErrorMessage(`Failed to refresh file list: ${err}`);
        }
    }
    
    private async uploadFile(): Promise<void> {
        console.log(`FileExplorer: uploadFile called with activeSpaceId=${this.activeSpaceId}`);
        await this.fileOperations.uploadFile();
        this.refresh();
    }
    
    /**
     * Upload files to PFDA directly from VS Code (used for drag-drop and paste operations)
     * @param target The target node (folder) to upload to
     * @param uris The URIs of the files to upload
     */
    private async uploadFilesToPfda(target: PfdaNode | undefined, uris: vscode.Uri[]): Promise<void> {
        if (!uris || uris.length === 0) {
            return;
        }
        
        try {
            // Get file paths from URIs
            const filePaths = uris.map(uri => uri.fsPath);
            
            // Determine target folder ID
            let targetFolderId: string | undefined;
            if (target) {
                // If dropped on a folder, use that folder's ID
                if (target.isDirectory) {
                    targetFolderId = target.id;
                } 
                // If dropped on a file, use the file's parent folder if available
                else if (target.parent) {
                    targetFolderId = target.parent.id;
                }
            }
            
            // Upload files with progress tracking
            await this.pfdaCli.uploadFiles(
                filePaths, 
                this.activeSpaceId === 'my-home' ? undefined : this.activeSpaceId, 
                targetFolderId
            );
            
            // Show success message
            const fileCount = filePaths.length;
            vscode.window.showInformationMessage(`Successfully uploaded ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`);
            
            // Refresh the view
            this.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    
    private async downloadFile(node: PfdaNode): Promise<void> {
        await this.fileOperations.downloadFile(node);
    }
    
    private async createDirectory(node?: PfdaNode): Promise<void> {
        await this.fileOperations.createDirectory(node);
        this.refresh();
    }
    
    private async removeFile(node: PfdaNode): Promise<void> {
        await this.fileOperations.removeFile(node);
        this.refresh();
    }
    
    private async removeDirectory(node: PfdaNode): Promise<void> {
        await this.fileOperations.removeDirectory(node);
        this.refresh();
    }

    private async catFile(node: PfdaNode): Promise<void> {
        await this.fileOperations.catFile(node);
    }

    private async headFile(node: PfdaNode): Promise<void> {
        await this.fileOperations.headFile(node);
    }

    private async openFile(node: PfdaNode): Promise<void> {
        await this.fileOpener.openFile(node);
    }
    
    private async copyFileDxid(node: PfdaNode): Promise<void> {
        if (!node.isDirectory) {
            await vscode.env.clipboard.writeText(node.id);
            vscode.window.showInformationMessage(`Copied File DXID: ${node.id}`);
        }
    }
    
    // Delete multiple files or folders
    private async deleteItems(nodes: PfdaNode | PfdaNode[]): Promise<void> {
        const items = Array.isArray(nodes) ? nodes : [nodes];
        if (items.length === 0) { return; }
        const names = items.map(n => n.label).join(', ');
        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete ${items.length} item(s): ${names}?`,
            { modal: true },
            'Delete'
        );
        if (confirmation !== 'Delete') { return; }
        for (const item of items) {
            if (item.isDirectory) {
                await this.fileOperations.removeDirectory(item);
            } else {
                await this.fileOperations.removeFile(item);
            }
        }
        this.refresh();
    }
}
