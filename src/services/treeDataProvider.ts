import * as vscode from 'vscode';
import * as path from 'path';
import { PfdaCli } from '../pfdaCli';
import { PfdaNode } from '../pfdaNode';

export class PfdaTreeDataProvider implements vscode.TreeDataProvider<PfdaNode> {
    // Event emitter for tree data changes
    private _onDidChangeTreeData: vscode.EventEmitter<(PfdaNode | undefined)[] | undefined> = new vscode.EventEmitter<PfdaNode[] | undefined>();
    public onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    // Cache of node objects
    private nodes = new Map<string, PfdaNode>();
    
    // Current active space ID
    private activeSpaceId: string | undefined;
    
    constructor(private pfdaCli: PfdaCli) {}

    public async getChildren(element: PfdaNode | undefined): Promise<PfdaNode[]> {
        if (!element) {
            // Root: fetch top-level items
            const args = ['ls', ...this.pfdaCli.getDefaultParams().split(' ')];
            
            // Handle the special "My Home" space and regular spaces differently
            if (this.activeSpaceId === 'my-home') {
                console.log(`TreeDataProvider: Listing files for My Home (no space-id parameter)`);
                // Don't add space-id parameter for My Home space
            } else if (this.activeSpaceId) {
                console.log(`TreeDataProvider: Including space ID ${this.activeSpaceId} in ls command`);
                args.push('-space-id', this.activeSpaceId);
            } else {
                console.log('TreeDataProvider: No active space ID, defaulting to My Home behavior');
                // Default to My Home behavior (no space-id)
            }
            
            console.log(`TreeDataProvider: Executing command: pfda ${args.join(' ')}`);
            const listing = await this.pfdaCli.callPfdaCli(args);
            return this._buildNodesFromListing(listing);
        } else if (element.isDirectory) {
            // Directory: fetch its children
            const args = ['ls', ...this.pfdaCli.getDefaultParams().split(' '), '-folder-id', element.id];
            
            // Handle the special "My Home" space and regular spaces differently
            if (this.activeSpaceId === 'my-home') {
                console.log(`TreeDataProvider: Listing files in folder ${element.id} for My Home (no space-id parameter)`);
                // Don't add space-id parameter for My Home space
            } else if (this.activeSpaceId) {
                console.log(`TreeDataProvider: Including space ID ${this.activeSpaceId} in ls command for folder ${element.id}`);
                args.push('-space-id', this.activeSpaceId);
            } else {
                console.log(`TreeDataProvider: No active space ID for ls command for folder ${element.id}, defaulting to My Home behavior`);
                // Default to My Home behavior (no space-id)
            }
            
            console.log(`TreeDataProvider: Executing command: pfda ${args.join(' ')}`);
            const listing = await this.pfdaCli.callPfdaCli(args);
            return this._buildNodesFromListing(listing, element.path, element);
        } else {
            return [];
        }
    }

    public async getTreeItem(element: PfdaNode): Promise<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(
            element.label,
            element.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        treeItem.id = element.id;
        treeItem.tooltip = element.path;
        
        // Set contextValue for both file/directory and for file extension
        if (element.isDirectory) {
            treeItem.contextValue = 'directory';
        } else {
            // Set the file context value, which helps with the right-click menu options
            treeItem.contextValue = 'file';
            
            // If the file has an extension, add it as a resource URI to leverage VS Code's icon theme
            if (element.extension) {
                // Use a Uri with a fake path that has the correct extension to get VS Code's icon
                treeItem.resourceUri = vscode.Uri.parse(`file:///fake/path/${element.label}`);
            }
        }

        // Use default theme icons for directories or files without extensions
        if (element.isDirectory) {
            treeItem.iconPath = new vscode.ThemeIcon('folder');
        } else if (!element.extension) {
            treeItem.iconPath = new vscode.ThemeIcon('file');
        }

        if (!element.isDirectory) {
            treeItem.command = {
                title: 'Open File',
                command: 'pfdaFileExplorer.openFile',
                arguments: [element]
            };
        }

        return treeItem;
    }
    
    public getParent(element: PfdaNode): PfdaNode | undefined {
        const parentPath = path.dirname(element.path);
        if (parentPath === element.path) {
            return undefined; // Root element
        }
        
        return this._getNodeByPath(parentPath);
    }

    /**
     * Build node objects from listing API response
     */
    private _buildNodesFromListing(listing: any, parentPath = '', parentNode?: PfdaNode): PfdaNode[] {
        if (!Array.isArray(listing)) {
            if (listing && Array.isArray(listing.files)) {
                listing = listing.files;
            } else {
                return [];
            }
        }
        const nodes: PfdaNode[] = [];
        for (const item of listing) {
            const isDirectory = item.type === 'Folder';
            let itemPath = item.path || item.name;
            if (!itemPath) {
                continue;
            }
            
            // Ensure we preserve the full path including parent directories
            // If parent path is provided and itemPath doesn't already include it
            if (parentPath && !itemPath.startsWith(parentPath)) {
                itemPath = path.join(parentPath, itemPath);
            }
            
            // Get file extension if it's not a directory
            let extension = undefined;
            if (!isDirectory) {
                extension = path.extname(item.name).toLowerCase();
                if (extension.startsWith('.')) {
                    extension = extension.slice(1); // Remove leading dot
                }
            }
            
            const node = new PfdaNode(
                item.uid || item.id,
                item.name,
                itemPath,
                isDirectory,
                extension
            );
            
            // Set parent relationship if we have a parent node
            if (parentNode) {
                node.setParent(parentNode);
            }
            
            this.nodes.set(node.id, node);
            nodes.push(node);
        }
        return nodes;
    }

    /**
     * Find a node by its path
     */
    private _getNodeByPath(nodePath: string): PfdaNode | undefined {
        // Look through nodes to find one with matching path
        for (const [, node] of this.nodes.entries()) {
            if (node.path === nodePath) {
                return node;
            }
        }
        return undefined;
    }

    /**
     * Clear nodes cache and refresh the tree
     */
    public refresh(spaceId?: string): void {
        console.log(`TreeDataProvider: Refreshing with space ID: ${spaceId || 'undefined'}`);
        this.nodes.clear();
        this.activeSpaceId = spaceId;
        this._onDidChangeTreeData.fire(undefined);
    }
}
