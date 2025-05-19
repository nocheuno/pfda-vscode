import * as vscode from 'vscode';
import * as path from 'path';
import { PfdaCli } from '../pfdaCli';
import { PfdaNode } from '../pfdaNode';
import { allowedExtensions } from './extens';

export class FileOperations {
    // Current active space ID
    private activeSpaceId: string | undefined;
    
    constructor(private pfdaCli: PfdaCli) {}
    
    // Set the active space ID
    public setActiveSpaceId(spaceId: string | undefined): void {
        this.activeSpaceId = spaceId;
    }

    public async uploadFile(): Promise<void> {
        console.log('FileOperations: Starting file upload process');
        // Show file picker
        const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Upload'
        });
        
        if (!fileUris || fileUris.length === 0) {
            console.log('FileOperations: No file selected for upload');
            return;
        }
        
        const filePath = fileUris[0].fsPath;
        const fileName = path.basename(filePath);
        console.log(`FileOperations: File selected for upload: ${filePath}`);
        
        // Ask for destination folder
        const destinationFolders = await this.getDirectories();
        console.log(`FileOperations: Available destination folders: ${JSON.stringify(destinationFolders)}`);
        
        const selectedFolder = await vscode.window.showQuickPick(
            destinationFolders,
            { placeHolder: 'Select destination folder' }
        );
        
        if (!selectedFolder) {
            console.log('FileOperations: No destination folder selected');
            return;
        }
        console.log(`FileOperations: Selected destination folder: ${selectedFolder}`);
        
        // Execute the upload command
        try {
            console.log(`FileOperations: Current activeSpaceId = "${this.activeSpaceId}"`);
            
            // Use uploadFiles which already handles progress bar through withProgress
            console.log(`FileOperations: Using uploadFiles which shows a progress bar during upload`);
            await this.pfdaCli.uploadFiles(
                [filePath], 
                this.activeSpaceId !== 'my-home' ? this.activeSpaceId : undefined, 
                selectedFolder
            );
            
            console.log(`FileOperations: File upload completed successfully`);
            vscode.window.showInformationMessage(`File ${fileName} uploaded successfully.`);
        } catch (err) {
            console.error(`FileOperations: File upload failed with error: ${err}`);
            vscode.window.showErrorMessage(`Upload failed: ${err}`);
        }
    }
    
    public async downloadFile(node: PfdaNode): Promise<void> {
        if (node.isDirectory) {
            vscode.window.showWarningMessage('Can only download files, not directories.');
            return;
        }

        // Only allow text files and PDFs
        const ext = path.extname(node.label).toLowerCase();
        if (!allowedExtensions.includes(ext)) {
            vscode.window.showWarningMessage('Only text files and PDFs can be downloaded.');
            return;
        }

        // Show folder picker for download destination
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Download Location'
        });
        
        if (!folderUri || folderUri.length === 0) {
            return;
        }
        
        const downloadPath = folderUri[0].fsPath;
        
        // Execute the download command
        try {
            const args = ['download', node.id, '-output', downloadPath];
            
            // Handle the special "My Home" space and regular spaces differently
            if (this.activeSpaceId === 'my-home') {
                console.log(`FileOperations: Downloading file from My Home (no space-id parameter)`);
                // Don't add space-id parameter for My Home
            } else if (this.activeSpaceId) {
                console.log(`FileOperations: Including space ID ${this.activeSpaceId} in download command`);
                args.push('-space-id', this.activeSpaceId);
            } else {
                console.log('FileOperations: No active space ID for download command, defaulting to My Home behavior');
                // Default to My Home behavior (no space-id)
            }
            
            await this.pfdaCli.callPfdaCli(args);
            vscode.window.showInformationMessage(`File ${node.label} downloaded successfully.`);
        } catch (err) {
            vscode.window.showErrorMessage(`Download failed: ${err}`);
        }
    }
    
    public async createDirectory(parentNode?: PfdaNode): Promise<boolean> {
        // Ask for directory name
        const directoryName = await vscode.window.showInputBox({
            prompt: 'Enter the name for the new directory',
            placeHolder: 'folder or path/to/nested/folder',
            validateInput: (value) => {
                return value && value.trim().length > 0 ? null : 'Directory name cannot be empty';
            }
        });
        
        if (!directoryName) {
            return false;
        }
        
        // Execute the mkdir command
        try {
            const args = ['mkdir'];
            
            // Add the directory name directly to args
            args.push(directoryName);
            
            // If a parent node is provided, use its ID as the folder-id
            if (parentNode && parentNode.isDirectory) {
                args.push('-folder-id', parentNode.id);
                console.log(`FileOperations: Creating directory under parent ID: ${parentNode.id}`);
            }
            
            // If the directory name contains path separators, use -p flag to create parent directories
            if (directoryName.includes('/') || directoryName.includes('\\')) {
                args.push('-p');
            }
            
            // Handle the special "My Home" space and regular spaces differently
            if (this.activeSpaceId === 'my-home') {
                console.log(`FileOperations: Creating directory in My Home (no space-id parameter)`);
                // Don't add space-id parameter for My Home
            } else if (this.activeSpaceId) {
                console.log(`FileOperations: Including space ID ${this.activeSpaceId} in mkdir command`);
                args.push('-space-id', this.activeSpaceId);
            } else {
                console.log('FileOperations: No active space ID for mkdir command, defaulting to My Home behavior');
                // Default to My Home behavior (no space-id)
            }
            
            await this.pfdaCli.callPfdaCli(args);
            
            // Display appropriate success message based on whether we're creating a single folder or using a path
            if (directoryName.includes('/') || directoryName.includes('\\')) {
                vscode.window.showInformationMessage(`Folder structure ${directoryName} created successfully.`);
            } else {
                vscode.window.showInformationMessage(`Folder ${directoryName} created successfully.`);
            }
            return true;
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create folder: ${err}`);
            return false;
        }
    }
    
    public async removeFile(node: PfdaNode): Promise<boolean> {
        if (node.isDirectory) {
            vscode.window.showWarningMessage('Use rmdir to remove directories.');
            return false;
        }
        
        // Confirm deletion
        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete file "${node.label}"?`,
            { modal: true },
            'Delete'
        );
        
        if (confirmation !== 'Delete') {
            return false;
        }
        
        // Execute the rm command
        try {
            const args = ['rm', node.id];
            
            // Handle the special "My Home" space and regular spaces differently
            if (this.activeSpaceId === 'my-home') {
                console.log(`FileOperations: Removing file in My Home (no space-id parameter)`);
                // Don't add space-id parameter for My Home
            } else if (this.activeSpaceId) {
                console.log(`FileOperations: Including space ID ${this.activeSpaceId} in rm command`);
                args.push('-space-id', this.activeSpaceId);
            } else {
                console.log('FileOperations: No active space ID for rm command, defaulting to My Home behavior');
                // Default to My Home behavior (no space-id)
            }
            
            await this.pfdaCli.callPfdaCli(args);
            vscode.window.showInformationMessage(`File ${node.label} deleted successfully.`);
            return true;
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to delete file: ${err}`);
            return false;
        }
    }
    
    public async removeDirectory(node: PfdaNode): Promise<boolean> {
        if (!node.isDirectory) {
            vscode.window.showWarningMessage('Use rm to remove files.');
            return false;
        }
        
        // Confirm deletion
        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete directory "${node.label}" and all its contents?`,
            { modal: true },
            'Delete'
        );
        
        if (confirmation !== 'Delete') {
            return false;
        }
        
        try {
            console.log(`FileOperations: Starting directory deletion for ${node.label} (ID: ${node.id})`);
            
            // Use the new deleteRemoteDirectory method which handles recursive deletion properly
            await this.pfdaCli.deleteRemoteDirectory(node.id, { 
                spaceId: this.activeSpaceId !== 'my-home' ? this.activeSpaceId : undefined,
                showProgress: true 
            });
            
            console.log(`FileOperations: Successfully removed directory ${node.label}`);
            vscode.window.showInformationMessage(`Directory ${node.label} deleted successfully.`);
            return true;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`FileOperations: Directory deletion failed: ${errorMessage}`);
            return true;
        }
    }

    public async catFile(node: PfdaNode): Promise<void> {
        if (node.isDirectory) {
            vscode.window.showWarningMessage('Cannot cat a directory.');
            return;
        }
        try {
            const args = ['cat', node.id];
            
            // Handle the special "My Home" space and regular spaces differently
            if (this.activeSpaceId === 'my-home') {
                console.log(`FileOperations: Cat file in My Home (no space-id parameter)`);
                // Don't add space-id parameter for My Home
            } else if (this.activeSpaceId) {
                console.log(`FileOperations: Including space ID ${this.activeSpaceId} in cat command`);
                args.push('-space-id', this.activeSpaceId);
            } else {
                console.log('FileOperations: No active space ID for cat command, defaulting to My Home behavior');
                // Default to My Home behavior (no space-id)
            }
            
            const result = await this.pfdaCli.callPfdaCli(args);
            vscode.window.showInformationMessage(`Content of ${node.label}:\n${result.content || JSON.stringify(result)}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to cat file: ${err}`);
        }
    }

    public async headFile(node: PfdaNode): Promise<void> {
        if (node.isDirectory) {
            vscode.window.showWarningMessage('Cannot head a directory.');
            return;
        }
        try {
            const args = ['head', node.id];
            
            // Handle the special "My Home" space and regular spaces differently
            if (this.activeSpaceId === 'my-home') {
                console.log(`FileOperations: Head file in My Home (no space-id parameter)`);
                // Don't add space-id parameter for My Home
            } else if (this.activeSpaceId) {
                console.log(`FileOperations: Including space ID ${this.activeSpaceId} in head command`);
                args.push('-space-id', this.activeSpaceId);
            } else {
                console.log('FileOperations: No active space ID for head command, defaulting to My Home behavior');
                // Default to My Home behavior (no space-id)
            }
            
            const result = await this.pfdaCli.callPfdaCli(args);
            vscode.window.showInformationMessage(`Head of ${node.label}:\n${result.content || JSON.stringify(result)}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to head file: ${err}`);
        }
    }

    private async getDirectories(): Promise<string[]> {
        try {
            const args = ['ls', ...this.pfdaCli.getDefaultParams().split(' '), '-type', 'd'];
            
            // Handle the special "My Home" space and regular spaces differently
            if (this.activeSpaceId === 'my-home') {
                console.log(`FileOperations: Listing directories for My Home (no space-id parameter)`);
                // Don't add space-id parameter for My Home
            } else if (this.activeSpaceId) {
                console.log(`FileOperations: Including space ID ${this.activeSpaceId} in ls command`);
                args.push('-space-id', this.activeSpaceId);
            } else {
                console.log('FileOperations: No active space ID, defaulting to My Home behavior');
                // Default to My Home behavior (no space-id)
            }
            
            const result = await this.pfdaCli.callPfdaCli(args);
            return result.map((item: any) => item.path);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to list directories: ${err}`);
            return [];
        }
    }
}
