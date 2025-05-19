import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PfdaCli } from '../pfdaCli';
import { PfdaNode } from '../pfdaNode';
import { allowedExtensions } from './extens';

export class FileOpener {
    // Current active space ID
    private activeSpaceId: string | undefined;
    
    constructor(private pfdaCli: PfdaCli) {}

    // List of allowed file extensions that can be opened
    private allowedExt = allowedExtensions;

    // Maximum file size for opening (5 MB)
    private maxFileSize = 5 * 1024 * 1024;
    
    /**
     * Set the active space ID
     */
    public setActiveSpaceId(spaceId: string | undefined): void {
        this.activeSpaceId = spaceId;
    }

    /**
     * Open a file from the PFDA platform
     */
    public async openFile(node: PfdaNode): Promise<void> {
        if (node.isDirectory) {
            vscode.window.showWarningMessage('Cannot open a directory.');
            return;
        }

        // Check file extension
        const ext = path.extname(node.label).toLowerCase();
        if (!this.allowedExt.includes(ext)) {
            vscode.window.showWarningMessage('Only text files and PDFs can be opened or downloaded.');
            return;
        }

        // Check file size before downloading
        let fileSize = 0;
        try {
            const args = ['ls', node.id];
            
            // Handle the special "My Home" space and regular spaces differently
            if (this.activeSpaceId === 'my-home') {
                console.log(`FileOpener: Getting file info in My Home (no space-id parameter)`);
                // Don't add space-id parameter for My Home
            } else if (this.activeSpaceId) {
                console.log(`FileOpener: Including space ID ${this.activeSpaceId} in ls command for file info`);
                args.push('-space-id', this.activeSpaceId);
            } else {
                console.log('FileOpener: No active space ID for ls command, defaulting to My Home behavior');
                // Default to My Home behavior (no space-id)
            }
            
            const info = await this.pfdaCli.callPfdaCli(args);
            if (Array.isArray(info) && info.length > 0 && typeof info[0].size === 'number') {
                fileSize = info[0].size;
            } else if (info && typeof info.size === 'number') {
                fileSize = info.size;
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to get file info: ${err}`);
            return;
        }

        if (fileSize > this.maxFileSize) {
            vscode.window.showWarningMessage('File is larger than 5 MB and will not be downloaded or opened.');
            return;
        }

        // Setup local file path
        const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const tmpDir = path.join(rootPath || '', 'tmp');

        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        // Create a space-specific directory inside tmp
        const spaceId = this.activeSpaceId || 'my-home';
        const spaceTmpDir = path.join(tmpDir, spaceId);
        
        if (!fs.existsSync(spaceTmpDir)) {
            fs.mkdirSync(spaceTmpDir, { recursive: true });
        }
        
        // Preserve the exact path from the tree structure
        const fileName = path.basename(node.path);
        let dirPath = path.dirname(node.path);
        if (dirPath === ".") {
            dirPath = "";
        }
        const localDir = path.join(spaceTmpDir, dirPath);
        const localPath = path.join(localDir, fileName);

        // Create the directory structure if it doesn't exist
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }

        // Download and open the file
        await this.downloadAndOpenFile(node, localPath, localDir);
    }

    /**
     * Download and open a file
     */
    private async downloadAndOpenFile(node: PfdaNode, localPath: string, localDir: string): Promise<void> {
        const fileName = path.basename(node.path);
        const ext = path.extname(fileName).toLowerCase();
        const downloadAndOpen = async () => {
            if (!fs.existsSync(localPath)) {
                try {
                    const args = ['download', node.id, '-output', localDir];
                    
                    // Handle the special "My Home" space and regular spaces differently
                    if (this.activeSpaceId === 'my-home') {
                        console.log(`FileOpener: Downloading file from My Home (no space-id parameter)`);
                        // Don't add space-id parameter for My Home
                    } else if (this.activeSpaceId) {
                        console.log(`FileOpener: Including space ID ${this.activeSpaceId} in download command`);
                        args.push('-space-id', this.activeSpaceId);
                    } else {
                        console.log('FileOpener: No active space ID for download command, defaulting to My Home behavior');
                        // Default to My Home behavior (no space-id)
                    }
                    
                    await this.pfdaCli.callPfdaCli(args);
                    if (!fs.existsSync(localPath)) {
                        vscode.window.showErrorMessage(`Download did not produce expected file: ${localPath}`);
                        return;
                    }
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to download file: ${err}`);
                    return;
                }
            }
            
            // Open PDF, image, or notebook in VS Code viewer, otherwise open as text
            if (ext === '.pdf' || ext === '.ipynb' || ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp'].includes(ext)) {
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(localPath));
            } else {
                const doc = await vscode.workspace.openTextDocument(localPath);
                await vscode.window.showTextDocument(doc, { preview: false });
            }
        };

        if (!fs.existsSync(localPath)) {
            await vscode.window.withProgress({
                title: `Downloading ${node.label}...`,
                location: vscode.ProgressLocation.Notification,
                cancellable: false
            }, async () => {
                await downloadAndOpen();
            });
        } else {
            await downloadAndOpen();
        }
    }
}
